export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  role: ChatRole
  content: string
  name?: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface LlmSettings {
  baseUrl: string
  apiKey: string
  model: string
}

export interface SessionConfig {
  targetUrl?: string
  headless?: boolean
  maxSteps?: number
}

export type StreamEventType =
  | 'session'
  | 'delta'
  | 'tool_start'
  | 'tool_result'
  | 'status'
  | 'done'
  | 'error'

export interface StreamEvent {
  type: StreamEventType
  data: unknown
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ToolResult {
  ok: boolean
  summary: string
  data?: unknown
  screenshotBase64?: string
}
