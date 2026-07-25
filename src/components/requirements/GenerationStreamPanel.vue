<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { GenerationMessage } from '@/types/requirements'
import { renderMarkdown } from '@/utils/markdown'

const props = defineProps<{
  title: string
  subtitle?: string
  messages: GenerationMessage[]
  running: boolean
  statusText?: string
  errorText?: string
}>()

const emit = defineEmits<{
  stop: []
  dismiss: []
}>()

const scroller = ref<HTMLElement | null>(null)
const rawPreRefs = new Map<string, HTMLElement>()
const pinnedToBottom = ref(true)
const BOTTOM_THRESHOLD = 80

function distanceFromBottom(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

function isNearBottom(el: HTMLElement) {
  return distanceFromBottom(el) <= BOTTOM_THRESHOLD
}

function onListScroll() {
  const el = scroller.value
  if (!el) return
  pinnedToBottom.value = isNearBottom(el)
}

function setRawPre(messageId: string, el: Element | null) {
  if (el instanceof HTMLElement) rawPreRefs.set(messageId, el)
  else rawPreRefs.delete(messageId)
}

function scrollToBottom(force = false) {
  const el = scroller.value
  if (!el) return
  if (!force && !pinnedToBottom.value) return
  el.scrollTop = el.scrollHeight
}

function onRawPreScroll(event: Event) {
  const pre = event.target
  if (!(pre instanceof HTMLElement)) return
  // If user reads earlier raw output, stop forcing this pre to the end.
  if (!isNearBottom(pre)) {
    // Don't unpin the whole list unless the list itself is scrolled up.
    // Just leave this pre alone until user returns near bottom.
    pre.dataset.pinned = '0'
    return
  }
  pre.dataset.pinned = '1'
}

function scrollRawPresIfNeeded(force = false) {
  for (const pre of rawPreRefs.values()) {
    const pinned = pre.dataset.pinned !== '0'
    if (force || (pinned && pinnedToBottom.value)) {
      pre.scrollTop = pre.scrollHeight
      pre.dataset.pinned = '1'
    }
  }
}

watch(
  () => props.messages.map((m) => m.id).join('|'),
  async () => {
    pinnedToBottom.value = true
    await nextTick()
    for (const pre of rawPreRefs.values()) pre.dataset.pinned = '1'
    scrollToBottom(true)
    scrollRawPresIfNeeded(true)
  },
)

watch(
  () =>
    props.messages.map((m) => `${m.id}:${m.content.length}:${m.streaming ? 1 : 0}`).join('|') +
    `:${props.statusText || ''}:${props.errorText || ''}`,
  async () => {
    if (!pinnedToBottom.value) return
    await nextTick()
    requestAnimationFrame(() => {
      scrollToBottom()
      scrollRawPresIfNeeded(false)
    })
  },
)

function roleLabel(role: GenerationMessage['role']) {
  if (role === 'user') return '你'
  if (role === 'system') return '系统'
  return 'AI'
}

function isRawAssistant(message: GenerationMessage) {
  if (message.role !== 'assistant') return false
  const body = message.content.trim()
  return !body || body.startsWith('{') || body.startsWith('[') || message.streaming
}

function assistantText(message: GenerationMessage) {
  return message.content || (message.streaming ? '…' : '')
}

function formatMarkdown(message: GenerationMessage) {
  return renderMarkdown(message.content)
}

function jumpToLatest() {
  pinnedToBottom.value = true
  for (const pre of rawPreRefs.values()) pre.dataset.pinned = '1'
  scrollToBottom(true)
}
</script>

<template>
  <section class="stream-panel">
    <header class="stream-panel__head">
      <div>
        <h2>{{ title }}</h2>
        <p v-if="subtitle">{{ subtitle }}</p>
      </div>
      <div class="stream-panel__actions">
        <button v-if="running" type="button" class="stop" @click="emit('stop')">取消生成</button>
        <button v-else type="button" class="ghost" @click="emit('dismiss')">返回结果</button>
      </div>
    </header>

    <div v-if="statusText || errorText" class="stream-status" :class="{ error: !!errorText }">
      {{ errorText || statusText }}
    </div>

    <div ref="scroller" class="stream-list" @scroll.passive="onListScroll">
      <article
        v-for="message in messages"
        :key="message.id"
        class="message"
        :class="message.role"
      >
        <div class="meta">
          <span class="role">{{ roleLabel(message.role) }}</span>
          <span v-if="message.streaming" class="streaming">输出中...</span>
        </div>

        <pre
          v-if="isRawAssistant(message) && (message.content || message.streaming)"
          class="raw-output"
          :ref="(el) => setRawPre(message.id, el as Element | null)"
          @scroll.passive="onRawPreScroll"
        >{{ assistantText(message) }}</pre>

        <div
          v-else-if="message.content || message.streaming"
          class="content markdown-body"
          v-html="formatMarkdown(message)"
        />
      </article>
    </div>

    <button
      v-if="!pinnedToBottom"
      type="button"
      class="jump-latest"
      @click="jumpToLatest"
    >
      回到最新
    </button>
  </section>
</template>

<style scoped>
.stream-panel {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--panel) 94%, transparent);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  animation: fade-up 0.4s var(--ease-out) both;
}

.stream-panel__head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--accent) 6%, var(--panel));
}

.stream-panel__head h2 {
  margin: 0;
  font-size: 15px;
}

.stream-panel__head p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.stream-panel__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.stop,
.ghost {
  border-radius: var(--radius-md);
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
}

.stop {
  border: 1px solid var(--error-border);
  background: var(--error-soft);
  color: var(--error-text);
  font-weight: 600;
}

.ghost {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
}

.stream-status {
  margin: 12px 16px 0;
  border-radius: var(--radius-md);
  padding: 8px 12px;
  font-size: 13px;
  background: var(--info-soft);
  color: var(--info-text);
  border: 1px solid var(--info-border);
}

.stream-status.error {
  background: var(--error-soft);
  color: var(--error-text);
  border-color: var(--error-border);
}

.stream-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.message {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 12px 14px;
  background: var(--panel-soft);
}

.message.user {
  background: color-mix(in srgb, var(--accent) 10%, var(--panel));
  border-color: color-mix(in srgb, var(--accent) 22%, var(--border));
}

.message.system {
  background: var(--warning-soft);
  border-color: var(--warning-border);
}

.meta {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.role {
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
}

.streaming {
  font-size: 12px;
  color: var(--info-text);
  background: var(--info-soft);
  border: 1px solid var(--info-border);
  border-radius: 999px;
  padding: 1px 8px;
  animation: pulse-soft 1.4s ease-in-out infinite;
}

.content {
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.raw-output {
  max-height: 48vh;
  overflow: auto;
  margin: 0;
  padding: 12px;
  border-radius: var(--radius-md);
  background: var(--code-bg);
  color: var(--code-text);
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  overscroll-behavior: contain;
}

.content :deep(pre) {
  max-height: 48vh;
  overflow: auto;
  margin: 0;
  padding: 12px;
  border-radius: var(--radius-md);
  background: var(--code-bg);
  color: var(--code-text);
  overscroll-behavior: contain;
}

.content :deep(code) {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.jump-latest {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  border: 1px solid var(--info-border);
  background: var(--info-soft);
  color: var(--info-text);
  border-radius: 999px;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--shadow-float);
}

.jump-latest:hover {
  background: var(--info-border);
}
</style>
