import type { TestCase } from '@/types/requirements'
import { formatStamp } from '@/utils/report'

export interface ImportedTestCases {
  title: string
  summary: string
  cases: TestCase[]
}

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

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeImportedSteps(value: unknown): string[] {
  if (Array.isArray(value)) {
    const steps = value.map((step) => String(step).trim()).filter(Boolean)
    return steps.length ? steps : ['']
  }

  if (typeof value === 'string') {
    const steps = value
      .split(/\r?\n/)
      .map((step) => step.replace(/^\s*\d+[.)、]\s*/, '').trim())
      .filter(Boolean)
    return steps.length ? steps : ['']
  }

  return ['']
}

export function normalizeImportedTestCases(raw: unknown): ImportedTestCases {
  const isBareArray = Array.isArray(raw)
  if (!isBareArray && (!raw || typeof raw !== 'object')) {
    throw new Error('JSON 内容无效：需要测试用例对象或数组')
  }

  const payload = isBareArray ? {} : (raw as Record<string, unknown>)
  const candidateCases = isBareArray ? raw : payload.cases
  if (!Array.isArray(candidateCases)) {
    throw new Error('JSON 格式不正确：未找到 cases 用例数组')
  }
  if (!candidateCases.length) {
    throw new Error('JSON 中没有可导入的测试用例')
  }

  const priorities = new Set(['P0', 'P1', 'P2', 'P3'])
  const cases = candidateCases.map((candidate, index): TestCase => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(`第 ${index + 1} 条测试用例格式不正确：需要对象结构`)
    }

    const item = candidate as Record<string, unknown>
    const priority = stringValue(item.priority).toUpperCase()
    const feature = stringValue(item.feature)
    const note = stringValue(item.note)

    return {
      id: stringValue(item.id) || `TC-${String(index + 1).padStart(3, '0')}`,
      feature,
      featurePath: stringValue(item.featurePath) || feature,
      title: stringValue(item.title) || `用例 ${index + 1}`,
      priority: priorities.has(priority) ? (priority as TestCase['priority']) : 'P1',
      type: stringValue(item.type) || '功能',
      preconditions: stringValue(item.preconditions),
      steps: normalizeImportedSteps(item.steps),
      expected: stringValue(item.expected),
      ...(note ? { note } : {}),
    }
  })

  return {
    title: stringValue(payload.title) || '导入的测试用例',
    summary: stringValue(payload.summary),
    cases,
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
    '3. 若环境、权限或缺少账号密码导致无法执行，明确阻塞原因，不要编造结果；若用例本身就是登录页/登录功能测试，不要因看到登录页就停下来要用户输入账号',
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
