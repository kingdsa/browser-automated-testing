import type { LlmSettings } from '@/types/chat'
import type {
  FeaturePoint,
  GenerateTestCasesResult,
  MindMapNode,
  RequirementAnalysisResult,
} from '@/types/requirements'

export interface StreamHandlers {
  onEvent: (type: string, data: unknown) => void
  signal?: AbortSignal
}

function parseSseEvent(raw: string, onEvent: (type: string, data: unknown) => void) {
  const lines = raw.split(/\r?\n/)
  let eventType = 'message'
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('event:')) eventType = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }

  if (!dataLines.length) return
  const dataText = dataLines.join('\n')
  try {
    onEvent(eventType, JSON.parse(dataText))
  } catch {
    onEvent(eventType, { raw: dataText })
  }
}

async function consumeSseStream(response: Response, handlers: StreamHandlers) {
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `请求失败: HTTP ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let splitIndex = buffer.indexOf('\n\n')
    while (splitIndex !== -1) {
      const rawEvent = buffer.slice(0, splitIndex)
      buffer = buffer.slice(splitIndex + 2)
      parseSseEvent(rawEvent, handlers.onEvent)
      splitIndex = buffer.indexOf('\n\n')
    }
  }

  if (buffer.trim()) parseSseEvent(buffer, handlers.onEvent)
}

export async function analyzeRequirement(input: {
  llm: LlmSettings
  content?: string
  fileName?: string
  file?: File | null
}): Promise<RequirementAnalysisResult> {
  const form = new FormData()
  form.append('llm', JSON.stringify(input.llm))
  if (input.content?.trim()) form.append('content', input.content)
  if (input.fileName?.trim()) form.append('fileName', input.fileName)
  if (input.file) form.append('file', input.file)

  const res = await fetch('/api/requirements/analyze', {
    method: 'POST',
    body: form,
  })

  const data = (await res.json().catch(() => ({}))) as RequirementAnalysisResult & { error?: string }
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `需求分析失败: HTTP ${res.status}`)
  }
  return data
}

export async function streamAnalyzeRequirement(input: {
  llm: LlmSettings
  content?: string
  fileName?: string
  file?: File | null
  handlers: StreamHandlers
}): Promise<void> {
  const form = new FormData()
  form.append('llm', JSON.stringify(input.llm))
  if (input.content?.trim()) form.append('content', input.content)
  if (input.fileName?.trim()) form.append('fileName', input.fileName)
  if (input.file) form.append('file', input.file)

  const response = await fetch('/api/requirements/analyze/stream', {
    method: 'POST',
    body: form,
    signal: input.handlers.signal,
  })

  await consumeSseStream(response, input.handlers)
}

export async function extractRequirementFile(file: File): Promise<{
  ok: boolean
  fileName: string
  content: string
  contentLength: number
}> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/requirements/extract', {
    method: 'POST',
    body: form,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `文档解析失败: HTTP ${res.status}`)
  }
  return data
}

export interface TestCaseSessionConfig {
  targetUrl?: string
  headless?: boolean
  maxSteps?: number
  browserMode?: 'auto' | 'launch' | 'attach'
  cdpEndpoint?: string
  attachUrlIncludes?: string
  waitForLogin?: boolean
  loginWaitSeconds?: number
}

export async function generateTestCases(input: {
  llm: LlmSettings
  title?: string
  summary?: string
  root?: MindMapNode | null
  features?: FeaturePoint[]
  session?: TestCaseSessionConfig
}): Promise<GenerateTestCasesResult> {
  const res = await fetch('/api/requirements/test-cases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      llm: input.llm,
      title: input.title,
      summary: input.summary,
      root: input.root,
      features: input.features,
      session: input.session,
    }),
  })

  const data = (await res.json().catch(() => ({}))) as GenerateTestCasesResult & { error?: string }
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `测试用例生成失败: HTTP ${res.status}`)
  }
  return data
}

export async function streamGenerateTestCases(input: {
  llm: LlmSettings
  title?: string
  summary?: string
  root?: MindMapNode | null
  features?: FeaturePoint[]
  session?: TestCaseSessionConfig
  handlers: StreamHandlers
}): Promise<void> {
  const response = await fetch('/api/requirements/test-cases/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      llm: input.llm,
      title: input.title,
      summary: input.summary,
      root: input.root,
      features: input.features,
      session: input.session,
    }),
    signal: input.handlers.signal,
  })

  await consumeSseStream(response, input.handlers)
}
