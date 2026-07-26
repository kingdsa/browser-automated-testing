<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue'
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
const streamBodyRefs = new Map<string, HTMLElement>()
const collapsedMessageIds = reactive(new Set<string>())
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

function setStreamBody(messageId: string, el: Element | null) {
  if (el instanceof HTMLElement) streamBodyRefs.set(messageId, el)
  else streamBodyRefs.delete(messageId)
}

function isCollapsed(messageId: string) {
  return collapsedMessageIds.has(messageId)
}

function toggleMessage(messageId: string) {
  if (collapsedMessageIds.has(messageId)) collapsedMessageIds.delete(messageId)
  else collapsedMessageIds.add(messageId)
}

function scrollToBottom(force = false) {
  const el = scroller.value
  if (!el) return
  if (!force && !pinnedToBottom.value) return
  el.scrollTop = el.scrollHeight
}

function onStreamBodyScroll(event: Event) {
  const body = event.target
  if (!(body instanceof HTMLElement)) return
  // If the user reads earlier output, leave this message in place until they return to the bottom.
  if (!isNearBottom(body)) {
    body.dataset.pinned = '0'
    return
  }
  body.dataset.pinned = '1'
}

function scrollStreamBodiesIfNeeded(force = false) {
  for (const body of streamBodyRefs.values()) {
    const pinned = body.dataset.pinned !== '0'
    if (force || (pinned && pinnedToBottom.value)) {
      body.scrollTop = body.scrollHeight
      body.dataset.pinned = '1'
    }
  }
}

watch(
  () => props.messages.map((m) => m.id).join('|'),
  async () => {
    pinnedToBottom.value = true
    await nextTick()
    for (const body of streamBodyRefs.values()) body.dataset.pinned = '1'
    scrollToBottom(true)
    scrollStreamBodiesIfNeeded(true)
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
      scrollStreamBodiesIfNeeded(false)
    })
  },
)

function roleLabel(message: GenerationMessage) {
  if (message.role === 'user') return '你'
  if (message.role === 'system') return '系统'
  if (message.kind === 'reasoning') return 'AI 分析过程'
  if (message.kind === 'result') return '结构化 JSON'
  return 'AI'
}

function isRawAssistant(message: GenerationMessage) {
  if (message.role !== 'assistant') return false
  if (message.kind === 'reasoning') return false
  if (message.kind === 'result') return true
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
  for (const body of streamBodyRefs.values()) body.dataset.pinned = '1'
  scrollToBottom(true)
  scrollStreamBodiesIfNeeded(true)
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
        :class="[message.role, { collapsed: isCollapsed(message.id) }]"
      >
        <button
          type="button"
          class="meta"
          :aria-expanded="!isCollapsed(message.id)"
          :title="isCollapsed(message.id) ? '展开内容' : '收起内容'"
          @click="toggleMessage(message.id)"
        >
          <span class="meta__labels">
            <span class="role">{{ roleLabel(message) }}</span>
            <span v-if="message.streaming" class="streaming">输出中...</span>
          </span>
          <span class="collapse-icon" aria-hidden="true" />
        </button>

        <pre
          v-if="
            !isCollapsed(message.id) &&
            isRawAssistant(message) &&
            (message.content || message.streaming)
          "
          class="raw-output"
          :ref="(el) => setStreamBody(message.id, el as Element | null)"
          @scroll.passive="onStreamBodyScroll"
          >{{ assistantText(message) }}</pre>

        <div
          v-else-if="!isCollapsed(message.id) && (message.content || message.streaming)"
          class="content markdown-body"
          :ref="(el) => setStreamBody(message.id, el as Element | null)"
          v-html="formatMarkdown(message)"
          @scroll.passive="onStreamBodyScroll"
        />
      </article>
    </div>

    <button v-if="!pinnedToBottom" type="button" class="jump-latest" @click="jumpToLatest">
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
  overflow: hidden;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.message {
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 12px 14px;
  background: var(--panel-soft);
}

.message.user {
  flex: 0 1 auto;
  max-height: 132px;
  background: color-mix(in srgb, var(--accent) 10%, var(--panel));
  border-color: color-mix(in srgb, var(--accent) 22%, var(--border));
}

.message.system {
  flex: 0 1 auto;
  max-height: 132px;
  background: var(--warning-soft);
  border-color: var(--warning-border);
}

.message.assistant {
  flex: 1 1 0;
}

.message.collapsed {
  flex: 0 0 auto;
}

.meta {
  width: 100%;
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  margin-bottom: 8px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.message.collapsed .meta {
  margin-bottom: 0;
}

.meta:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
}

.meta__labels {
  min-width: 0;
  display: flex;
  gap: 8px;
  align-items: center;
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

.collapse-icon {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  color: var(--muted);
  transition:
    background-color 0.16s ease,
    color 0.16s ease;
}

.collapse-icon::before {
  content: '';
  width: 7px;
  height: 7px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: translateY(-2px) rotate(45deg);
  transition: transform 0.16s ease;
}

.message.collapsed .collapse-icon::before {
  transform: translateX(-2px) rotate(-45deg);
}

.meta:hover .collapse-icon {
  background: var(--panel);
  color: var(--text);
}

.content {
  min-height: 0;
  overflow: auto;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
  overscroll-behavior: contain;
}

.message.assistant > .content,
.message.assistant > .raw-output {
  flex: 1;
}

.raw-output {
  min-height: 0;
  max-height: none;
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
