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

export interface RequirementAnalysisResult {
  title: string
  summary: string
  root: MindMapNode
  featureCount: number
}

export type RequirementStreamEvent =
  | { type: 'status'; data: { message: string } }
  | { type: 'delta'; data: { content: string } }
  | { type: 'result'; data: RequirementAnalysisResult }
  | { type: 'error'; data: { message: string } }
  | { type: 'done'; data: Record<string, never> }

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
    ? node.data.tag.map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
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

function buildPrompt(fileName: string, content: string): string {
  const clipped = content.length > 28000 ? `${content.slice(0, 28000)}\n\n...(内容过长，已截断)` : content
  return `请分析以下需求文档，提取产品功能点，并输出思维导图 JSON。

要求：
1. 只输出合法 JSON，不要 markdown 代码块，不要额外解释。
2. JSON 结构必须是：
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
3. 根节点 text 用产品/模块总称；children 按“模块 -> 功能 -> 子功能/规则”分层。
4. 每个功能点 text 简洁（<= 20 字），必要时用 note 补充验收点/业务规则。
5. 优先提取可测试、可实现的功能点，忽略纯排版/目录噪音。
6. 至少输出 5 个功能点；如果文档很短，也尽量结构化拆分。

文件名：${fileName || '未命名需求文档'}

需求文档内容：
${clipped}`
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
    name === 'AbortError' ||
    name === 'APIUserAbortError' ||
    /aborted|abort|cancel/i.test(message)
  )
}

function assertLlmReady(llm: LlmSettings, content: string) {
  if (!llm.apiKey?.trim()) throw new Error('请先配置 API Key')
  if (!llm.baseUrl?.trim()) throw new Error('请先配置 Base URL')
  if (!llm.model?.trim()) throw new Error('请先配置模型名称')
  if (!content.trim()) throw new Error('需求文档内容为空')
}

function parseAnalysisResult(raw: string, fileName: string, content: string): RequirementAnalysisResult {
  if (!raw.trim()) throw new Error('模型未返回分析结果')

  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(raw))
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) {
      const title = fileName.replace(/\.[^.]+$/, '') || '需求功能点'
      const root = fallbackTree(title, '模型返回非 JSON，已降级为文本拆分', content)
      return {
        title,
        summary: '模型返回非 JSON，已降级为文本拆分',
        root,
        featureCount: countFeatures(root),
      }
    }
    parsed = JSON.parse(match[0])
  }

  const validated = analysisSchema.safeParse(parsed)
  if (!validated.success) {
    const title = fileName.replace(/\.[^.]+$/, '') || '需求功能点'
    const root = fallbackTree(title, '模型结构不完整，已降级为文本拆分', content)
    return {
      title,
      summary: '模型结构不完整，已降级为文本拆分',
      root,
      featureCount: countFeatures(root),
    }
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

  const client = createClient(llm)
  emit({ type: 'status', data: { message: '正在调用模型分析需求功能点...' } })

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
              '你是资深产品经理与测试分析师，擅长把需求文档拆解为可测试的功能点树。始终只输出合法 JSON。',
          },
          {
            role: 'user',
            content: buildPrompt(fileName, content),
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

    emit({ type: 'status', data: { message: '模型输出完成，正在解析功能点结构...' } })
    const result = parseAnalysisResult(raw, fileName, content)
    emit({ type: 'result', data: result })
    emit({ type: 'done', data: {} })
    return result
  } catch (error) {
    if (isAbortError(error, signal)) throw createAbortError()
    throw error
  }
}
