<script setup lang="ts">
import { nextTick, onBeforeUnmount, watch, ref } from 'vue'
import type { ChatMessageItem } from '@/types/chat'
import { renderMarkdown } from '@/utils/markdown'
import { formatAttachmentSize } from '@/utils/testCases'

const props = defineProps<{
  messages: ChatMessageItem[]
}>()

const scroller = ref<HTMLElement | null>(null)
const toolsScrollers = new Map<string, HTMLElement>()
const toolsObservers = new Map<string, ResizeObserver>()

function disconnectToolsObserver(messageId: string) {
  const observer = toolsObservers.get(messageId)
  if (observer) {
    observer.disconnect()
    toolsObservers.delete(messageId)
  }
}

function observeToolsList(messageId: string, el: HTMLElement) {
  disconnectToolsObserver(messageId)
  const observer = new ResizeObserver(() => {
    scrollToolsListToLatest(el)
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
  })
  observer.observe(el)
  const last = el.lastElementChild
  if (last instanceof HTMLElement) observer.observe(last)
  toolsObservers.set(messageId, observer)
}

function setToolsScroller(messageId: string, el: Element | null) {
  if (el instanceof HTMLElement) {
    toolsScrollers.set(messageId, el)
    observeToolsList(messageId, el)
    return
  }
  toolsScrollers.delete(messageId)
  disconnectToolsObserver(messageId)
}

function scrollToolsListToLatest(el: HTMLElement) {
  const last = el.lastElementChild as HTMLElement | null
  if (!last) {
    el.scrollTop = el.scrollHeight
    return
  }

  // Use viewport math so nested <details> layout does not under-scroll.
  const pad = 16
  const elRect = el.getBoundingClientRect()
  const lastRect = last.getBoundingClientRect()
  const overflowBottom = lastRect.bottom - elRect.bottom
  const overflowTop = elRect.top - lastRect.top

  if (overflowBottom > -pad) {
    el.scrollTop += overflowBottom + pad
  } else if (overflowTop > 0) {
    el.scrollTop -= overflowTop + pad
  }

  // Final hard snap — some browsers report stale rects mid-layout.
  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
  if (el.scrollTop < maxScroll) {
    el.scrollTop = maxScroll
  }
}

function scrollAllToolsToLatest() {
  for (const el of toolsScrollers.values()) {
    scrollToolsListToLatest(el)
  }
}

function scheduleScrollToLatest() {
  const run = () => {
    scrollAllToolsToLatest()
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
  }

  run()
  requestAnimationFrame(() => {
    run()
    requestAnimationFrame(run)
  })
  window.setTimeout(run, 40)
  window.setTimeout(run, 140)
}

watch(
  () =>
    props.messages
      .map((m) => {
        const tools = (m.tools || [])
          .map(
            (t) =>
              `${t.id || ''}:${t.name}:${t.status}:${t.summary || ''}:${t.arguments?.length || 0}:${t.screenshotBase64 ? 1 : 0}:${t.screenshotPath || ''}`,
          )
          .join(',')
        return `${m.id}:${m.content.length}:${tools}`
      })
      .join('|'),
  async () => {
    await nextTick()
    // Re-bind observers to the newest last child after list updates.
    for (const [messageId, el] of toolsScrollers.entries()) {
      observeToolsList(messageId, el)
    }
    scheduleScrollToLatest()
  },
)

onBeforeUnmount(() => {
  for (const messageId of [...toolsObservers.keys()]) {
    disconnectToolsObserver(messageId)
  }
  toolsScrollers.clear()
})

function screenshotSrc(tool: NonNullable<ChatMessageItem['tools']>[number]) {
  if (tool.screenshotBase64) return `data:image/png;base64,${tool.screenshotBase64}`
  if (tool.screenshotPath) return tool.screenshotPath
  return ''
}

/** Hide the long case body in the bubble; full text still lives in message.content for the model. */
function displayContent(message: ChatMessageItem): string {
  if (message.role !== 'user' || !message.attachments?.length) return message.content
  const marker = '\n---\n【测试用例附件'
  const idx = message.content.indexOf(marker)
  if (idx >= 0) return message.content.slice(0, idx).trim()
  return message.content
}
</script>

<template>
  <div ref="scroller" class="list">
    <div v-if="!messages.length" class="empty">
      <h3>开始一次 AI 浏览器检测</h3>
      <p>
        在右侧输入测试目标，例如：「打开目标页，检查首页布局、核心交互和接口错误，并输出问题报告」。
      </p>
      <ul>
        <li>流式输出思考与结论</li>
        <li>自动调用浏览器工具</li>
        <li>展示接口 / 控制台 / 截图证据</li>
        <li>可上传测试用例文件：提示词 + Skill + 用例一起执行</li>
      </ul>
    </div>

    <article
      v-for="message in messages"
      :key="message.id"
      class="message"
      :class="message.role"
    >
      <div class="meta">
        <span class="role">{{ message.role === 'user' ? '你' : 'AI 测试员' }}</span>
        <span v-if="message.streaming" class="streaming">输出中...</span>
      </div>

      <div v-if="message.attachments?.length" class="attachments">
        <div v-for="(file, idx) in message.attachments" :key="`${message.id}_att_${idx}`" class="attachment">
          <span class="attachment__badge">{{ file.type === 'test-case' ? '测试用例' : '附件' }}</span>
          <div class="attachment__meta">
            <strong>{{ file.fileName }}</strong>
            <span>{{ formatAttachmentSize(file.size) }} · 已随提示词发送给 AI</span>
          </div>
        </div>
      </div>

      <div
        v-if="displayContent(message)"
        class="content markdown-body"
        v-html="renderMarkdown(displayContent(message))"
      />

      <div v-if="message.tools?.length" class="tools">
        <div class="tools-head">
          <span class="tools-title">工具调用</span>
          <span class="tools-count">{{ message.tools.length }}</span>
        </div>
        <div class="tools-list" :ref="(el) => setToolsScroller(message.id, el as Element | null)">
          <details
            v-for="(tool, index) in message.tools"
            :key="`${message.id}_${tool.id || tool.name}_${index}`"
            class="tool"
            :class="tool.status"
            :open="tool.status === 'running' || index === message.tools.length - 1"
          >
            <summary>
              <span class="tool-index">{{ index + 1 }}</span>
              <span class="tool-main">
                <span class="tool-name">{{ tool.name }}</span>
                <span v-if="tool.summary" class="tool-summary-inline">{{ tool.summary }}</span>
              </span>
              <span class="tool-status" :class="tool.status">{{
                tool.status === 'running' ? '执行中' : tool.ok === false ? '失败' : '完成'
              }}</span>
            </summary>
            <div class="tool-body">
              <pre v-if="tool.arguments" class="code">{{ tool.arguments }}</pre>
              <pre v-if="tool.data" class="code">{{ JSON.stringify(tool.data, null, 2) }}</pre>
              <img
                v-if="screenshotSrc(tool)"
                class="shot"
                :src="screenshotSrc(tool)"
                alt="screenshot"
              />
            </div>
          </details>
        </div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.empty {
  margin: auto;
  max-width: 520px;
  text-align: left;
  padding: 28px;
  border: 1px dashed var(--border);
  border-radius: 18px;
  background: var(--panel-soft);
}

.empty h3 {
  margin: 0 0 8px;
}

.empty p,
.empty li {
  color: var(--muted);
  line-height: 1.6;
}

.message {
  max-width: min(820px, 100%);
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid var(--border);
  background: var(--panel);
}

.message.user {
  align-self: flex-end;
  background: color-mix(in srgb, var(--accent) 12%, var(--panel));
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
}

.message.assistant {
  align-self: flex-start;
}

.meta {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 8px;
}

.role {
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.streaming {
  font-size: 12px;
  color: var(--accent);
}

.content {
  line-height: 1.7;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.markdown-body :deep(:first-child) {
  margin-top: 0;
}

.markdown-body :deep(:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(p),
.markdown-body :deep(ul),
.markdown-body :deep(ol),
.markdown-body :deep(blockquote),
.markdown-body :deep(pre),
.markdown-body :deep(table) {
  margin: 0 0 0.85em;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  margin: 1em 0 0.5em;
  line-height: 1.35;
  font-weight: 700;
}

.markdown-body :deep(h1) {
  font-size: 1.35em;
}

.markdown-body :deep(h2) {
  font-size: 1.2em;
}

.markdown-body :deep(h3) {
  font-size: 1.08em;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 1.4em;
}

.markdown-body :deep(li + li) {
  margin-top: 0.25em;
}

.markdown-body :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.markdown-body :deep(blockquote) {
  margin-left: 0;
  padding: 0.2em 0 0.2em 0.9em;
  border-left: 3px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  color: var(--muted);
}

.markdown-body :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.92em;
  padding: 0.12em 0.35em;
  border-radius: 6px;
  background: color-mix(in srgb, var(--panel-soft) 70%, #cbd5e1);
}

.markdown-body :deep(pre) {
  padding: 10px 12px;
  border-radius: 10px;
  background: #0f172a;
  color: #e2e8f0;
  overflow: auto;
  font-size: 12px;
  line-height: 1.5;
}

.markdown-body :deep(pre code) {
  padding: 0;
  background: transparent;
  color: inherit;
  font-size: inherit;
}

.markdown-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  display: block;
  overflow-x: auto;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
}

.markdown-body :deep(th) {
  background: var(--panel-soft);
  font-weight: 600;
}

.markdown-body :deep(hr) {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 1em 0;
}

.markdown-body :deep(img) {
  max-width: 100%;
  border-radius: 10px;
}

.tools {
  margin-top: 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--panel-soft) 88%, transparent);
  overflow: visible;
}

.tools-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel-soft) 70%, #fff 8%);
}

.tools-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}

.tools-count {
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
  background: color-mix(in srgb, var(--border) 55%, transparent);
}

.tools-list {
  display: flex;
  flex-direction: column;
  max-height: min(48vh, 420px);
  overflow: auto;
  padding: 0 0 20px;
  scroll-padding-bottom: 20px;
  scrollbar-gutter: stable;
  border-bottom-left-radius: 12px;
  border-bottom-right-radius: 12px;
}

.tool {
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 0;
  background: transparent;
  padding: 0;
  scroll-margin-bottom: 16px;
}

.tool:last-child {
  border-bottom: 0;
  margin-bottom: 4px;
}

.tool.running {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

.tool.error {
  background: color-mix(in srgb, #fecdca 28%, transparent);
}

summary {
  cursor: pointer;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1.35;
  list-style: none;
}

summary::-webkit-details-marker {
  display: none;
}

.tool-index {
  width: 18px;
  height: 18px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: var(--muted);
  background: color-mix(in srgb, var(--border) 60%, transparent);
}

.tool-main {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.tool-name {
  flex: 0 0 auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  font-weight: 600;
}

.tool-summary-inline {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 12px;
}

.tool-status {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
}

.tool-status.running {
  color: var(--accent);
}

.tool-status.error,
.tool.error .tool-status {
  color: #d92d20;
}

.tool-body {
  padding: 0 10px 12px 36px;
}

.code {
  margin: 0 0 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #0f172a;
  color: #e2e8f0;
  overflow: auto;
  max-height: 180px;
  font-size: 11px;
  line-height: 1.45;
}

.code:last-child {
  margin-bottom: 0;
}

.shot {
  display: block;
  margin-top: 2px;
  max-width: 100%;
  max-height: 220px;
  object-fit: contain;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #0f172a;
}
</style>
