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
 * 提取会话中最后一次 AI 完整回复，作为要保存的 Markdown 文档。
 * 不拼接多轮结论 / 工具过程，只保留最后一次 AI 输出。
 */
export function getLastAssistantMarkdown(messages: ChatMessageItem[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (
      message &&
      message.role === 'assistant' &&
      !message.streaming &&
      message.content.trim()
    ) {
      return message.content.trim()
    }
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
