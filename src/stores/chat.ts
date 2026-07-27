import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { streamChat } from '@/api/agent'
import { useSettingsStore } from '@/stores/settings'
import type {
  ChatAttachment,
  ChatMessageItem,
  ChatMessageSegment,
  ToolTrace,
} from '@/types/chat'
import { buildPromptWithTestCase } from '@/utils/testCases'

function uid(prefix = 'm') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function ensureOpenSegment(assistant: ChatMessageItem): ChatMessageSegment {
  if (!assistant.segments) assistant.segments = []
  const last = assistant.segments[assistant.segments.length - 1]
  if (last?.streaming) return last

  const segment: ChatMessageSegment = {
    id: uid('seg'),
    kind: 'analysis',
    content: '',
    streaming: true,
  }
  assistant.segments.push(segment)
  return segment
}

function closeOpenSegment(
  assistant: ChatMessageItem,
  kind: ChatMessageSegment['kind'] = 'analysis',
) {
  const last = assistant.segments?.[assistant.segments.length - 1]
  if (!last?.streaming) return
  last.streaming = false
  last.kind = kind
}

function finalizeAssistantSegments(assistant: ChatMessageItem, asReport: boolean) {
  const last = assistant.segments?.[assistant.segments.length - 1]
  if (!last) return
  if (last.streaming || asReport) {
    last.streaming = false
    if (asReport && last.content.trim()) last.kind = 'report'
    else if (!last.content.trim()) last.kind = 'analysis'
  }
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

  async function send(prompt: string, attachment?: ChatAttachment) {
    const promptText = prompt.trim()
    if ((!promptText && !attachment) || isRunning.value) return

    const settingsStore = useSettingsStore()
    errorText.value = ''
    statusText.value = attachment ? `已加载用例「${attachment.fileName}」，准备开始...` : '准备开始...'

    // Keep full prompt+case in content so multi-turn history still has the suite.
    const modelContent = attachment
      ? buildPromptWithTestCase(promptText, attachment)
      : promptText

    messages.value.push({
      id: uid('user'),
      role: 'user',
      content: modelContent,
      attachments: attachment ? [attachment] : undefined,
      createdAt: Date.now(),
    })

    const assistantId = uid('assistant')
    messages.value.push({
      id: assistantId,
      role: 'assistant',
      content: '',
      streaming: true,
      segments: [],
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
    let finishedNaturally = false

    const ensureAssistant = () => {
      let msg = messages.value.find((m) => m.id === assistantId)
      if (!msg) {
        msg = {
          id: assistantId,
          role: 'assistant',
          content: '',
          streaming: true,
          segments: [],
          tools: [],
          createdAt: Date.now(),
        }
        messages.value.push(msg)
      }
      if (!msg.tools) msg.tools = []
      if (!msg.segments) msg.segments = []
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
              const text = String(payload.content || '')
              if (!text) return
              assistant.content += text
              const segment = ensureOpenSegment(assistant)
              segment.content += text
              return
            }

            if (type === 'status') {
              const message = String(payload.message || '')
              statusText.value = message
              // Final natural completion signal from the agent runner.
              if (message.includes('已生成结论') || message.includes('测试完成')) {
                finishedNaturally = true
                // Promote as soon as the runner confirms no more tool calls.
                finalizeAssistantSegments(assistant, true)
              }
              return
            }

            if (type === 'tool_start') {
              // Text before tools is intermediate analysis, not the final report.
              closeOpenSegment(assistant, 'analysis')
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
              finalizeAssistantSegments(assistant, finishedNaturally || !assistant.tools?.length)
              statusText.value = statusText.value || '完成'
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
          assistant.segments = [
            {
              id: uid('seg'),
              kind: 'analysis',
              content: assistant.content,
              streaming: false,
            },
          ]
        } else {
          // Abort keeps the open segment as analysis; natural finish promotes it to report.
          const aborted = statusText.value === '已停止'
          finalizeAssistantSegments(
            assistant,
            !aborted && (finishedNaturally || !assistant.tools?.length),
          )
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
