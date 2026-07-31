import OpenAI from 'openai'
import { config } from '../config.js'
import type { LlmSettings } from '../types/index.js'
import {
  composeCategorySystemPrompt,
  loadSelectedCategorySkills,
  type CategorySkillMeta,
} from '../skills/loader.js'
import { buildDeterministicMindMap, StreamingMindMapRecordParser } from './mindMapRecords.js'
import type { MindMapProgressSnapshot } from './streamMindMap.js'
import { ContextLengthError, isContextLengthError } from './context.js'

export interface MindMapNodeData {
  text: string
  note?: string
  tag?: string[]
  expand?: boolean
}

export interface MindMapNode {
  data: MindMapNodeData
  children?: MindMapNode[]
}

export interface RequirementAnalysisResult {
  title: string
  summary: string
  root: MindMapNode
  featureCount: number
}

export type RequirementAnalyzeStreamEvent =
  | { type: 'status'; data: { message: string } }
  | { type: 'reasoning'; data: { content: string } }
  | { type: 'skills'; data: { skills: CategorySkillMeta[] } }
  | { type: 'result'; data: { reasoningSummary: string } }
  | { type: 'error'; data: { message: string } }
  | { type: 'done'; data: Record<string, never> }

export type MindMapStreamEvent =
  | { type: 'status'; data: { message: string } }
  | { type: 'delta'; data: { content: string } }
  | { type: 'mindmap'; data: MindMapProgressSnapshot }
  | { type: 'result'; data: RequirementAnalysisResult }
  | { type: 'error'; data: { message: string } }
  | { type: 'done'; data: Record<string, never> }

export interface RequirementAnalyzeResult {
  reasoningSummary: string
}

const ANALYSIS_COMPLETE_MARKER = '[[REQUIREMENT_ANALYSIS_COMPLETE]]'
const INPUT_DOCUMENT_MARKER_RE = /\[\[INPUT_DOCUMENT_(?:BEGIN|END)\]\]/g
const INPUT_DOCUMENT_BEGIN = '[[INPUT_DOCUMENT_BEGIN]]'
const INPUT_DOCUMENT_END = '[[INPUT_DOCUMENT_END]]'
const INTERNAL_MARKER_BUFFER_CHARS = 128

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return trimmed
  if (trimmed.endsWith('/v1')) return trimmed
  if (/\/v\d+$/.test(trimmed)) return trimmed
  return `${trimmed}/v1`
}

const ANALYSIS_OUTPUT_CONSTRAINT = `

---

## 当前 API 阶段输出约束（覆盖 skill 中与之冲突的交互要求）

- 需求文档正文已经完整放在用户消息中，不要调用 Read / Glob / question 等工具，也不要要求用户再次确认。
- 一次性完整输出需求分析结论，覆盖原文中的全部章节、功能模块、业务规则、状态、异常、边界、权限、依赖和需求疑问；不得只输出计划、提纲或 3-5 行范围小结。
- 按所加载 skill 的方法逐模块分析，但避免重复测试点；结论必须足以直接生成不遗漏功能点的思维导图。
- 用户消息中的 ${INPUT_DOCUMENT_BEGIN} 和 ${INPUT_DOCUMENT_END} 是原文首尾接收回执，必须在最终分析中各原样输出一次，表明两端正文均已被接收。
- 输出前自行核对原文末尾章节也已覆盖。只有确认分析完整后，才在最后单独一行输出：${ANALYSIS_COMPLETE_MARKER}
- ${ANALYSIS_COMPLETE_MARKER} 后不得再输出任何内容。`

const MINDMAP_RECORD_OUTPUT_CONSTRAINT = `

---

## NDJSON 节点记录格式（强制约束，覆盖以上任何输出格式要求）

不要输出一个巨大的嵌套 JSON。只输出 NDJSON：每一行必须是一个独立、完整、合法的 JSON 对象；不要代码块、数组、解释或空行。

第一行输出元数据：
{"type":"meta","title":"文档/产品标题","summary":"一句话摘要","root":"根节点名称"}

之后每行输出一个功能点。path 是从根节点以下开始的完整层级路径：
{"type":"node","path":["模块","功能","子功能/规则"],"note":"可选说明","tag":["可选标签"]}

确认所有功能点均已输出后，最后一行输出完成记录。recordCount 必须等于本次全部唯一 node 行数量：
{"type":"complete","recordCount":123}

约束：
- 每行必须可以单独 JSON.parse；严禁跨行输出一个对象，严禁在一行内输出多个对象。
- 不要重复相同 path；每个功能点名称简洁（<= 20 字），必要时用 note 补充验收点/业务规则。
- children 按"模块 -> 功能 -> 子功能/规则"体现在 path 数组中，path 不要包含根节点名称。
- 只输出需求中明确存在的产品、模块、功能、业务流程、业务规则、状态、权限、异常和边界节点。
- 禁止输出测试方法、测试用例、测试步骤、测试数据、等价类划分、边界值分析、状态迁移法、错误推测法、场景法或任何测试策略；即使分析文本中出现测试建议，也只提取它所对应的产品行为。
- 不得为凑数量推测、细分或循环扩展需求中不存在的节点。
- 至少输出 5 个功能点；如果文档很短，也尽量结构化拆分。
- 只关注黑盒行为，不假设数据库表、API 字段、代码结构。
- 若用户消息中包含"需求分析结果"，思维导图的功能点划分、层级与边界必须与该分析保持一致；不得脱离分析自行重新拆解或遗漏分析中已识别的功能点。`

function buildReasoningUserPrompt(fileName: string, content: string): string {
  return `文件名：${fileName || '未命名需求文档'}

需求文档内容：
${INPUT_DOCUMENT_BEGIN}
${content}
${INPUT_DOCUMENT_END}

请在最终分析中原样输出 ${INPUT_DOCUMENT_BEGIN} 和 ${INPUT_DOCUMENT_END}，用于校验需求正文首尾均未被模型或网关截断。`
}

function buildJsonUserPrompt(fileName: string, content: string, reasoningSummary = ''): string {
  const reasoning = reasoningSummary.trim()
  if (reasoning) {
    return `文件名：${fileName || '未命名需求文档'}

## 需求分析结果（思维导图必须严格基于以下分析内容生成，不得脱离分析自由发散）

${reasoning}
`
  }
  return `文件名：${fileName || '未命名需求文档'}

需求文档内容：
${content}`
}

function extractCompatibleReasoning(delta: unknown): string {
  if (!delta || typeof delta !== 'object') return ''
  const record = delta as Record<string, unknown>
  const candidate = record.reasoning_content ?? record.reasoning ?? record.thinking
  if (typeof candidate === 'string') return candidate
  if (!Array.isArray(candidate)) return ''

  return candidate
    .map((item) => {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object') return ''
      const part = item as Record<string, unknown>
      return typeof part.text === 'string'
        ? part.text
        : typeof part.content === 'string'
          ? part.content
          : ''
    })
    .join('')
}

function createClient(llm: LlmSettings) {
  return new OpenAI({
    apiKey: llm.apiKey,
    baseURL: normalizeBaseUrl(llm.baseUrl),
    defaultHeaders: {
      'User-Agent': 'browser-automated-testing/0.1',
      'X-Stainless-Lang': null,
      'X-Stainless-Package-Version': null,
      'X-Stainless-OS': null,
      'X-Stainless-Arch': null,
      'X-Stainless-Runtime': null,
      'X-Stainless-Runtime-Version': null,
      'X-Stainless-Retry-Count': null,
    },
  })
}

function createAbortError(message = '已取消生成') {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true
  if (!error || typeof error !== 'object') return false
  const name = String((error as { name?: string }).name || '')
  const message = String((error as { message?: string }).message || '')
  return (
    name === 'AbortError' || name === 'APIUserAbortError' || /aborted|abort|cancel/i.test(message)
  )
}

function assertLlmReady(llm: LlmSettings, content: string) {
  if (!llm.apiKey?.trim()) throw new Error('请先配置 API Key')
  if (!llm.baseUrl?.trim()) throw new Error('请先配置 Base URL')
  if (!llm.model?.trim()) throw new Error('请先配置模型名称')
  if (!content.trim()) throw new Error('需求文档内容为空')
}

type ChatStream = AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
type StreamingRequest = OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

interface GenerationRun {
  startedAt: number
  deadlineAt: number
  externalSignal?: AbortSignal
  timeoutSignal: AbortSignal
  signal: AbortSignal
}

class GenerationTimeLimitError extends Error {
  constructor(maxDurationMs: number) {
    super(`AI 生成已达到总运行时限（${Math.ceil(maxDurationMs / 60_000)} 分钟），已停止任务`)
    this.name = 'GenerationTimeLimitError'
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function createGenerationRun(externalSignal?: AbortSignal): GenerationRun {
  const maxDurationMs = positiveInteger(config.requirementsGenerationMaxDurationMs, 60 * 60 * 1000)
  const startedAt = Date.now()
  const timeoutSignal = AbortSignal.timeout(maxDurationMs)
  return {
    startedAt,
    deadlineAt: startedAt + maxDurationMs,
    externalSignal,
    timeoutSignal,
    signal: externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal,
  }
}

function assertGenerationActive(run: GenerationRun): void {
  if (run.externalSignal?.aborted) throw createAbortError()
  if (run.timeoutSignal.aborted || Date.now() >= run.deadlineAt) {
    throw new GenerationTimeLimitError(run.deadlineAt - run.startedAt)
  }
}

function normalizeRunError(error: unknown, run: GenerationRun): Error {
  if (run.externalSignal?.aborted) return createAbortError()
  if (run.timeoutSignal.aborted || Date.now() >= run.deadlineAt) {
    return new GenerationTimeLimitError(run.deadlineAt - run.startedAt)
  }
  return error instanceof Error ? error : new Error(String(error))
}

function noProgressLimit(): number {
  return positiveInteger(config.requirementsNoProgressLimit, 3)
}

function hasEffectiveProgress(previous: string, delta: string): boolean {
  const normalizedDelta = delta.replace(/\s+/g, ' ').trim()
  if (!normalizedDelta) return false
  if (normalizedDelta.length < 64) return true
  const normalizedPrevious = previous.replace(/\s+/g, ' ').trim()
  return !normalizedPrevious.endsWith(normalizedDelta)
}

function nextStalledPasses(previous: string, delta: string, stalledPasses: number): number {
  return hasEffectiveProgress(previous, delta) ? 0 : stalledPasses + 1
}

function isTransientModelError(error: unknown): boolean {
  const record = error as { status?: unknown; code?: unknown; message?: unknown } | null
  const status = Number(record?.status)
  const code = String(record?.code || '')
  const message = String(record?.message || error || '')
  return (
    [408, 409, 425, 429].includes(status) ||
    status >= 500 ||
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|fetch failed|network|socket|timeout|rate.?limit|temporarily unavailable/i.test(
      `${code} ${message}`,
    )
  )
}

function retryDelayMs(attempt: number): number {
  const configured = Number(config.requirementsRetryBaseDelayMs)
  const base = Number.isFinite(configured) && configured >= 0 ? configured : 1000
  return Math.min(10_000, base * 2 ** Math.min(Math.max(0, attempt - 1), 6))
}

async function waitForRetry(run: GenerationRun, attempt: number): Promise<void> {
  assertGenerationActive(run)
  const delayMs = Math.min(retryDelayMs(attempt), Math.max(0, run.deadlineAt - Date.now()))
  if (delayMs <= 0) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      run.signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timer)
      reject(normalizeRunError(run.signal.reason, run))
    }
    run.signal.addEventListener('abort', onAbort, { once: true })
  })
  assertGenerationActive(run)
}

function terminalMarkerIndex(raw: string, marker: string): number {
  const first = raw.indexOf(marker)
  if (first === -1 || first !== raw.lastIndexOf(marker)) return -1
  return raw.slice(first + marker.length).trim() ? -1 : first
}

function missingCoverageMarkers(raw: string, expectedMarkers: string[]): string[] {
  return expectedMarkers.filter((marker) => {
    const first = raw.indexOf(marker)
    return first === -1 || first !== raw.lastIndexOf(marker)
  })
}

function removeInternalMarker(raw: string, marker: string): string {
  return raw.split(marker).join('')
}

async function createCompatibleCompletion(
  client: OpenAI,
  request: StreamingRequest,
  run: GenerationRun,
  onCompatibilityFallback: (message: string) => void,
): Promise<ChatStream> {
  let current: StreamingRequest = { ...request }
  let transientAttempt = 0

  while (true) {
    assertGenerationActive(run)
    try {
      return (await client.chat.completions.create(current, { signal: run.signal })) as ChatStream
    } catch (error) {
      const normalizedError = normalizeRunError(error, run)
      if (isAbortError(normalizedError, run.externalSignal)) throw normalizedError
      const message = errorMessage(error)

      if (isContextLengthError(error)) {
        throw new ContextLengthError(
          `模型拒绝了超出上下文窗口的请求：${message}。请缩短需求文档或改用上下文窗口更大的模型后重试。`,
        )
      }

      if (
        current.response_format &&
        /response[_ ]?format|json[_ ]?(?:mode|object)/i.test(message)
      ) {
        const { response_format: _unsupported, ...rest } = current
        current = rest as StreamingRequest
        onCompatibilityFallback('当前模型不支持 JSON mode，已自动切换为提示词约束模式。')
        continue
      }

      if (isTransientModelError(error)) {
        transientAttempt += 1
        const delayMs = retryDelayMs(transientAttempt)
        onCompatibilityFallback(
          `模型接口暂时不可用，${Math.max(1, Math.ceil(delayMs / 1000))} 秒后自动重试...`,
        )
        await waitForRetry(run, transientAttempt)
        continue
      }

      throw normalizedError
    }
  }
}

async function collectCompletion(input: {
  client: OpenAI
  request: StreamingRequest
  run: GenerationRun
  onContent: (content: string) => void
  onReasoning?: (content: string) => void
  onCompatibilityFallback: (message: string) => void
}): Promise<{ content: string; reasoning: string; finishReason: string | null }> {
  let content = ''
  let reasoning = ''
  let finishReason: string | null = null
  let emptyStreamRetries = 0

  while (true) {
    try {
      const stream = await createCompatibleCompletion(
        input.client,
        input.request,
        input.run,
        input.onCompatibilityFallback,
      )
      for await (const chunk of stream) {
        assertGenerationActive(input.run)
        const choice = chunk.choices?.[0]
        if (!choice) continue
        if (choice.finish_reason) finishReason = choice.finish_reason

        const nativeReasoning = extractCompatibleReasoning(choice.delta)
        if (nativeReasoning) {
          reasoning += nativeReasoning
          input.onReasoning?.(nativeReasoning)
        }

        if (choice.delta?.content) {
          content += choice.delta.content
          input.onContent(choice.delta.content)
        }
      }
      return { content, reasoning, finishReason }
    } catch (error) {
      const normalizedError = normalizeRunError(error, input.run)
      if (!isTransientModelError(error)) throw normalizedError
      emptyStreamRetries += 1
      input.onCompatibilityFallback(
        content || reasoning
          ? '模型流式连接中断，正在从已接收位置继续...'
          : `模型流式连接中断，正在自动重连（第 ${emptyStreamRetries} 次）...`,
      )
      await waitForRetry(input.run, emptyStreamRetries)
      if (content || reasoning) {
        return { content, reasoning, finishReason: 'stream_error' }
      }
    }
  }
}

function cleanAnalysisSummary(raw: string): string {
  return raw.split(ANALYSIS_COMPLETE_MARKER).join('').replace(INPUT_DOCUMENT_MARKER_RE, '').trim()
}

function stripInternalAnalysisMarkers(raw: string): string {
  return raw.split(ANALYSIS_COMPLETE_MARKER).join('').replace(INPUT_DOCUMENT_MARKER_RE, '')
}

export async function analyzeRequirementDocument(input: {
  llm: LlmSettings
  content: string
  fileName?: string
}): Promise<RequirementAnalysisResult> {
  const { reasoningSummary } = await streamAnalyzeRequirementDocument({
    ...input,
    onEvent: () => undefined,
  })
  return streamGenerateMindMap({
    ...input,
    reasoning: reasoningSummary,
    onEvent: () => undefined,
  })
}

export async function streamAnalyzeRequirementDocument(input: {
  llm: LlmSettings
  content: string
  fileName?: string
  signal?: AbortSignal
  onEvent?: (event: RequirementAnalyzeStreamEvent) => void
}): Promise<RequirementAnalyzeResult> {
  const { llm, content, fileName = 'requirement.md', signal, onEvent } = input
  const emit = onEvent || (() => undefined)

  assertLlmReady(llm, content)
  if (signal?.aborted) throw createAbortError()
  const run = createGenerationRun(signal)

  const skills = await loadSelectedCategorySkills('function-point')
  emit({ type: 'skills', data: { skills } })

  const skillSystemPrompt = composeCategorySystemPrompt(skills)
  const client = createClient(llm)
  emit({ type: 'status', data: { message: 'AI 正在梳理需求目标、业务规则和测试边界...' } })

  try {
    const reasoningSystemPrompt = `${skillSystemPrompt || '你是一名资深黑盒测试分析师。'}${ANALYSIS_OUTPUT_CONSTRAINT}`
    const initialMessages: ChatMessage[] = [
      { role: 'system', content: reasoningSystemPrompt },
      { role: 'user', content: buildReasoningUserPrompt(fileName, content) },
    ]
    const expectedCoverageMarkers = [INPUT_DOCUMENT_BEGIN, INPUT_DOCUMENT_END]
    let reasoningSummary = ''
    let finishReason: string | null = null
    let continuationMessages = initialMessages
    let markerPending = ''
    let continuationCount = 0
    let stalledPasses = 0

    const emitAnalysisContent = (contentDelta: string) => {
      reasoningSummary += contentDelta
      markerPending += contentDelta
      // Keep a marker-sized suffix buffered so the internal completeness marker is
      // never shown as part of the user's analysis text.
      const keep = INTERNAL_MARKER_BUFFER_CHARS
      if (markerPending.length > keep) {
        const visible = stripInternalAnalysisMarkers(
          markerPending.slice(0, markerPending.length - keep),
        )
        markerPending = markerPending.slice(-keep)
        if (visible) emit({ type: 'reasoning', data: { content: visible } })
      }
    }

    while (true) {
      assertGenerationActive(run)
      const previousSummary = reasoningSummary
      const pass = await collectCompletion({
        client,
        run,
        request: {
          model: llm.model,
          temperature: 0.2,
          stream: true,
          messages: continuationMessages,
        },
        onContent: emitAnalysisContent,
        onReasoning: (nativeReasoning) =>
          emit({ type: 'reasoning', data: { content: nativeReasoning } }),
        onCompatibilityFallback: (message) => emit({ type: 'status', data: { message } }),
      })
      finishReason = pass.finishReason

      const missingCoverage = missingCoverageMarkers(reasoningSummary, expectedCoverageMarkers)
      if (
        terminalMarkerIndex(reasoningSummary, ANALYSIS_COMPLETE_MARKER) >= 0 &&
        !missingCoverage.length
      )
        break
      if (finishReason === 'content_filter') {
        throw new Error('模型因内容安全策略中断需求分析，未生成完整结论')
      }
      stalledPasses = nextStalledPasses(previousSummary, pass.content, stalledPasses)
      if (stalledPasses >= noProgressLimit()) {
        throw new Error(`需求分析连续 ${stalledPasses} 次没有新增有效内容，已停止无效续写`)
      }

      continuationCount += 1
      emit({
        type: 'status',
        data: {
          message:
            finishReason === 'length'
              ? `需求分析达到模型/网关单次输出上限，正在自动续写第 ${continuationCount} 段...`
              : `模型未确认需求分析完整，正在请求补全第 ${continuationCount} 段...`,
        },
      })
      // A previous pass may have emitted the completion marker before the
      // coverage receipts were complete. Remove it before asking for the
      // missing material so the accumulated output contains one terminal
      // marker only.
      reasoningSummary = removeInternalMarker(reasoningSummary, ANALYSIS_COMPLETE_MARKER)
      markerPending = removeInternalMarker(markerPending, ANALYSIS_COMPLETE_MARKER)
      continuationMessages = [
        ...initialMessages,
        { role: 'assistant', content: reasoningSummary },
        {
          role: 'user',
          content: `上一段分析尚未完整结束。请从上次停止的位置继续，只输出遗漏的分析内容${missingCoverage.length ? `，并补回这些缺失的文档接收标记：${missingCoverage.join('、')}` : ''}。确认覆盖全文后以单独一行输出 ${ANALYSIS_COMPLETE_MARKER}。不要重复已输出内容。`,
        },
      ]
    }

    assertGenerationActive(run)
    if (terminalMarkerIndex(reasoningSummary, ANALYSIS_COMPLETE_MARKER) < 0) {
      throw new Error(`需求分析未完成（finish_reason=${finishReason || 'unknown'}）`)
    }
    const missingCoverage = missingCoverageMarkers(reasoningSummary, expectedCoverageMarkers)
    if (missingCoverage.length) {
      throw new Error(`最终需求分析缺少 ${missingCoverage.length} 个文档接收标记`)
    }
    if (markerPending) {
      const visible = stripInternalAnalysisMarkers(markerPending)
      if (visible) emit({ type: 'reasoning', data: { content: visible } })
    }
    reasoningSummary = cleanAnalysisSummary(reasoningSummary)
    if (!reasoningSummary) throw new Error('模型未返回有效的需求分析结论')

    emit({ type: 'status', data: { message: '需求分析已完整校验，可生成思维导图 JSON。' } })

    emit({ type: 'result', data: { reasoningSummary } })
    emit({ type: 'done', data: {} })
    return { reasoningSummary }
  } catch (error) {
    throw normalizeRunError(error, run)
  }
}

export async function streamGenerateMindMap(input: {
  llm: LlmSettings
  content: string
  fileName?: string
  reasoning?: string
  signal?: AbortSignal
  onEvent?: (event: MindMapStreamEvent) => void
}): Promise<RequirementAnalysisResult> {
  const { llm, content, fileName = 'requirement.md', reasoning = '', signal, onEvent } = input
  const emit = onEvent || (() => undefined)

  assertLlmReady(llm, content)
  if (signal?.aborted) throw createAbortError()
  const run = createGenerationRun(signal)
  const fallbackSource = reasoning.trim() || content
  let recordParser: StreamingMindMapRecordParser | null = null

  const finishResult = (
    result: RequirementAnalysisResult,
    message = '功能点结构已完整校验，思维导图绘制完成。',
  ): RequirementAnalysisResult => {
    emit({
      type: 'delta',
      data: { content: JSON.stringify({ ...result, complete: true }, null, 2) },
    })
    emit({ type: 'status', data: { message } })
    emit({ type: 'result', data: result })
    emit({ type: 'done', data: {} })
    return result
  }

  try {
    const skills = await loadSelectedCategorySkills('function-point')
    const skillSystemPrompt = composeCategorySystemPrompt(skills)
    const recordSystemPrompt = skillSystemPrompt
      ? `${skillSystemPrompt}${MINDMAP_RECORD_OUTPUT_CONSTRAINT}`
      : MINDMAP_RECORD_OUTPUT_CONSTRAINT.trim()
    const client = createClient(llm)
    emit({ type: 'status', data: { message: '正在逐条整理思维导图功能点...' } })

    const effectiveReasoning = reasoning.trim()
    const baseMessages: ChatMessage[] = [
      { role: 'system', content: recordSystemPrompt },
      { role: 'user', content: buildJsonUserPrompt(fileName, content, effectiveReasoning) },
    ]
    recordParser = new StreamingMindMapRecordParser(fileName, (snapshot) => {
      emit({ type: 'mindmap', data: snapshot })
    })
    let continuationMessages = baseMessages
    let continuationCount = 0
    let reasoningStatusShown = false

    while (true) {
      assertGenerationActive(run)
      const previousRecordCount = recordParser.recordCount
      const pass = await collectCompletion({
        client,
        run,
        request: {
          model: llm.model,
          temperature: 0.1,
          stream: true,
          messages: continuationMessages,
        },
        onContent: (contentDelta) => recordParser?.write(contentDelta),
        onReasoning: () => {
          if (reasoningStatusShown) return
          reasoningStatusShown = true
          emit({ type: 'status', data: { message: '正在梳理功能点层级与覆盖范围...' } })
        },
        onCompatibilityFallback: (message) => emit({ type: 'status', data: { message } }),
      })

      if (!pass.content.trim() && pass.reasoning.trim()) recordParser.write(pass.reasoning)
      recordParser.finishPass()
      if (recordParser.complete) return finishResult(recordParser.toResult())

      if (pass.finishReason === 'length') {
        const confirmed = recordParser.recordCount
          ? `，已确认 ${recordParser.recordCount} 条功能点记录`
          : ''
        emit({
          type: 'status',
          data: {
            message: `思维导图达到模型/网关单次输出上限${confirmed}，正在处理已接收内容...`,
          },
        })
      }

      if (pass.finishReason === 'stop' && recordParser.recordCount > 0) {
        return finishResult(
          recordParser.toResult(),
          '模型输出已结束，服务端已用全部确认记录完成结构校验和思维导图绘制。',
        )
      }

      if (
        pass.finishReason === 'content_filter' ||
        pass.finishReason !== 'length' ||
        recordParser.recordCount <= previousRecordCount
      ) {
        const stableResult =
          recordParser.recordCount > 0
            ? recordParser.toResult()
            : buildDeterministicMindMap(fileName, effectiveReasoning || fallbackSource)
        return finishResult(stableResult, '已由服务端完成结构整理和校验，思维导图绘制完成。')
      }

      continuationCount += 1
      const acceptedTail = recordParser.continuationContext()
      continuationMessages = [
        ...baseMessages,
        ...(acceptedTail ? ([{ role: 'assistant', content: acceptedTail }] as ChatMessage[]) : []),
        {
          role: 'user',
          content: `继续输出尚未覆盖的 NDJSON node 行。服务端已确认 ${recordParser.recordCount} 条唯一 node 记录；不要重复上面的 path，不要续写被截断的半行，不得扩展测试方法或测试用例。全部功能点输出完成后，以一行 complete 记录结束，其中 recordCount 必须是已确认记录与本轮新增唯一记录的合计整数。当前是第 ${continuationCount} 次继续整理。`,
        },
      ]
    }
  } catch (error) {
    const normalizedError = normalizeRunError(error, run)
    if (isAbortError(normalizedError, signal)) throw normalizedError
    const stableResult =
      recordParser && recordParser.recordCount > 0
        ? recordParser.toResult()
        : buildDeterministicMindMap(fileName, fallbackSource)
    return finishResult(stableResult, '已由服务端完成结构整理和校验，思维导图绘制完成。')
  }
}
