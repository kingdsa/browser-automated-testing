import type { ChatMessageItem } from '@/types/chat'

export interface ReportMeta {
  targetUrl?: string
  model?: string
}

interface WritableStream {
  write: (data: string) => Promise<void>
  close: () => Promise<void>
}

interface FileHandleLike {
  createWritable: () => Promise<WritableStream>
}

interface SaveFilePickerOptions {
  suggestedName?: string
  types?: Array<{ description?: string; accept: Record<string, string[]> }>
}

interface WindowWithSavePicker extends Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileHandleLike>
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function formatStamp(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…（已截断，原始共 ${text.length} 字符）`
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function dataToString(data: unknown): string {
  if (data == null) return ''
  if (typeof data === 'string') return data
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

/**
 * 把当前会话组装成一份自包含的 Markdown 测试报告。
 * 包含：元信息、测试需求、测试结论、工具调用过程与证据（含内嵌截图）。
 */
export function buildMarkdownReport(messages: ChatMessageItem[], meta: ReportMeta): string {
  const lines: string[] = []
  const now = Date.now()
  const firstTs = messages[0]?.createdAt ?? now
  const lastTs = messages[messages.length - 1]?.createdAt ?? now

  lines.push('# 浏览器自动化测试报告', '')
  lines.push('| 项目 | 内容 |', '| --- | --- |')
  lines.push(`| 目标 URL | ${meta.targetUrl || '-'} |`)
  lines.push(`| 测试开始 | ${formatTime(firstTs)} |`)
  lines.push(`| 测试结束 | ${formatTime(lastTs)} |`)
  lines.push(`| 报告生成 | ${formatTime(now)} |`)
  lines.push(`| 使用模型 | ${meta.model || '-'} |`, '')

  const userMessages = messages.filter((m) => m.role === 'user' && m.content.trim())
  if (userMessages.length) {
    lines.push('## 测试需求', '')
    userMessages.forEach((m, i) => {
      lines.push(`**${i + 1}.** ${m.content.trim()}`, '')
    })
  }

  const assistantMessages = messages.filter((m) => m.role === 'assistant' && m.content.trim())
  if (assistantMessages.length) {
    lines.push('## 测试结论', '')
    assistantMessages.forEach((m, i) => {
      if (assistantMessages.length > 1) lines.push(`### 结论 ${i + 1}`, '')
      lines.push(m.content.trim(), '')
    })
  }

  const tools = messages.flatMap((m) => m.tools ?? [])
  if (tools.length) {
    lines.push('---', '', '## 测试过程与证据', '')
    tools.forEach((tool, i) => {
      const status = tool.status === 'running' ? '执行中' : tool.ok === false ? '失败' : '完成'
      lines.push(`### ${i + 1}. ${tool.name}`, '')
      lines.push(`- 状态：${status}`)
      if (tool.summary) lines.push(`- 摘要：${tool.summary}`)

      if (tool.arguments && tool.arguments.trim()) {
        lines.push('- 参数：', '```json', prettyJson(tool.arguments), '```')
      }

      const dataStr = dataToString(tool.data)
      if (dataStr.trim()) {
        lines.push('- 返回数据：', '```json', truncate(dataStr, 30000), '```')
      }

      if (tool.screenshotBase64) {
        lines.push(`![截图 ${i + 1}](data:image/png;base64,${tool.screenshotBase64})`, '')
      }
      lines.push('')
    })
  }

  lines.push('---', '')
  lines.push(`> 本报告由 Browser Automated Testing 自动生成 · ${formatTime(now)}`)

  return lines.join('\n')
}

/**
 * 保存 Markdown 内容到本地。
 * 优先使用 File System Access API（showSaveFilePicker）让用户选择文件夹与文件名；
 * 不支持时回退为浏览器默认下载（文件名可改，但目录由浏览器决定）。
 *
 * @returns 'picked' 选择了保存位置；'downloaded' 走默认下载；用户取消时抛出 AbortError。
 */
export async function saveMarkdownFile(
  content: string,
  suggestedName = 'test-report.md',
): Promise<'picked' | 'downloaded'> {
  const win = window as unknown as WindowWithSavePicker

  if (typeof win.showSaveFilePicker === 'function') {
    const handle = await win.showSaveFilePicker({
      suggestedName,
      types: [{ description: 'Markdown 文档', accept: { 'text/markdown': ['.md'] } }],
    })
    const writable = await handle.createWritable()
    await writable.write(content)
    await writable.close()
    return 'picked'
  }

  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = suggestedName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return 'downloaded'
}

export function defaultReportName(now = Date.now()): string {
  return `browser-test-report-${formatStamp(now)}.md`
}
