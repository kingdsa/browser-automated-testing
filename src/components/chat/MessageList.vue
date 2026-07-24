<script setup lang="ts">
import { nextTick, watch, ref } from 'vue'
import type { ChatMessageItem } from '@/types/chat'
import { renderMarkdown } from '@/utils/markdown'

const props = defineProps<{
  messages: ChatMessageItem[]
}>()

const scroller = ref<HTMLElement | null>(null)

watch(
  () => props.messages.map((m) => `${m.id}:${m.content.length}:${m.tools?.length || 0}`).join('|'),
  async () => {
    await nextTick()
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
  },
)

function screenshotSrc(tool: NonNullable<ChatMessageItem['tools']>[number]) {
  if (tool.screenshotBase64) return `data:image/png;base64,${tool.screenshotBase64}`
  if (tool.screenshotPath) return tool.screenshotPath
  return ''
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

      <div
        v-if="message.content"
        class="content markdown-body"
        v-html="renderMarkdown(message.content)"
      />

      <div v-if="message.tools?.length" class="tools">
        <div class="tools-head">
          <span class="tools-title">工具调用</span>
          <span class="tools-count">{{ message.tools.length }}</span>
        </div>
        <div class="tools-list">
          <details
            v-for="(tool, index) in message.tools"
            :key="`${message.id}_${tool.id || tool.name}_${index}`"
            class="tool"
            :class="tool.status"
            :open="tool.status === 'running'"
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
  overflow: hidden;
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
  max-height: min(42vh, 360px);
  overflow: auto;
}

.tool {
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 0;
  background: transparent;
  padding: 0;
}

.tool:last-child {
  border-bottom: 0;
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
  padding: 0 10px 8px 36px;
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
