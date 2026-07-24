import type { AppSettings } from '@/types/chat'

export interface StreamHandlers {
  onEvent: (type: string, data: unknown) => void
  onError?: (error: Error) => void
  signal?: AbortSignal
}

export async function streamChat(input: {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  settings: AppSettings
  handlers: StreamHandlers
}) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: input.messages,
      llm: input.settings.llm,
      session: {
        targetUrl: input.settings.session.targetUrl || undefined,
        headless: input.settings.session.headless,
        maxSteps: input.settings.session.maxSteps,
      },
    }),
    signal: input.handlers.signal,
  })

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `请求失败: HTTP ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let splitIndex = buffer.indexOf('\n\n')
    while (splitIndex !== -1) {
      const rawEvent = buffer.slice(0, splitIndex)
      buffer = buffer.slice(splitIndex + 2)
      parseSseEvent(rawEvent, input.handlers.onEvent)
      splitIndex = buffer.indexOf('\n\n')
    }
  }

  if (buffer.trim()) {
    parseSseEvent(buffer, input.handlers.onEvent)
  }
}

function parseSseEvent(raw: string, onEvent: (type: string, data: unknown) => void) {
  const lines = raw.split(/\r?\n/)
  let eventType = 'message'
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('event:')) eventType = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }

  if (!dataLines.length) return
  const dataText = dataLines.join('\n')
  try {
    onEvent(eventType, JSON.parse(dataText))
  } catch {
    onEvent(eventType, { raw: dataText })
  }
}

export async function fetchSkills() {
  const res = await fetch('/api/skills')
  if (!res.ok) throw new Error('获取 skills 失败')
  return res.json() as Promise<{ skills: Array<{ name: string; description: string }> }>
}

export async function fetchHealth() {
  const res = await fetch('/api/health')
  if (!res.ok) throw new Error('后端不可用')
  return res.json()
}

export async function fetchDefaults() {
  const res = await fetch('/api/defaults')
  if (!res.ok) throw new Error('获取默认配置失败')
  return res.json() as Promise<{
    llm: { baseUrl: string; model: string; hasApiKey: boolean }
    session: { maxSteps: number; headless: boolean }
  }>
}
