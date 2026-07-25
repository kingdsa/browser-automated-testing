<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ChatAttachment } from '@/types/chat'
import {
  TEST_CASE_FILE_ACCEPT,
  MAX_TEST_CASE_FILE_BYTES,
  formatAttachmentSize,
  isSupportedTestCaseFile,
  normalizeTestCaseContent,
} from '@/utils/testCases'

const props = defineProps<{
  disabled?: boolean
  running?: boolean
  configTip?: string
}>()

const emit = defineEmits<{
  send: [value: string, attachment?: ChatAttachment]
  stop: []
}>()

const text = ref('')
const attachment = ref<ChatAttachment | null>(null)
const attachError = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)
const dragOver = ref(false)

const presets = [
  '像测试人员一样检查当前页面：布局、可用性、接口错误、控制台报错，最后请输出完整 Markdown 测试报告。',
  '打开目标页后先做快照，再检查首屏布局和关键按钮是否可点击，最后请给我一份 MD 文档结论。',
  '重点检查网络请求失败、4xx/5xx 接口与控制台报错，并在结尾输出可直接保存的 Markdown 报告。',
  '请严格按照附件测试用例逐条执行，并在最终 Markdown 报告中输出用例对照表（通过/失败/阻塞+证据）。',
]

const canSubmit = computed(() => {
  if (props.disabled || props.running) return false
  return Boolean(text.value.trim() || attachment.value)
})

const attachmentLabel = computed(() => {
  if (!attachment.value) return ''
  return `${attachment.value.fileName} · ${formatAttachmentSize(attachment.value.size)}`
})

function submit() {
  if (!canSubmit.value) return
  const value =
    text.value.trim() ||
    (attachment.value
      ? '请严格按照附件测试用例执行浏览器测试，并输出完整 Markdown 测试报告（含用例对照表）。'
      : '')
  if (!value) return
  emit('send', value, attachment.value || undefined)
  text.value = ''
  attachment.value = null
  attachError.value = ''
  if (fileInputRef.value) fileInputRef.value.value = ''
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    submit()
  }
}

function usePreset(preset: string) {
  text.value = preset
}

function pickFile() {
  if (props.running) return
  fileInputRef.value?.click()
}

function clearAttachment() {
  attachment.value = null
  attachError.value = ''
  if (fileInputRef.value) fileInputRef.value.value = ''
}

async function loadFile(file: File | null | undefined) {
  attachError.value = ''
  if (!file) return

  if (!isSupportedTestCaseFile(file)) {
    attachError.value = '仅支持 Markdown / TXT / JSON / CSV / LOG 测试用例文件'
    return
  }
  if (file.size > MAX_TEST_CASE_FILE_BYTES) {
    attachError.value = `文件过大（上限 ${formatAttachmentSize(MAX_TEST_CASE_FILE_BYTES)}）`
    return
  }

  try {
    const raw = await file.text()
    const content = normalizeTestCaseContent(file.name, raw)
    if (!content.trim()) {
      attachError.value = '文件内容为空'
      return
    }
    attachment.value = {
      type: 'test-case',
      fileName: file.name,
      content,
      size: file.size,
      mimeType: file.type || undefined,
    }
  } catch (error) {
    attachError.value = error instanceof Error ? error.message : '读取文件失败'
  }
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  await loadFile(input.files?.[0])
}

async function onDrop(event: DragEvent) {
  event.preventDefault()
  dragOver.value = false
  if (props.running) return
  await loadFile(event.dataTransfer?.files?.[0])
}
</script>

<template>
  <footer class="composer">
    <div class="presets">
      <button
        v-for="preset in presets"
        :key="preset"
        type="button"
        class="chip"
        :disabled="running"
        @click="usePreset(preset)"
      >
        {{ preset.slice(0, 18) }}...
      </button>
    </div>

    <div
      class="box"
      :class="{ 'box--drag': dragOver }"
      @dragenter.prevent="dragOver = true"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop="onDrop"
    >
      <textarea
        v-model="text"
        rows="3"
        placeholder="描述测试目标；可上传测试用例文件，系统会把 提示词 + Skill + 用例 一起交给 AI..."
        :disabled="running"
        @keydown="onKeydown"
      />

      <div v-if="attachment" class="attach">
        <div class="attach__main">
          <span class="attach__badge">用例</span>
          <div class="attach__meta">
            <strong>{{ attachment.fileName }}</strong>
            <span>{{ formatAttachmentSize(attachment.size) }} · 将与提示词、Skill 一并发送给 AI</span>
          </div>
        </div>
        <button type="button" class="attach__remove" :disabled="running" @click="clearAttachment">移除</button>
      </div>

      <div class="tips">
        <p v-if="configTip" class="tip">{{ configTip }}</p>
        <p v-if="attachError" class="tip tip--error">{{ attachError }}</p>
        <p class="tip">
          可上传需求页导出的测试用例（MD/JSON）。发送时会组合：用户提示词 + control-chrome Skill + 用例附件。
        </p>
        <p class="tip">保存结果只会保留最后一次 AI 的 MD 文档，请在输入中明确要求：输出完整 Markdown 报告</p>
      </div>

      <div class="actions">
        <div class="left">
          <input
            ref="fileInputRef"
            class="file-input"
            type="file"
            :accept="TEST_CASE_FILE_ACCEPT"
            :disabled="running"
            @change="onFileChange"
          />
          <button type="button" class="ghost" :disabled="running" @click="pickFile">
            {{ attachment ? '更换用例文件' : '上传测试用例' }}
          </button>
          <span class="hint">{{ attachment ? attachmentLabel : '支持 MD / JSON / TXT · 可拖拽到输入框' }}</span>
        </div>
        <div class="buttons">
          <button v-if="running" type="button" class="danger" @click="emit('stop')">停止</button>
          <button type="button" class="primary" :disabled="!canSubmit" @click="submit">
            {{ running ? '测试中...' : '开始检测' }}
          </button>
        </div>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.composer {
  flex-shrink: 0;
  border-top: 1px solid var(--border);
  padding: 14px 18px 18px;
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  backdrop-filter: blur(12px);
}

.presets {
  display: flex;
  gap: 8px;
  overflow: auto;
  padding-bottom: 10px;
}

.chip {
  flex-shrink: 0;
  border: 1px solid var(--border);
  background: var(--panel-soft);
  color: var(--text-secondary);
  border-radius: var(--radius-pill);
  padding: 7px 12px;
  font-size: 12px;
  cursor: pointer;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.chip:hover {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  background: var(--accent-soft);
  color: var(--accent);
  transform: translateY(-1px);
  box-shadow: var(--shadow-xs);
}

.box {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--input);
  padding: 12px;
  box-shadow: var(--shadow-sm);
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out);
}

.box:focus-within {
  border-color: var(--accent);
  box-shadow: var(--shadow-focus);
}

.box--drag {
  border-color: var(--accent);
  box-shadow: var(--shadow-focus);
  background: color-mix(in srgb, var(--accent-soft) 55%, var(--input));
}

.tips {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 2px 0;
}

.tip {
  margin: 0;
  color: var(--warning-text);
  background: var(--warning-soft);
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-md);
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.55;
}

.tip--error {
  color: var(--error-text);
  background: var(--error-soft);
  border-color: var(--error-border);
}

textarea {
  width: 100%;
  border: none;
  resize: vertical;
  min-height: 72px;
  background: transparent;
  color: var(--text);
  outline: none;
  font: inherit;
  line-height: 1.7;
}

.attach {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--info-border);
  background: var(--info-soft);
}

.attach__main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.attach__badge {
  flex-shrink: 0;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  line-height: 1.4;
}

.attach__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.attach__meta strong {
  font-size: 13px;
  color: var(--info-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attach__meta span {
  font-size: 12px;
  color: var(--muted);
}

.attach__remove {
  flex-shrink: 0;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
}

.attach__remove:hover {
  border-color: var(--border-hover);
  background: var(--surface-hover);
}

.actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}

.left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.file-input {
  display: none;
}

.ghost {
  border: 1px solid var(--border);
  background: var(--panel-soft);
  color: var(--text);
  border-radius: var(--radius-md);
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
  min-height: 36px;
}

.ghost:hover:not(:disabled) {
  border-color: var(--border-hover);
  background: var(--surface-hover);
  transform: translateY(-1px);
}

.ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.hint {
  color: var(--muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.buttons {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

button.primary,
button.danger {
  border: none;
  border-radius: var(--radius-md);
  padding: 10px 16px;
  cursor: pointer;
  font-weight: 600;
  min-height: 40px;
}

button.primary {
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 92%, white), var(--accent));
  color: var(--text-on-accent);
  box-shadow:
    0 1px 0 color-mix(in srgb, white 18%, transparent) inset,
    0 8px 18px rgba(var(--accent-rgb), 0.22);
}

button.primary:hover:not(:disabled) {
  background: var(--accent-hover);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

button.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

button.danger {
  background: var(--error-soft);
  color: var(--error-text);
  border: 1px solid var(--error-border);
}

button.danger:hover {
  background: color-mix(in srgb, var(--error-soft) 70%, var(--error-border));
  transform: translateY(-1px);
}

@media (max-width: 860px) {
  .actions {
    flex-direction: column;
    align-items: stretch;
  }

  .left {
    flex-wrap: wrap;
  }

  .buttons {
    justify-content: flex-end;
  }

  button.primary,
  button.danger,
  .ghost {
    min-height: 44px;
  }
}
</style>
