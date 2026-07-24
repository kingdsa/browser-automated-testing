import mammoth from 'mammoth'

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.text', '.csv', '.json', '.log'])
const DOCX_EXTENSIONS = new Set(['.docx'])

export function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.')
  if (idx < 0) return ''
  return fileName.slice(idx).toLowerCase()
}

export function isSupportedRequirementFile(fileName: string): boolean {
  const ext = getExtension(fileName)
  return TEXT_EXTENSIONS.has(ext) || DOCX_EXTENSIONS.has(ext)
}

export async function extractRequirementText(input: {
  buffer: Buffer
  fileName: string
  mimeType?: string
}): Promise<{ text: string; kind: 'text' | 'docx' }> {
  const ext = getExtension(input.fileName)
  const mime = (input.mimeType || '').toLowerCase()

  if (
    DOCX_EXTENSIONS.has(ext) ||
    mime.includes('wordprocessingml') ||
    mime === 'application/msword'
  ) {
    const result = await mammoth.extractRawText({ buffer: input.buffer })
    const text = result.value.trim()
    if (!text) throw new Error('未能从 Word 文档中提取到有效文本')
    return { text, kind: 'docx' }
  }

  if (TEXT_EXTENSIONS.has(ext) || mime.startsWith('text/') || mime === 'application/json' || !ext) {
    const text = input.buffer.toString('utf8').trim()
    if (!text) throw new Error('文档内容为空')
    return { text, kind: 'text' }
  }

  throw new Error(`暂不支持该文件类型：${ext || mime || 'unknown'}。请上传 .md / .txt / .docx，或直接粘贴文本`)
}
