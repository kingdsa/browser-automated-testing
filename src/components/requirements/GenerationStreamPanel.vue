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

function scrollToBottom(force = false) {
  const el = scroller.value
  if (!el) return
  if (!force && !pinnedToBottom.value) return
  el.scrollTop = el.scrollHeight
}

watch(
  () => props.messages.map((m) => m.id).join('|'),
  async () => {
    pinnedToBottom.value = true
    await nextTick()
    scrollToBottom(true)
  },
)

watch(
  () =>
    props.messages.map((m) => `${m.id}:${m.content.length}:${m.streaming ? 1 : 0}`).join('|') +
    `:${props.statusText || ''}:${props.errorText || ''}`,
  async () => {
    if (!pinnedToBottom.value) return
    await nextTick()
    requestAnimationFrame(() => scrollToBottom())
  },
)

function roleLabel(role: GenerationMessage['role']) {
  if (role === 'user') return '你'
  if (role === 'system') return '系统'
  return 'AI'
}

function formatContent(message: GenerationMessage) {
  if (message.role === 'assistant') {
    const body = message.content || (message.streaming ? '…' : '')
    if (!body) return ''
    if (body.trim().startsWith('{') || body.trim().startsWith('[')) {
      return renderMarkdown('```json\n' + body + '\n```')
    }
    return renderMarkdown(body)
  }
  return renderMarkdown(message.content)
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
        <div
          v-if="message.content || message.streaming"
          class="content markdown-body"
          v-html="formatContent(message)"
        />
      </article>
    </div>

    <button
      v-if="!pinnedToBottom"
      type="button"
      class="jump-latest"
      @click="pinnedToBottom = true; scrollToBottom(true)"
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
  border-radius: 16px;
  background: var(--panel);
  overflow: hidden;
}

.stream-panel__head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--accent) 4%, var(--panel));
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
  border-radius: 10px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
}

.stop {
  border: 1px solid #fecdca;
  background: #fef3f2;
  color: #b42318;
  font-weight: 600;
}

.ghost {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
}

.stream-status {
  margin: 12px 16px 0;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
  background: #eff8ff;
  color: #175cd3;
  border: 1px solid #b2ddff;
}

.stream-status.error {
  background: #fef3f2;
  color: #b42318;
  border-color: #fecdca;
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
  border-radius: 14px;
  padding: 12px 14px;
  background: var(--panel-soft);
}

.message.user {
  background: color-mix(in srgb, var(--accent) 8%, var(--panel));
}

.message.system {
  background: #fffbeb;
  border-color: #fde68a;
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
  color: #175cd3;
  background: #eff8ff;
  border: 1px solid #b2ddff;
  border-radius: 999px;
  padding: 1px 8px;
}

.content {
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.content :deep(pre) {
  max-height: 48vh;
  overflow: auto;
  margin: 0;
  padding: 12px;
  border-radius: 10px;
  background: #0b1220;
  color: #e5eefc;
  overscroll-behavior: contain;
}

.content :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 12px;
}

.jump-latest {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  border: 1px solid #b2ddff;
  background: #eff8ff;
  color: #175cd3;
  border-radius: 999px;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(16, 24, 40, 0.12);
}

.jump-latest:hover {
  background: #d1e9ff;
}
</style>
