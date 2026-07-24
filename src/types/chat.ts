export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'status'

export type ChatAttachmentType = 'test-case'

export interface ChatAttachment {
  type: ChatAttachmentType
  fileName: string
  content: string
  size: number
  mimeType?: string
}

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
  /** UI-only attachment meta (full content may be embedded into content for the model). */
  attachments?: ChatAttachment[]
  streaming?: boolean
  tools?: ToolTrace[]
  createdAt: number
}

export interface LlmSettings {
  baseUrl: string
  apiKey: string
  model: string
}

export type BrowserMode = 'auto' | 'launch' | 'attach'

export interface SessionSettings {
  targetUrl: string
  headless: boolean
  maxSteps: number
  browserMode: BrowserMode
  cdpEndpoint: string
  attachUrlIncludes: string
  waitForLogin: boolean
  loginWaitSeconds: number
}

export interface AppSettings {
  llm: LlmSettings
  session: SessionSettings
}
