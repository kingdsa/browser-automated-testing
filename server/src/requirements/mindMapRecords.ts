import path from 'node:path'
import { z } from 'zod'
import type { MindMapNode, MindMapNodeData, RequirementAnalysisResult } from './analyze.js'
import type { MindMapProgressSnapshot } from './streamMindMap.js'

const metaRecordSchema = z.object({
  type: z.literal('meta'),
  title: z.string().min(1),
  summary: z.string().default(''),
  root: z.string().min(1).optional(),
})

const nodeRecordSchema = z.object({
  type: z.literal('node'),
  path: z.array(z.string().min(1)).min(1),
  note: z.string().optional(),
  tag: z.array(z.string()).optional(),
})

const completeRecordSchema = z.object({
  type: z.literal('complete'),
  recordCount: z.number().int().nonnegative(),
})

const recordSchema = z.discriminatedUnion('type', [
  metaRecordSchema,
  nodeRecordSchema,
  completeRecordSchema,
])

const legacyNodeSchema: z.ZodType<MindMapNode> = z.lazy(() =>
  z.object({
    data: z.object({
      text: z.string().min(1),
      note: z.string().optional(),
      tag: z.array(z.string()).optional(),
      expand: z.boolean().optional(),
    }),
    children: z.array(legacyNodeSchema).optional(),
  }),
)

const legacyResultSchema = z.object({
  complete: z.literal(true),
  title: z.string().min(1),
  summary: z.string().min(1),
  root: legacyNodeSchema,
})

type MetaRecord = z.infer<typeof metaRecordSchema>
type NodeRecord = z.infer<typeof nodeRecordSchema>
type MindMapRecord = z.infer<typeof recordSchema>

interface MutableNode extends MindMapNode {
  children: MutableNode[]
}

function cleanText(value: string, maxLength: number): string {
  return value
    .replace(/\[\[(?:SOURCE_PART|INPUT_DOCUMENT|REQUIREMENT)[^\]]*\]\]/g, '')
    .replace(/^\*\*(.*?)\*\*$/, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function cleanNodeData(input: { text: string; note?: string; tag?: string[] }): MindMapNodeData {
  const note = input.note ? cleanText(input.note, 500) : ''
  const tag = (input.tag || [])
    .map((item) => cleanText(item, 30))
    .filter(Boolean)
    .slice(0, 5)
  return {
    text: cleanText(input.text, 80) || '未命名功能',
    ...(note ? { note } : {}),
    ...(tag.length ? { tag } : {}),
    expand: true,
  }
}

function sanitizeLegacyNode(node: MindMapNode): MindMapNode {
  return {
    data: cleanNodeData(node.data),
    children: (node.children || []).map(sanitizeLegacyNode),
  }
}

function countFeatures(node: MindMapNode, isRoot = true): number {
  return (
    (isRoot ? 0 : 1) +
    (node.children || []).reduce((sum, child) => sum + countFeatures(child, false), 0)
  )
}

function fallbackTitle(fileName: string): string {
  const parsed = path.parse(fileName || '')
  return cleanText(parsed.name || '需求功能点', 80) || '需求功能点'
}

function assembleResult(
  meta: MetaRecord | null,
  records: Iterable<NodeRecord>,
  defaultTitle: string,
): RequirementAnalysisResult {
  const title = cleanText(meta?.title || defaultTitle, 80) || '需求功能点'
  const rootText = cleanText(meta?.root || title, 80) || title
  const root: MutableNode = {
    data: { text: rootText, expand: true },
    children: [],
  }

  for (const record of records) {
    const pathParts = record.path.map((part) => cleanText(part, 80)).filter(Boolean)
    if (pathParts[0] === rootText) pathParts.shift()
    if (!pathParts.length) continue

    let current = root
    for (let index = 0; index < pathParts.length; index += 1) {
      const text = pathParts[index] || '未命名功能'
      let child = current.children.find((candidate) => candidate.data.text === text)
      if (!child) {
        child = { data: { text, expand: true }, children: [] }
        current.children.push(child)
      }
      if (index === pathParts.length - 1) {
        child.data = cleanNodeData({ text, note: record.note, tag: record.tag })
      }
      current = child
    }
  }

  return {
    title,
    summary: cleanText(meta?.summary || '根据需求分析结果生成的功能点结构', 500),
    root,
    featureCount: countFeatures(root),
  }
}

function parseJsonLine(line: string): unknown | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('```')) return null
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return null
  }
}

export class StreamingMindMapRecordParser {
  private buffer = ''
  private meta: MetaRecord | null = null
  private readonly nodes = new Map<string, NodeRecord>()
  private completeRecordCount: number | null = null
  private legacyResult: RequirementAnalysisResult | null = null
  private version = 0
  private invalidLineCount = 0

  constructor(
    private readonly fileName: string,
    private readonly onSnapshot: (snapshot: MindMapProgressSnapshot) => void,
  ) {}

  write(chunk: string): void {
    if (!chunk) return
    this.buffer += chunk
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() || ''
    for (const line of lines) this.consumeLine(line)
  }

  finishPass(): void {
    if (this.buffer.trim()) this.consumeLine(this.buffer)
    this.buffer = ''
  }

  private consumeLine(line: string): void {
    if (this.complete) return
    const parsed = parseJsonLine(line)
    if (!parsed) {
      if (line.trim() && !line.trim().startsWith('```')) this.invalidLineCount += 1
      return
    }

    const record = recordSchema.safeParse(parsed)
    if (record.success) {
      this.acceptRecord(record.data)
      return
    }

    const legacy = legacyResultSchema.safeParse(parsed)
    if (!legacy.success) {
      this.invalidLineCount += 1
      return
    }
    const root = sanitizeLegacyNode(legacy.data.root)
    this.legacyResult = {
      title: cleanText(legacy.data.title, 80),
      summary: cleanText(legacy.data.summary, 500),
      root,
      featureCount: countFeatures(root),
    }
    this.version += 1
    this.onSnapshot(this.legacyResult)
  }

  private acceptRecord(record: MindMapRecord): void {
    if (record.type === 'meta') {
      const next = {
        ...record,
        title: cleanText(record.title, 80),
        summary: cleanText(record.summary, 500),
        root: record.root ? cleanText(record.root, 80) : undefined,
      }
      if (JSON.stringify(next) === JSON.stringify(this.meta)) return
      this.meta = next
      this.version += 1
      this.emitSnapshot()
      return
    }

    if (record.type === 'node') {
      const next: NodeRecord = {
        ...record,
        path: record.path.map((part) => cleanText(part, 80)).filter(Boolean),
        note: record.note ? cleanText(record.note, 500) : undefined,
        tag: (record.tag || [])
          .map((item) => cleanText(item, 30))
          .filter(Boolean)
          .slice(0, 5),
      }
      if (!next.path.length) return
      const key = JSON.stringify(next.path)
      const previous = this.nodes.get(key)
      if (JSON.stringify(previous) === JSON.stringify(next)) return
      this.nodes.set(key, next)
      this.version += 1
      this.emitSnapshot()
      return
    }

    if (record.recordCount === this.completeRecordCount) return
    this.completeRecordCount = record.recordCount
    this.version += 1
  }

  private emitSnapshot(): void {
    if (!this.nodes.size) return
    this.onSnapshot(this.toResult())
  }

  get stateVersion(): number {
    return this.version
  }

  get recordCount(): number {
    return this.nodes.size
  }

  get rejectedLineCount(): number {
    return this.invalidLineCount
  }

  get complete(): boolean {
    if (this.legacyResult) return true
    return Boolean(
      this.meta &&
      this.nodes.size > 0 &&
      this.completeRecordCount != null &&
      this.completeRecordCount === this.nodes.size,
    )
  }

  continuationContext(maxRecords = 12): string {
    const records: MindMapRecord[] = []
    if (this.meta) records.push(this.meta)
    records.push(...[...this.nodes.values()].slice(-maxRecords))
    return records.map((record) => JSON.stringify(record)).join('\n')
  }

  toResult(): RequirementAnalysisResult {
    if (this.legacyResult) return this.legacyResult
    return assembleResult(this.meta, this.nodes.values(), fallbackTitle(this.fileName))
  }
}

function addFallbackRecord(
  records: Map<string, NodeRecord>,
  pathParts: string[],
  note?: string,
): void {
  const path = pathParts
    .map((part) => cleanText(part, 80))
    .filter(Boolean)
  if (!path.length) return
  records.set(JSON.stringify(path), { type: 'node', path, ...(note ? { note } : {}) })
}

function fallbackLabel(value: string): { text: string; note?: string } {
  const cleaned = cleanText(
    value
      .replace(/^\[[ xX]\]\s*/, '')
      .replace(/^\*\*(.*?)\**\s*/, '$1')
      .replace(/`/g, ''),
    500,
  )
  const separator = cleaned.search(/[：:]/)
  if (separator > 0 && separator <= 40) {
    return {
      text: cleanText(cleaned.slice(0, separator), 80),
      note: cleanText(cleaned.slice(separator + 1), 500) || undefined,
    }
  }
  return { text: cleanText(cleaned, 80) }
}

export function buildDeterministicMindMap(
  fileName: string,
  source: string,
): RequirementAnalysisResult {
  const records = new Map<string, NodeRecord>()
  const headings: Array<{ level: number; text: string }> = []
  const bullets: Array<{ indent: number; path: string[] }> = []
  let documentTitle = fallbackTitle(fileName)

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/\[\[[^\]]+\]\]/g, '').trimEnd()
    if (!line.trim()) continue

    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*$/)
    if (heading) {
      const level = heading[1]?.length || 1
      const text = cleanText(heading[2] || '', 80)
      if (!text) continue
      if (level === 1 && records.size === 0) documentTitle = text
      while (headings.length && (headings[headings.length - 1]?.level || 0) >= level)
        headings.pop()
      headings.push({ level, text })
      bullets.length = 0
      if (level > 1)
        addFallbackRecord(
          records,
          headings.filter((item) => item.level > 1).map((item) => item.text),
        )
      continue
    }

    const bullet = rawLine.match(/^(\s*)(?:[-*+] |\d+[.)]\s+)(.+)$/)
    if (!bullet) continue
    const indent = (bullet[1] || '').replace(/\t/g, '  ').length
    const { text, note } = fallbackLabel(bullet[2] || '')
    if (!text) continue
    while (bullets.length && (bullets[bullets.length - 1]?.indent || 0) >= indent) bullets.pop()
    const headingPath = headings.filter((item) => item.level > 1).map((item) => item.text)
    const parentPath = bullets[bullets.length - 1]?.path || headingPath
    const nodePath = [...parentPath, text]
    addFallbackRecord(records, nodePath, note)
    bullets.push({ indent, path: nodePath })
  }

  if (!records.size) {
    const candidates = source
      .replace(/\[\[[^\]]+\]\]/g, '')
      .split(/\r?\n|[。；;]/)
      .map((item) => cleanText(item, 80))
      .filter((item) => item.length >= 2)
    for (const candidate of candidates) addFallbackRecord(records, [candidate])
  }

  if (!records.size) addFallbackRecord(records, ['需求内容'])
  return assembleResult(
    {
      type: 'meta',
      title: documentTitle,
      root: documentTitle,
      summary: '根据完整需求分析结果由服务端稳定生成',
    },
    records.values(),
    documentTitle,
  )
}
