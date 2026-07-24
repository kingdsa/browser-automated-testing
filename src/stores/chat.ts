import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { streamChat } from '@/api/agent'
import { useSettingsStore } from '@/stores/settings'
import type { ChatMessageItem, ToolTrace } from '@/types/chat'

function uid(prefix = 'm') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessageItem[]>([])
  const isRunning = ref(false)
  const statusText = ref('')
  const errorText = ref('')
  let abortController: AbortController | null = null

  const visibleMessages = computed(() => messages.value)

  function clear() {
    if (isRunning.value) stop()
    messages.value = []
    statusText.value = ''
    errorText.value = ''
  }

  function stop() {
    abortController?.abort()
    abortController = null
    isRunning.value = false
    statusText.value = '已停止'
  }

  async function send(prompt: string) {
    const content = prompt.trim()
    if (!content || isRunning.value) return

    const settingsStore = useSettingsStore()
    errorText.value = ''
    statusText.value = '准备开始...'

    messages.value.push({
      id: uid('user'),
      role: 'user',
      content,
      createdAt: Date.now(),
    })

    const assistantId = uid('assistant')
    messages.value.push({
      id: assistantId,
      role: 'assistant',
      content: '',
      streaming: true,
      tools: [],
      createdAt: Date.now(),
    })

    const previous = messages.value
      .filter(
        (m) =>
          m.id !== assistantId &&
          ((m.role === 'user' && m.content) || (m.role === 'assistant' && m.content)),
      )
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }))

    isRunning.value = true
    abortController = new AbortController()

    const ensureAssistant = () => {
      let msg = messages.value.find((m) => m.id === assistantId)
      if (!msg) {
        msg = {
          id: assistantId,
          role: 'assistant',
          content: '',
          streaming: true,
          tools: [],
          createdAt: Date.now(),
        }
        messages.value.push(msg)
      }
      if (!msg.tools) msg.tools = []
      return msg
    }

    try {
      await streamChat({
        messages: previous,
        settings: settingsStore.settings,
        handlers: {
          signal: abortController.signal,
          onEvent(type, data) {
            const payload = data as Record<string, unknown>
            const assistant = ensureAssistant()

            if (type === 'delta') {
              assistant.content += String(payload.content || '')
              return
            }

            if (type === 'status') {
              statusText.value = String(payload.message || '')
              return
            }

            if (type === 'tool_start') {
              const tool: ToolTrace = {
                id: String(payload.id || ''),
                name: String(payload.name || 'tool'),
                arguments: String(payload.arguments || ''),
                status: 'running',
              }
              assistant.tools?.push(tool)
              statusText.value = `执行工具: ${tool.name}`
              return
            }

            if (type === 'tool_result') {
              const result = (payload.result || {}) as Record<string, unknown>
              const id = String(payload.id || '')
              const name = String(payload.name || 'tool')
              const existing = assistant.tools?.find(
                (t) => (id && t.id === id) || (t.name === name && t.status === 'running'),
              )
              const next: ToolTrace = {
                id,
                name,
                arguments: existing?.arguments,
                summary: String(result.summary || ''),
                ok: Boolean(result.ok),
                screenshotPath: result.screenshotPath ? String(result.screenshotPath) : undefined,
                screenshotBase64: result.screenshotBase64
                  ? String(result.screenshotBase64)
                  : undefined,
                data: result.data,
                status: result.ok === false ? 'error' : 'done',
              }
              if (existing) Object.assign(existing, next)
              else assistant.tools?.push(next)
              statusText.value = next.summary || `工具完成: ${name}`
              return
            }

            if (type === 'error') {
              errorText.value = String(payload.message || '未知错误')
              return
            }

            if (type === 'done') {
              assistant.streaming = false
              statusText.value = '完成'
            }
          },
        },
      })
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        statusText.value = '已停止'
      } else {
        errorText.value = error instanceof Error ? error.message : String(error)
      }
    } finally {
      const assistant = messages.value.find((m) => m.id === assistantId)
      if (assistant) {
        assistant.streaming = false
        if (!assistant.content && !assistant.tools?.length) {
          assistant.content = errorText.value || '本次没有生成文本结论。'
        }
      }
      isRunning.value = false
      abortController = null
    }
  }

  return {
    messages,
    visibleMessages,
    isRunning,
    statusText,
    errorText,
    send,
    stop,
    clear,
  }
})
