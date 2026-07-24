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

export type BrowserMode = 'auto' | 'launch' | 'attach'

export interface SessionConfig {
  targetUrl?: string
  headless?: boolean
  maxSteps?: number
  /** auto: 先附着已打开标签，失败再新开；attach: 只附着；launch: 只新开 */
  browserMode?: BrowserMode
  /** 可选固定 CDP 地址；留空则自动扫描常见端口 */
  cdpEndpoint?: string
  /** 附着时优先匹配 URL 包含该字符串的标签 */
  attachUrlIncludes?: string
  /** 打开页面后等待用户手动登录 */
  waitForLogin?: boolean
  /** 手动登录最长等待秒数 */
  loginWaitSeconds?: number
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
