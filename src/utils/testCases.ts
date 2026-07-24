import type { TestCase } from '@/types/requirements'
import { formatStamp } from '@/utils/report'

export function defaultTestCaseExportName(title = 'test-cases', now = Date.now()): string {
  const safe = (title || 'test-cases').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
  return `${safe}-${formatStamp(now)}`
}

export function testCasesToMarkdown(input: {
  title: string
  summary?: string
  cases: TestCase[]
}): string {
  const lines: string[] = []
  lines.push(`# ${input.title || '测试用例'}`)
  lines.push('')
  if (input.summary?.trim()) {
    lines.push(`> ${input.summary.trim()}`)
    lines.push('')
  }
  lines.push(`- 用例数：${input.cases.length}`)
  lines.push(`- 导出时间：${new Date().toLocaleString()}`)
  lines.push('')

  input.cases.forEach((item, index) => {
    lines.push(`## ${index + 1}. ${item.id} ${item.title}`)
    lines.push('')
    lines.push(`- 功能点：${item.feature}`)
    if (item.featurePath) lines.push(`- 路径：${item.featurePath}`)
    lines.push(`- 优先级：${item.priority}`)
    lines.push(`- 类型：${item.type}`)
    if (item.preconditions) lines.push(`- 前置条件：${item.preconditions}`)
    lines.push('- 步骤：')
    item.steps.forEach((step, stepIndex) => {
      lines.push(`  ${stepIndex + 1}. ${step}`)
    })
    lines.push(`- 期望结果：${item.expected}`)
    if (item.note) lines.push(`- 备注：${item.note}`)
    lines.push('')
  })

  return lines.join('\n')
}

export function downloadTextFile(content: string, fileName: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export function createEmptyTestCase(index = 0, feature = ''): TestCase {
  return {
    id: `TC-${String(index + 1).padStart(3, '0')}`,
    feature,
    featurePath: feature,
    title: '',
    priority: 'P1',
    type: '功能',
    preconditions: '',
    steps: [''],
    expected: '',
  }
}

export const TEST_CASE_FILE_ACCEPT =
  '.md,.markdown,.txt,.text,.json,.csv,.log,text/plain,text/markdown,application/json'

export const MAX_TEST_CASE_FILE_BYTES = 800 * 1024

export function isSupportedTestCaseFile(file: File): boolean {
  return /\.(md|markdown|txt|text|json|csv|log)$/i.test(file.name)
}

/** Prefer readable Markdown for the model when JSON export is uploaded. */
export function normalizeTestCaseContent(fileName: string, raw: string): string {
  const trimmed = raw.replace(/^\uFEFF/, '').trim()
  if (!trimmed) return ''

  if (!/\.json$/i.test(fileName)) return trimmed

  try {
    const data = JSON.parse(trimmed) as {
      title?: string
      summary?: string
      cases?: Array<{
        id?: string
        feature?: string
        featurePath?: string
        title?: string
        priority?: string
        type?: string
        preconditions?: string
        steps?: string[]
        expected?: string
        note?: string
      }>
    }

    if (!Array.isArray(data.cases) || !data.cases.length) return trimmed

    return testCasesToMarkdown({
      title: data.title || fileName,
      summary: data.summary,
      cases: data.cases.map((item, index) => ({
        id: item.id || `TC-${String(index + 1).padStart(3, '0')}`,
        feature: item.feature || '',
        featurePath: item.featurePath || item.feature || '',
        title: item.title || '',
        priority: (item.priority as 'P0' | 'P1' | 'P2' | 'P3') || 'P1',
        type: item.type || '功能',
        preconditions: item.preconditions || '',
        steps: Array.isArray(item.steps) && item.steps.length ? item.steps.map(String) : [''],
        expected: item.expected || '',
        note: item.note,
      })),
    })
  } catch {
    return trimmed
  }
}

export function buildPromptWithTestCase(prompt: string, attachment: { fileName: string; content: string }): string {
  const userPrompt = prompt.trim()
  const body = attachment.content.trim()
  return [
    userPrompt,
    '',
    '---',
    `【测试用例附件：${attachment.fileName}】`,
    '请将下方测试用例作为本次浏览器测试的执行清单：',
    '1. 按用例优先级与顺序逐条覆盖（P0 > P1 > P2 > P3）',
    '2. 每条用例记录：通过 / 失败 / 阻塞，以及证据（截图、接口、控制台、选择器）',
    '3. 若环境或登录态导致无法执行，明确阻塞原因，不要编造结果',
    '4. 最终 Markdown 报告需包含「用例执行对照表」与未覆盖项',
    '',
    body,
  ].join('\n')
}

export function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

