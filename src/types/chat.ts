export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'status'

export interface ToolTrace {
  id?: string
  name: string
  arguments?: string
  summary?: string
  ok?: boolean
  screenshotPath?: string
  screenshotBase64?: string
  data?: unknown
  status: 'running' | 'done' | 'error'
}

export interface ChatMessageItem {
  id: string
  role: MessageRole
  content: string
  streaming?: boolean
  tools?: ToolTrace[]
  createdAt: number
}

export interface LlmSettings {
  baseUrl: string
  apiKey: string
  model: string
}

export interface SessionSettings {
  targetUrl: string
  headless: boolean
  maxSteps: number
}

export interface AppSettings {
  llm: LlmSettings
  session: SessionSettings
}
