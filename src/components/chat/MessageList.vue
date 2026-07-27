<script setup lang="ts">
import { nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { ChatMessageItem, ChatMessageSegment, ToolTrace } from '@/types/chat'
import { renderMarkdown } from '@/utils/markdown'
import { formatAttachmentSize } from '@/utils/testCases'

const props = defineProps<{
  messages: ChatMessageItem[]
}>()

const scroller = ref<HTMLElement | null>(null)
const toolsScrollers = new Map<string, HTMLElement>()
const toolsObservers = new Map<string, ResizeObserver>()
const collapsedBlockIds = reactive(new Set<string>())
const pinnedToBottom = ref(true)
const BOTTOM_THRESHOLD = 80

type RenderBlock =
  | {
      id: string
      type: 'user'
      message: ChatMessageItem
    }
  | {
      id: string
      type: 'analysis'
      messageId: string
      segments: ChatMessageSegment[]
    }
  | {
      id: string
      type: 'tools'
      messageId: string
      tools: ToolTrace[]
    }
  | {
      id: string
      type: 'report'
      messageId: string
      segments: ChatMessageSegment[]
    }
  | {
      id: string
      type: 'legacy'
      message: ChatMessageItem
    }

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

function isCollapsed(blockId: string) {
  return collapsedBlockIds.has(blockId)
}

function toggleBlock(blockId: string) {
  if (collapsedBlockIds.has(blockId)) collapsedBlockIds.delete(blockId)
  else collapsedBlockIds.add(blockId)
}

function disconnectToolsObserver(messageId: string) {
  const observer = toolsObservers.get(messageId)
  if (observer) {
    observer.disconnect()
    toolsObservers.delete(messageId)
  }
}

function scrollToolsListToLatest(el: HTMLElement) {
  const last = el.lastElementChild as HTMLElement | null
  if (!last) {
    el.scrollTop = el.scrollHeight
    return
  }

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

  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
  if (el.scrollTop < maxScroll) {
    el.scrollTop = maxScroll
  }
}

function observeToolsList(messageId: string, el: HTMLElement) {
  disconnectToolsObserver(messageId)
  const observer = new ResizeObserver(() => {
    if (!pinnedToBottom.value) return
    scrollToolsListToLatest(el)
    if (scroller.value && pinnedToBottom.value) {
      scroller.value.scrollTop = scroller.value.scrollHeight
    }
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

function scrollAllToolsToLatest() {
  for (const el of toolsScrollers.values()) {
    scrollToolsListToLatest(el)
  }
}

function scrollToBottom(force = false) {
  const el = scroller.value
  if (!el) return
  if (!force && !pinnedToBottom.value) return
  el.scrollTop = el.scrollHeight
}

function scheduleScrollToLatest(force = false) {
  if (!force && !pinnedToBottom.value) return

  const run = () => {
    if (!force && !pinnedToBottom.value) return
    scrollAllToolsToLatest()
    scrollToBottom(force)
  }

  run()
  requestAnimationFrame(() => {
    run()
    requestAnimationFrame(run)
  })
  window.setTimeout(run, 40)
  window.setTimeout(run, 140)
}

function jumpToLatest() {
  pinnedToBottom.value = true
  scheduleScrollToLatest(true)
}

watch(
  () => props.messages.map((m) => m.id).join('|'),
  async () => {
    pinnedToBottom.value = true
    await nextTick()
    scheduleScrollToLatest(true)
  },
)

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
        const segments = (m.segments || [])
          .map((s) => `${s.id}:${s.kind}:${s.content.length}:${s.streaming ? 1 : 0}`)
          .join(',')
        return `${m.id}:${m.content.length}:${m.streaming ? 1 : 0}:${segments}:${tools}`
      })
      .join('|'),
  async () => {
    await nextTick()
    for (const [messageId, el] of toolsScrollers.entries()) {
      observeToolsList(messageId, el)
    }
    scheduleScrollToLatest(false)
  },
)

onBeforeUnmount(() => {
  for (const messageId of [...toolsObservers.keys()]) {
    disconnectToolsObserver(messageId)
  }
  toolsScrollers.clear()
})

function screenshotSrc(tool: ToolTrace) {
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

function joinSegmentContent(segments: ChatMessageSegment[]) {
  return segments
    .map((segment) => segment.content)
    .join('\n\n')
    .trim()
}

function segmentStreaming(segments: ChatMessageSegment[]) {
  return segments.some((segment) => segment.streaming)
}

function buildBlocks(messages: ChatMessageItem[]): RenderBlock[] {
  const blocks: RenderBlock[] = []

  for (const message of messages) {
    if (message.role === 'user') {
      blocks.push({
        id: `user:${message.id}`,
        type: 'user',
        message,
      })
      continue
    }

    if (message.role !== 'assistant') continue

    const segments = message.segments || []
    if (!segments.length) {
      // Legacy / fallback single assistant bubble.
      if (message.content || message.tools?.length || message.streaming) {
        blocks.push({
          id: `legacy:${message.id}`,
          type: 'legacy',
          message,
        })
      }
      continue
    }

    const analysis = segments.filter((segment) => segment.kind === 'analysis' && (segment.content || segment.streaming))
    const report = segments.filter((segment) => segment.kind === 'report' && (segment.content || segment.streaming))

    if (analysis.length) {
      blocks.push({
        id: `analysis:${message.id}`,
        type: 'analysis',
        messageId: message.id,
        segments: analysis,
      })
    }

    if (message.tools?.length) {
      blocks.push({
        id: `tools:${message.id}`,
        type: 'tools',
        messageId: message.id,
        tools: message.tools,
      })
    }

    if (report.length) {
      blocks.push({
        id: `report:${message.id}`,
        type: 'report',
        messageId: message.id,
        segments: report,
      })
    } else if (!analysis.length && message.streaming) {
      // Waiting for the first tokens.
      blocks.push({
        id: `analysis:${message.id}`,
        type: 'analysis',
        messageId: message.id,
        segments: [
          {
            id: `${message.id}_placeholder`,
            kind: 'analysis',
            content: '',
            streaming: true,
          },
        ],
      })
    }
  }

  return blocks
}

function blockTitle(block: RenderBlock) {
  if (block.type === 'user') return '你'
  if (block.type === 'analysis') {
    return segmentStreaming(block.segments) ? 'AI 输出中' : 'AI 分析过程'
  }
  if (block.type === 'tools') return '工具调用'
  if (block.type === 'report') return '最终 Markdown 报告'
  return 'AI 测试员'
}

function blockStreaming(block: RenderBlock) {
  if (block.type === 'user') return false
  if (block.type === 'analysis' || block.type === 'report') return segmentStreaming(block.segments)
  if (block.type === 'tools') return block.tools.some((tool) => tool.status === 'running')
  return Boolean(block.message.streaming)
}
</script>

<template>
  <div class="list-wrap">
    <div ref="scroller" class="list" @scroll.passive="onListScroll">
      <div v-if="!messages.length" class="empty">
        <div class="empty__badge">Signal Lab</div>
        <h3>开始一次 AI 浏览器检测</h3>
        <p>
          在下方输入测试目标，例如：「打开目标页，检查首页布局、核心交互和接口错误，并输出问题报告」。
        </p>
        <ul>
          <li>流式输出思考与结论</li>
          <li>自动调用浏览器工具</li>
          <li>展示接口 / 控制台 / 截图证据</li>
          <li>可上传测试用例文件：提示词 + Skill + 用例一起执行</li>
        </ul>
      </div>

      <article
        v-for="block in buildBlocks(messages)"
        :key="block.id"
        class="message"
        :class="[
          block.type === 'user' ? 'user' : 'assistant',
          block.type,
          { collapsed: isCollapsed(block.id) },
        ]"
      >
        <button
          type="button"
          class="meta"
          :aria-expanded="!isCollapsed(block.id)"
          :title="isCollapsed(block.id) ? '展开内容' : '收起内容'"
          @click="toggleBlock(block.id)"
        >
          <span class="meta__labels">
            <span class="role">{{ blockTitle(block) }}</span>
            <span v-if="blockStreaming(block)" class="streaming">输出中...</span>
            <span v-if="block.type === 'tools'" class="tools-count">{{ block.tools.length }}</span>
          </span>
          <span class="collapse-icon" aria-hidden="true" />
        </button>

        <template v-if="!isCollapsed(block.id)">
          <template v-if="block.type === 'user'">
            <div
              v-if="displayContent(block.message)"
              class="content markdown-body"
              v-html="renderMarkdown(displayContent(block.message))"
            />
            <div v-if="block.message.attachments?.length" class="attachments">
              <div
                v-for="(file, index) in block.message.attachments"
                :key="`${block.message.id}_file_${index}`"
                class="attachment"
              >
                <span class="attachment__badge">用例</span>
                <div class="attachment__meta">
                  <strong>{{ file.fileName }}</strong>
                  <span>{{ formatAttachmentSize(file.size) }}</span>
                </div>
              </div>
            </div>
          </template>

          <template v-else-if="block.type === 'analysis' || block.type === 'report'">
            <div
              v-if="joinSegmentContent(block.segments)"
              class="content markdown-body"
              :class="{ 'report-body': block.type === 'report' }"
              v-html="renderMarkdown(joinSegmentContent(block.segments))"
            />
            <div v-else-if="blockStreaming(block)" class="content placeholder">正在输出...</div>
          </template>

          <template v-else-if="block.type === 'tools'">
            <div class="tools">
              <div
                class="tools-list"
                :ref="(el) => setToolsScroller(block.messageId, el as Element | null)"
              >
                <details
                  v-for="(tool, index) in block.tools"
                  :key="`${block.messageId}_${tool.id || tool.name}_${index}`"
                  class="tool"
                  :class="tool.status"
                  :open="tool.status === 'running' || index === block.tools.length - 1"
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
          </template>

          <template v-else>
            <div
              v-if="displayContent(block.message)"
              class="content markdown-body"
              v-html="renderMarkdown(displayContent(block.message))"
            />
            <div v-if="block.message.tools?.length" class="tools">
              <div
                class="tools-list"
                :ref="(el) => setToolsScroller(block.message.id, el as Element | null)"
              >
                <details
                  v-for="(tool, index) in block.message.tools"
                  :key="`${block.message.id}_${tool.id || tool.name}_${index}`"
                  class="tool"
                  :class="tool.status"
                  :open="tool.status === 'running' || index === (block.message.tools?.length || 0) - 1"
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
          </template>
        </template>
      </article>
    </div>

    <button
      v-if="messages.length && !pinnedToBottom"
      type="button"
      class="jump-latest"
      @click="jumpToLatest"
    >
      回到最新
    </button>
  </div>
</template>

<style scoped>
.list-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 18px 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.empty {
  margin: auto;
  max-width: 560px;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--accent) 14%, transparent), transparent 42%),
    radial-gradient(circle at bottom right, color-mix(in srgb, var(--accent-secondary) 12%, transparent), transparent 48%),
    color-mix(in srgb, var(--panel) 92%, transparent);
  box-shadow: var(--shadow-sm);
  padding: 28px 26px;
  animation: fade-up 0.5s var(--ease-out) both;
}

.empty__badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  padding: 4px 10px;
  border-radius: var(--radius-pill);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.empty__badge::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent);
}

.empty h3 {
  margin: 0 0 8px;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.empty p {
  margin: 0 0 14px;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

.empty ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}

.empty li {
  position: relative;
  padding: 10px 12px 10px 34px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel-soft) 80%, transparent);
  color: var(--text-secondary);
  font-size: 13px;
}

.empty li::before {
  content: '';
  position: absolute;
  left: 12px;
  top: 50%;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transform: translateY(-50%);
  background: var(--accent);
  box-shadow: 0 0 0 4px var(--accent-soft);
}

.message {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--panel) 92%, transparent);
  padding: 14px 16px;
  box-shadow: var(--shadow-xs);
  animation: fade-up 0.35s var(--ease-out) both;
}

.message.user {
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, transparent), transparent 60%),
    color-mix(in srgb, var(--panel) 94%, transparent);
  border-color: color-mix(in srgb, var(--accent) 22%, var(--border));
}

.message.assistant {
  background: color-mix(in srgb, var(--panel) 94%, transparent);
}

.message.report {
  border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--accent) 7%, transparent), transparent 42%),
    color-mix(in srgb, var(--panel) 96%, transparent);
}

.message.analysis {
  border-color: color-mix(in srgb, var(--accent-secondary) 22%, var(--border));
}

.message.collapsed {
  padding-bottom: 12px;
}

.meta {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
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
  align-items: center;
  gap: 8px;
}

.role {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}

.message.user .role {
  color: var(--accent);
}

.message.assistant .role {
  color: var(--accent-secondary);
}

.message.report .role {
  color: var(--accent);
}

.streaming {
  font-size: 11px;
  font-weight: 600;
  color: var(--info-text);
  background: var(--info-soft);
  border: 1px solid var(--info-border);
  border-radius: var(--radius-pill);
  padding: 2px 8px;
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
  background: var(--panel-soft);
  color: var(--text);
}

.content {
  font-size: 14px;
  line-height: 1.7;
  word-break: break-word;
  color: var(--text);
}

.content.placeholder {
  color: var(--muted);
  font-size: 13px;
}

.report-body {
  padding: 4px 2px 0;
}

.attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.attachment {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--info-border);
  background: var(--info-soft);
  color: var(--info-text);
  border-radius: var(--radius-md);
  padding: 6px 10px;
  font-size: 12px;
}

.attachment__badge {
  flex-shrink: 0;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
}

.attachment__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.attachment__meta strong {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment__meta span {
  color: var(--muted);
  font-size: 11px;
}

.markdown-body :deep(p) {
  margin: 0.55em 0;
}

.markdown-body :deep(p:first-child) {
  margin-top: 0;
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
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
  letter-spacing: -0.01em;
}

.markdown-body :deep(h1) { font-size: 1.35em; }
.markdown-body :deep(h2) { font-size: 1.2em; }
.markdown-body :deep(h3) { font-size: 1.08em; }

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
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.92em;
  padding: 0.12em 0.35em;
  border-radius: 6px;
  background: var(--code-inline-bg);
}

.markdown-body :deep(pre) {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--code-bg);
  color: var(--code-text);
  overflow: auto;
  font-size: 12px;
  line-height: 1.5;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
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
  border-radius: var(--radius-md);
}

.tools {
  margin-top: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--panel-soft) 88%, transparent);
  overflow: hidden;
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
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
}

.tools-list {
  display: flex;
  flex-direction: column;
  max-height: min(48vh, 420px);
  overflow: auto;
  padding: 0 0 20px;
  scroll-padding-bottom: 20px;
  scrollbar-gutter: stable;
}

.tool {
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
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
  background: color-mix(in srgb, var(--error) 8%, transparent);
}

summary {
  cursor: pointer;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
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
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.tool-main {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.tool-name {
  flex: 0 0 auto;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
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
  animation: pulse-soft 1.3s ease-in-out infinite;
}

.tool-status.error,
.tool.error .tool-status {
  color: var(--error-text);
}

.tool-body {
  padding: 0 12px 12px 38px;
}

.code {
  margin: 0 0 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--code-bg);
  color: var(--code-text);
  overflow: auto;
  max-height: 180px;
  font-size: 11px;
  line-height: 1.45;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
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
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--code-bg);
}

.jump-latest {
  position: absolute;
  left: 50%;
  bottom: 16px;
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
  z-index: 2;
}

.jump-latest:hover {
  background: var(--info-border);
}
</style>
