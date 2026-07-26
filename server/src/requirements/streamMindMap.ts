import { JSONParser } from '@streamparser/json'
import type { ParsedElementInfo } from '@streamparser/json/utils/types/parsedElementInfo.js'
import type { MindMapNode } from './analyze.js'

export interface MindMapProgressSnapshot {
  title: string
  summary: string
  root: MindMapNode
  featureCount: number
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toProgressNode(value: unknown, depth = 0): MindMapNode | null {
  if (!isRecord(value) || !isRecord(value.data)) return null

  const text = typeof value.data.text === 'string' ? value.data.text.trim() : ''
  if (!text) return null

  const note = typeof value.data.note === 'string' ? value.data.note.trim() : ''
  const tag = Array.isArray(value.data.tag)
    ? value.data.tag
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 5)
    : []
  const children = Array.isArray(value.children)
    ? value.children
        .map((child) => toProgressNode(child, depth + 1))
        .filter((child): child is MindMapNode => child !== null)
    : []

  return {
    data: {
      text: text.slice(0, 80),
      ...(note ? { note: note.slice(0, 500) } : {}),
      ...(tag.length ? { tag } : {}),
      expand: value.data.expand !== false,
    },
    children,
  }
}

function countFeatures(node: MindMapNode, isRoot = true): number {
  return (
    (isRoot ? 0 : 1) +
    (node.children || []).reduce((sum, child) => sum + countFeatures(child, false), 0)
  )
}

function findAnalysisDocument(info: ParsedElementInfo): JsonRecord | null {
  const candidates: unknown[] = [
    info.parent,
    ...[...info.stack].reverse().map((entry) => entry.value),
    info.value,
  ]

  for (const candidate of candidates) {
    if (isRecord(candidate) && isRecord(candidate.root)) return candidate
  }
  return null
}

function toSnapshot(document: JsonRecord): MindMapProgressSnapshot | null {
  const root = toProgressNode(document.root)
  if (!root) return null

  return {
    title:
      typeof document.title === 'string' && document.title.trim()
        ? document.title.trim()
        : root.data.text,
    summary: typeof document.summary === 'string' ? document.summary.trim() : '',
    root,
    featureCount: countFeatures(root),
  }
}

/**
 * Builds safe mind-map snapshots while the model's JSON document is still open.
 * Invalid or fenced output only disables previews; final parsing remains authoritative.
 */
export class StreamingMindMapParser {
  private readonly parser = new JSONParser()
  private prefix = ''
  private started = false
  private failed = false
  private lastSnapshot = ''

  constructor(private readonly onSnapshot: (snapshot: MindMapProgressSnapshot) => void) {
    this.parser.onValue = (info) => {
      if (info.partial) return
      const key = String(info.key ?? '')
      if (!['text', 'note', 'tag', 'expand', 'root'].includes(key)) return

      const document = findAnalysisDocument(info)
      if (!document) return
      const snapshot = toSnapshot(document)
      if (!snapshot) return

      const serialized = JSON.stringify(snapshot)
      if (serialized === this.lastSnapshot) return
      this.lastSnapshot = serialized
      this.onSnapshot(snapshot)
    }
  }

  write(chunk: string) {
    if (this.failed || !chunk) return

    let input = chunk
    if (!this.started) {
      this.prefix += chunk
      const objectStart = this.prefix.indexOf('{')
      if (objectStart === -1) {
        if (this.prefix.length > 2048) this.failed = true
        return
      }
      input = this.prefix.slice(objectStart)
      this.prefix = ''
      this.started = true
    }

    try {
      this.parser.write(input)
    } catch {
      // A preview must never make the final result fail. This also tolerates closing code fences.
      this.failed = true
    }
  }
}
