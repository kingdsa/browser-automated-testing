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

export interface MindMapProgressSnapshot {
  title: string
  summary: string
  root: MindMapNode
  featureCount: number
}

export interface FeaturePoint {
  path: string
  text: string
  note?: string
  tags?: string[]
}

export type TestCasePriority = 'P0' | 'P1' | 'P2' | 'P3'

export interface TestCase {
  id: string
  feature: string
  featurePath: string
  title: string
  priority: TestCasePriority
  type: string
  preconditions: string
  steps: string[]
  expected: string
  note?: string
}

export interface GenerateTestCasesResult {
  ok: boolean
  title: string
  summary: string
  cases: TestCase[]
  caseCount: number
  error?: string
}

export interface GenerationMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  kind?: 'reasoning' | 'result'
  streaming?: boolean
}
