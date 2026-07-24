import OpenAI from 'openai'
import { z } from 'zod'
import type { LlmSettings } from '../types/index.js'

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

export interface FeaturePoint {
  path: string
  text: string
  note?: string
  tags?: string[]
}

export type TestCasePriority = 'P0' | 'P1' | 'P2' | 'P3'

export interface TestCase {
  id: string
  feature: string
  featurePath: string
  title: string
  priority: TestCasePriority
  type: string
  preconditions: string
  steps: string[]
  expected: string
  note?: string
}

export interface GenerateTestCasesResult {
  title: string
  summary: string
  cases: TestCase[]
  caseCount: number
}

export type TestCaseStreamEvent =
  | { type: 'status'; data: { message: string } }
  | { type: 'delta'; data: { content: string } }
  | { type: 'result'; data: GenerateTestCasesResult }
  | { type: 'error'; data: { message: string } }
  | { type: 'done'; data: Record<string, never> }

const prioritySchema = z.enum(['P0', 'P1', 'P2', 'P3'])

const testCaseSchema = z.object({
  id: z.string().optional(),
  feature: z.string().min(1),
  featurePath: z.string().optional(),
  title: z.string().min(1),
  priority: prioritySchema.optional().default('P1'),
  type: z.string().optional().default('功能'),
  preconditions: z.string().optional().default(''),
  steps: z.array(z.string()).min(1),
  expected: z.string().min(1),
  note: z.string().optional(),
})

const responseSchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional().default(''),
  cases: z.array(testCaseSchema).min(1),
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

function flattenFeatures(node: MindMapNode | null | undefined, path: string[] = [], acc: FeaturePoint[] = []): FeaturePoint[] {
  if (!node) return acc
  const nextPath = [...path, String(node.data?.text || '').trim() || '未命名功能']
  if (path.length > 0) {
    acc.push({
      path: nextPath.join(' / '),
      text: nextPath[nextPath.length - 1] || '未命名功能',
      note: node.data?.note,
      tags: Array.isArray(node.data?.tag) ? node.data.tag : undefined,
    })
  }
  for (const child of node.children || []) {
    flattenFeatures(child, nextPath, acc)
  }
  return acc
}

function makeCaseId(index: number): string {
  return `TC-${String(index + 1).padStart(3, '0')}`
}

function normalizeCases(
  cases: Array<z.infer<typeof testCaseSchema>>,
  features: FeaturePoint[],
): TestCase[] {
  const featureByText = new Map(features.map((item) => [item.text, item]))
  return cases.map((item, index) => {
    const matched = featureByText.get(item.feature)
    const featurePath = item.featurePath?.trim() || matched?.path || item.feature
    const steps = item.steps.map((step) => String(step).trim()).filter(Boolean)
    return {
      id: item.id?.trim() || makeCaseId(index),
      feature: item.feature.trim(),
      featurePath,
      title: item.title.trim().slice(0, 120),
      priority: item.priority || 'P1',
      type: (item.type || '功能').trim().slice(0, 20) || '功能',
      preconditions: (item.preconditions || '').trim().slice(0, 500),
      steps: steps.length ? steps.slice(0, 20).map((step) => step.slice(0, 300)) : ['执行与功能点相关的操作'],
      expected: item.expected.trim().slice(0, 500),
      ...(item.note?.trim() ? { note: item.note.trim().slice(0, 500) } : {}),
    }
  })
}

function fallbackCases(title: string, features: FeaturePoint[]): GenerateTestCasesResult {
  const cases: TestCase[] = features.flatMap((feature, index) => {
    const baseId = makeCaseId(index * 2)
    const baseIdAlt = makeCaseId(index * 2 + 1)
    const priority = (feature.tags || []).find((tag) => /^P[0-3]$/i.test(tag))?.toUpperCase() as TestCasePriority | undefined
    const main: TestCase = {
      id: baseId,
      feature: feature.text,
      featurePath: feature.path,
      title: `${feature.text} - 正常流程`,
      priority: priority || 'P1',
      type: '功能',
      preconditions: feature.note || '系统可用，用户已具备相应权限',
      steps: [
        `进入与「${feature.text}」相关的页面/入口`,
        `按照需求完成「${feature.text}」的主流程操作`,
        '检查页面反馈与数据结果',
      ],
      expected: `「${feature.text}」按预期完成，界面反馈正确，数据一致`,
      ...(feature.note ? { note: feature.note } : {}),
    }
    const negative: TestCase = {
      id: baseIdAlt,
      feature: feature.text,
      featurePath: feature.path,
      title: `${feature.text} - 异常/边界`,
      priority: priority === 'P0' ? 'P0' : 'P2',
      type: '异常',
      preconditions: '系统可用；准备非法/缺失/边界输入数据',
      steps: [
        `进入「${feature.text}」相关入口`,
        '使用空值、超长、非法格式或无权限等异常条件操作',
        '观察校验提示与系统稳定性',
      ],
      expected: '系统给出明确错误/校验提示，不出现崩溃或脏数据',
    }
    return [main, negative]
  })

  return {
    title: `${title || '需求'}测试用例`,
    summary: `基于 ${features.length} 个功能点自动生成基础测试用例（模型不可用时的降级结果）`,
    cases,
    caseCount: cases.length,
  }
}

function buildPrompt(input: {
  title: string
  summary?: string
  features: FeaturePoint[]
}): string {
  const featureJson = JSON.stringify(input.features.slice(0, 80), null, 2)
  return `请根据以下功能点列表，生成可执行的软件测试用例，只输出合法 JSON，不要 markdown 代码块，不要额外解释。

JSON 结构必须是：
{
  "title": "测试用例集标题",
  "summary": "一句话说明覆盖范围",
  "cases": [
    {
      "id": "TC-001",
      "feature": "功能点名称",
      "featurePath": "模块 / 功能点",
      "title": "用例标题",
      "priority": "P0|P1|P2|P3",
      "type": "功能|异常|边界|权限|兼容",
      "preconditions": "前置条件",
      "steps": ["步骤1", "步骤2"],
      "expected": "期望结果",
      "note": "可选备注"
    }
  ]
}

生成规则：
1. 每个功能点至少 1 条主流程用例；关键功能补充 1 条异常/边界用例。
2. 用例要具体、可执行，避免空泛描述。
3. steps 用有序操作步骤，expected 写可验证结果。
4. priority 优先参考功能点 tags；没有则按业务重要性判断。
5. 总数建议控制在 ${Math.min(Math.max(input.features.length, 8), 40)} 条左右，不要滥造。
6. feature / featurePath 必须能对应到输入功能点。

需求标题：${input.title || '未命名需求'}
需求摘要：${input.summary || '无'}

功能点列表 JSON：
${featureJson}`
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
    name === 'AbortError' ||
    name === 'APIUserAbortError' ||
    /aborted|abort|cancel/i.test(message)
  )
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

function assertLlmReady(llm: LlmSettings) {
  if (!llm.apiKey?.trim()) throw new Error('请先配置 API Key')
  if (!llm.baseUrl?.trim()) throw new Error('请先配置 Base URL')
  if (!llm.model?.trim()) throw new Error('请先配置模型名称')
}

function parseTestCaseResult(raw: string, title: string, features: FeaturePoint[]): GenerateTestCasesResult {
  if (!raw.trim()) throw new Error('模型未返回测试用例')

  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(raw))
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('模型返回非 JSON')
    parsed = JSON.parse(match[0])
  }

  const validated = responseSchema.safeParse(parsed)
  if (!validated.success) throw new Error('模型返回结构不完整')

  const cases = normalizeCases(validated.data.cases, features)
  return {
    title: validated.data.title.trim() || `${title}测试用例`,
    summary: validated.data.summary.trim() || `覆盖 ${features.length} 个功能点，共 ${cases.length} 条用例`,
    cases,
    caseCount: cases.length,
  }
}

export async function generateTestCasesFromFeatures(input: {
  llm: LlmSettings
  title?: string
  summary?: string
  root?: MindMapNode | null
  features?: FeaturePoint[]
}): Promise<GenerateTestCasesResult> {
  return streamGenerateTestCasesFromFeatures({
    ...input,
    onEvent: () => undefined,
  })
}

export async function streamGenerateTestCasesFromFeatures(input: {
  llm: LlmSettings
  title?: string
  summary?: string
  root?: MindMapNode | null
  features?: FeaturePoint[]
  signal?: AbortSignal
  onEvent?: (event: TestCaseStreamEvent) => void
}): Promise<GenerateTestCasesResult> {
  const { llm, signal } = input
  const emit = input.onEvent || (() => undefined)
  assertLlmReady(llm)
  if (signal?.aborted) throw createAbortError()

  const features =
    input.features && input.features.length
      ? input.features
      : flattenFeatures(input.root || null)

  if (!features.length) throw new Error('请先生成或导入功能点')

  const title = input.title?.trim() || '需求功能点'
  const summary = input.summary?.trim() || ''
  const client = createClient(llm)

  emit({ type: 'status', data: { message: `正在根据 ${features.length} 个功能点生成测试用例...` } })

  try {
    const stream = await client.chat.completions.create(
      {
        model: llm.model,
        temperature: 0.2,
        stream: true,
        messages: [
          {
            role: 'system',
            content:
              '你是资深测试架构师，擅长把功能点拆解为可执行、可回归的测试用例。始终只输出合法 JSON。',
          },
          {
            role: 'user',
            content: buildPrompt({ title, summary, features }),
          },
        ],
      },
      { signal },
    )

    let raw = ''
    for await (const chunk of stream) {
      if (signal?.aborted) throw createAbortError()
      const delta = chunk.choices?.[0]?.delta?.content
      if (!delta) continue
      raw += delta
      emit({ type: 'delta', data: { content: delta } })
    }

    if (signal?.aborted) throw createAbortError()

    emit({ type: 'status', data: { message: '模型输出完成，正在解析测试用例...' } })
    const result = parseTestCaseResult(raw, title, features)
    emit({ type: 'result', data: result })
    emit({ type: 'done', data: {} })
    return result
  } catch (error) {
    if (isAbortError(error, signal)) {
      throw createAbortError()
    }
    // Keep product usable even when model output is unstable.
    const fallback = fallbackCases(title, features)
    const reason = error instanceof Error ? error.message : String(error)
    const result = {
      ...fallback,
      summary: `${fallback.summary}；原因：${reason}`,
    }
    emit({ type: 'status', data: { message: `模型结果不稳定，已使用降级用例：${reason}` } })
    emit({ type: 'result', data: result })
    emit({ type: 'done', data: {} })
    return result
  }
}
