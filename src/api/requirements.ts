import type { LlmSettings } from '@/types/chat'
import type {
  FeaturePoint,
  GenerateTestCasesResult,
  MindMapNode,
  RequirementAnalysisResult,
} from '@/types/requirements'

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

export async function generateTestCases(input: {
  llm: LlmSettings
  title?: string
  summary?: string
  root?: MindMapNode | null
  features?: FeaturePoint[]
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
    }),
  })

  const data = (await res.json().catch(() => ({}))) as GenerateTestCasesResult & { error?: string }
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `测试用例生成失败: HTTP ${res.status}`)
  }
  return data
}
