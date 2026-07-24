export interface MindMapNodeData {
  text: string
  note?: string
  tag?: string[]
  expand?: boolean
}

export interface MindMapNode {
  data: MindMapNodeData
  children?: MindMapNode[]
}

export interface RequirementAnalysisResult {
  ok: boolean
  source?: 'file' | 'text'
  fileName?: string
  contentLength?: number
  title: string
  summary: string
  root: MindMapNode
  featureCount: number
  error?: string
}
