<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  disabled?: boolean
  running?: boolean
}>()

const emit = defineEmits<{
  send: [value: string]
  stop: []
}>()

const text = ref('')

const presets = [
  '像测试人员一样检查当前页面：布局、可用性、接口错误、控制台报错，最后请输出完整 Markdown 测试报告。',
  '打开目标页后先做快照，再检查首屏布局和关键按钮是否可点击，最后请给我一份 MD 文档结论。',
  '重点检查网络请求失败、4xx/5xx 接口与控制台报错，并在结尾输出可直接保存的 Markdown 报告。',
]

function submit() {
  if (props.disabled || props.running) return
  const value = text.value.trim()
  if (!value) return
  emit('send', value)
  text.value = ''
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

    <div class="box">
      <textarea
        v-model="text"
        rows="3"
        placeholder="描述测试目标，并明确要求 AI 输出 Markdown 文档，例如：检查登录页布局与接口错误，最后输出完整 MD 测试报告..."
        :disabled="running"
        @keydown="onKeydown"
      />
      <p class="md-tip">保存结果只会保留最后一次 AI 的 MD 文档，请在输入中明确要求：输出完整 Markdown 报告</p>
      <div class="actions">
        <span class="hint">Enter 发送 · Shift+Enter 换行</span>
        <div class="buttons">
          <button v-if="running" type="button" class="danger" @click="emit('stop')">停止</button>
          <button type="button" class="primary" :disabled="disabled || running || !text.trim()" @click="submit">
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
  background: color-mix(in srgb, var(--panel) 92%, transparent);
  backdrop-filter: blur(8px);
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
  color: var(--text);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}

.box {
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--input);
  padding: 10px;
}

.md-tip {
  margin: 8px 2px 0;
  color: #b54708;
  background: #fffaeb;
  border: 1px solid #fedf89;
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
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
  line-height: 1.6;
}

.actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}

.hint {
  color: var(--muted);
  font-size: 12px;
}

.buttons {
  display: flex;
  gap: 8px;
}

button.primary,
button.danger {
  border: none;
  border-radius: 10px;
  padding: 10px 14px;
  cursor: pointer;
  font-weight: 600;
}

button.primary {
  background: var(--accent);
  color: white;
}

button.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.danger {
  background: #fee4e2;
  color: #b42318;
}
</style>
