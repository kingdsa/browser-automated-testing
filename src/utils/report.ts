import type { ChatMessageItem } from '@/types/chat'

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

export function formatStamp(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

/**
 * 仅提取最终 Markdown 报告（report 分段）。
 * 过程分析 / 工具日志不参与保存。
 * 兼容旧消息：没有 segments 时回退到整段 assistant content。
 */
export function getLastAssistantMarkdown(messages: ChatMessageItem[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!message || message.role !== 'assistant' || message.streaming) continue

    const segments = message.segments || []
    if (segments.length) {
      const report = segments
        .filter((segment) => segment.kind === 'report')
        .map((segment) => segment.content.trim())
        .filter(Boolean)
        .join('\n\n')
        .trim()
      if (report) return report
      // Has structured segments but no final report yet — do not save analysis as the report.
      continue
    }

    const legacy = message.content.trim()
    if (legacy) return legacy
  }
  return null
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
