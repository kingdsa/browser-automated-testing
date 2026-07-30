import OpenAI from 'openai'
import { z } from 'zod'
import type { LlmSettings } from '../types/index.js'
import {
  composeCategorySystemPrompt,
  loadSelectedCategorySkills,
  type CategorySkillMeta,
} from '../skills/loader.js'
import { StreamingMindMapParser, type MindMapProgressSnapshot } from './streamMindMap.js'

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

export type RequirementStreamEvent =
  | { type: 'status'; data: { message: string } }
  | { type: 'reasoning'; data: { content: string } }
  | { type: 'delta'; data: { content: string } }
  | { type: 'mindmap'; data: MindMapProgressSnapshot }
  | { type: 'result'; data: RequirementAnalysisResult }
  | { type: 'error'; data: { message: string } }
  | { type: 'done'; data: Record<string, never> }
  | { type: 'skills'; data: { skills: CategorySkillMeta[] } }

const mindMapNodeSchema: z.ZodType<MindMapNode> = z.lazy(() =>
  z.object({
    data: z.object({
      text: z.string().min(1),
      note: z.string().optional(),
      tag: z.array(z.string()).optional(),
      expand: z.boolean().optional(),
    }),
    children: z.array(mindMapNodeSchema).optional(),
  }),
)

const analysisSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  root: mindMapNodeSchema,
})

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return trimmed
  if (trimmed.endsWith('/v1')) return trimmed
  if (/\/v\d+$/.test(trimmed)) return trimmed
  return `${trimmed}/v1`
}

function stripCodeFence(content: string): string {
  const trimmed = content.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return (fenced?.[1] || trimmed).trim()
}

function countFeatures(node: MindMapNode, isRoot = true): number {
  const self = isRoot ? 0 : 1
  const children = node.children || []
  return self + children.reduce((sum, child) => sum + countFeatures(child, false), 0)
}

function sanitizeNode(node: MindMapNode, depth = 0): MindMapNode {
  const text = String(node.data?.text || '').trim() || (depth === 0 ? '需求功能点' : '未命名功能')
  const note = node.data?.note?.trim()
  const tag = Array.isArray(node.data?.tag)
    ? node.data.tag
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 5)
    : undefined
  const children = Array.isArray(node.children)
    ? node.children.map((child) => sanitizeNode(child, depth + 1))
    : []

  return {
    data: {
      text: text.slice(0, 80),
      ...(note ? { note: note.slice(0, 500) } : {}),
      ...(tag?.length ? { tag } : {}),
      expand: node.data?.expand !== false,
    },
    children,
  }
}

function fallbackTree(title: string, summary: string, source: string): MindMapNode {
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12)

  return {
    data: { text: title || '需求功能点', note: summary, expand: true },
    children: lines.map((line) => ({
      data: {
        text: line.replace(/^[-*#\d.\s]+/, '').slice(0, 60) || '功能点',
        expand: true,
      },
      children: [],
    })),
  }
}

function clipRequirement(content: string): string {
  return content.length > 28000 ? `${content.slice(0, 28000)}\n\n...(内容过长，已截断)` : content
}

const JSON_OUTPUT_CONSTRAINT = `

---

## 输出格式（强制约束，覆盖以上任何 Markdown / 思维导图格式要求）

最终必须只输出一段合法 JSON（不要 markdown 代码块，不要任何额外解释文字）。

JSON 结构必须是：
{
  "title": "文档/产品标题",
  "summary": "一句话摘要",
  "root": {
    "data": { "text": "根节点名称", "note": "可选说明", "tag": ["可选标签"], "expand": true },
    "children": [
      {
        "data": { "text": "模块/功能点", "note": "简要说明", "tag": ["P0|P1|P2"], "expand": true },
        "children": []
      }
    ]
  }
}

约束：
- 根节点 text 用产品/模块总称；children 按"模块 -> 功能 -> 子功能/规则"分层。
- 每个功能点 text 简洁（<= 20 字），必要时用 note 补充验收点/业务规则。
- 至少输出 5 个功能点；如果文档很短，也尽量结构化拆分。
- 只关注黑盒行为，不假设数据库表、API 字段、代码结构。`

function buildReasoningUserPrompt(fileName: string, content: string): string {
  return `文件名：${fileName || '未命名需求文档'}

需求文档内容：
${clipRequirement(content)}`
}

function buildJsonUserPrompt(fileName: string, content: string, reasoningSummary = ''): string {
  const reasoningContext = reasoningSummary.trim()
    ? `\n\n前置分析摘要（仅用于辅助结构化，不要原样输出）：\n${reasoningSummary.slice(0, 8000)}`
    : ''
  return `文件名：${fileName || '未命名需求文档'}

需求文档内容：
${clipRequirement(content)}${reasoningContext}`
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

function parseAnalysisResult(
  raw: string,
  fileName: string,
  content: string,
  options?: {
    fallbackSnapshot?: MindMapProgressSnapshot | null
    onFallback?: (reason: string) => void
  },
): RequirementAnalysisResult {
  const fallbackSnapshot = options?.fallbackSnapshot ?? null
  const onFallback = options?.onFallback
  const fallbackTitle = fileName.replace(/\.[^.]+$/, '') || '需求功能点'

  // 优先用渐进式快照兜底（结构完整），没有快照则降级为文本拆分（扁平列表）
  const degrade = (snapshotReason: string, textSplitSummary: string): RequirementAnalysisResult => {
    if (fallbackSnapshot) {
      onFallback?.(snapshotReason)
      return {
        title: fallbackSnapshot.title,
        summary: fallbackSnapshot.summary,
        root: fallbackSnapshot.root,
        featureCount: fallbackSnapshot.featureCount,
      }
    }
    onFallback?.(textSplitSummary)
    const root = fallbackTree(fallbackTitle, textSplitSummary, content)
    return { title: fallbackTitle, summary: textSplitSummary, root, featureCount: countFeatures(root) }
  }

  if (!raw.trim()) {
    if (fallbackSnapshot) {
      onFallback?.('模型未返回 content，已启用渐进式快照兜底')
      return {
        title: fallbackSnapshot.title,
        summary: fallbackSnapshot.summary,
        root: fallbackSnapshot.root,
        featureCount: fallbackSnapshot.featureCount,
      }
    }
    throw new Error('模型未返回分析结果')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(raw))
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) {
      return degrade('模型返回非 JSON，已启用渐进式快照兜底', '模型返回非 JSON，已降级为文本拆分')
    }
    try {
      parsed = JSON.parse(match[0])
    } catch {
      // 提取出的 JSON 片段仍有语法错误（通常是模型输出被截断），走兜底
      return degrade('JSON 语法错误，已启用渐进式快照兜底', '模型返回非合法 JSON，已降级为文本拆分')
    }
  }

  const validated = analysisSchema.safeParse(parsed)
  if (!validated.success) {
    return degrade('模型结构不完整，已启用渐进式快照兜底', '模型结构不完整，已降级为文本拆分')
  }

  const root = sanitizeNode(validated.data.root)
  return {
    title: validated.data.title.trim(),
    summary: validated.data.summary.trim(),
    root,
    featureCount: countFeatures(root),
  }
}

export async function analyzeRequirementDocument(input: {
  llm: LlmSettings
  content: string
  fileName?: string
}): Promise<RequirementAnalysisResult> {
  return streamAnalyzeRequirementDocument({
    ...input,
    onEvent: () => undefined,
  })
}

export async function streamAnalyzeRequirementDocument(input: {
  llm: LlmSettings
  content: string
  fileName?: string
  signal?: AbortSignal
  onEvent?: (event: RequirementStreamEvent) => void
}): Promise<RequirementAnalysisResult> {
  const { llm, content, fileName = 'requirement.md', signal, onEvent } = input
  const emit = onEvent || (() => undefined)

  assertLlmReady(llm, content)
  if (signal?.aborted) throw createAbortError()

  const skills = await loadSelectedCategorySkills('function-point')
  emit({ type: 'skills', data: { skills } })

  const skillSystemPrompt = composeCategorySystemPrompt(skills)
  const jsonSystemPrompt = skillSystemPrompt
    ? `${skillSystemPrompt}${JSON_OUTPUT_CONSTRAINT}`
    : JSON_OUTPUT_CONSTRAINT.trim()

  const client = createClient(llm)
  emit({ type: 'status', data: { message: 'AI 正在梳理需求目标、业务规则和测试边界...' } })

  try {
    const reasoningStream = skillSystemPrompt
      ? await client.chat.completions.create(
          {
            model: llm.model,
            temperature: 0.2,
            stream: true,
            messages: [
              { role: 'system', content: skillSystemPrompt },
              { role: 'user', content: buildReasoningUserPrompt(fileName, content) },
            ],
          },
          { signal },
        )
      : null

    let reasoningSummary = ''
    if (reasoningStream) {
      for await (const chunk of reasoningStream) {
        if (signal?.aborted) throw createAbortError()
        const choiceDelta = chunk.choices?.[0]?.delta
        if (!choiceDelta) continue

        const nativeReasoning = extractCompatibleReasoning(choiceDelta)
        if (nativeReasoning) {
          emit({ type: 'reasoning', data: { content: nativeReasoning } })
        }

        const contentDelta = choiceDelta.content
        if (!contentDelta) continue
        reasoningSummary += contentDelta
        emit({ type: 'reasoning', data: { content: contentDelta } })
      }

      if (signal?.aborted) throw createAbortError()
      emit({ type: 'status', data: { message: '分析过程完成，正在生成思维导图 JSON...' } })
    } else {
      emit({
        type: 'status',
        data: { message: '未加载 function-point skill，直接生成 JSON...' },
      })
    }

    const jsonStream = await client.chat.completions.create(
      {
        model: llm.model,
        temperature: 0.2,
        stream: true,
        messages: [
          { role: 'system', content: jsonSystemPrompt },
          { role: 'user', content: buildJsonUserPrompt(fileName, content, reasoningSummary) },
        ],
      },
      { signal },
    )

    let raw = ''
    let reasoningRaw = ''
    let lastSnapshot: MindMapProgressSnapshot | null = null
    const progressiveParser = new StreamingMindMapParser((snapshot) => {
      lastSnapshot = snapshot
      emit({ type: 'mindmap', data: snapshot })
    })
    for await (const chunk of jsonStream) {
      if (signal?.aborted) throw createAbortError()
      const choiceDelta = chunk.choices?.[0]?.delta
      if (!choiceDelta) continue

      const nativeReasoning = extractCompatibleReasoning(choiceDelta)
      if (nativeReasoning) {
        emit({ type: 'reasoning', data: { content: nativeReasoning } })
        reasoningRaw += nativeReasoning
      }

      if (!choiceDelta.content) continue
      raw += choiceDelta.content
      emit({ type: 'delta', data: { content: choiceDelta.content } })
      progressiveParser.write(choiceDelta.content)
    }

    if (signal?.aborted) throw createAbortError()

    emit({ type: 'status', data: { message: '模型输出完成，正在解析功能点结构...' } })

    // 兜底：部分模型/网关会把 JSON 全部输出到 reasoning 通道（content 一直为空），
    // 此时用 reasoning 累加值参与解析，避免误报"模型未返回分析结果"。
    // parseAnalysisResult 内部已对非纯 JSON（带思考文本、代码块）做了容错。
    const effectiveRaw = raw.trim() ? raw : reasoningRaw
    if (!raw.trim() && reasoningRaw.trim()) {
      emit({
        type: 'status',
        data: { message: '检测到输出走 reasoning 通道，已启用兜底解析...' },
      })
    }
    const result = parseAnalysisResult(effectiveRaw, fileName, content, {
      fallbackSnapshot: lastSnapshot,
      onFallback: (reason) => emit({ type: 'status', data: { message: reason } }),
    })
    emit({ type: 'result', data: result })
    emit({ type: 'done', data: {} })
    return result
  } catch (error) {
    if (isAbortError(error, signal)) throw createAbortError()
    throw error
  }
}
