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
