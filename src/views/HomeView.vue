<script setup lang="ts">
import AppNav from '@/components/requirements/AppNav.vue'
import Composer from '@/components/chat/Composer.vue'
import MessageList from '@/components/chat/MessageList.vue'
import SettingsPanel from '@/components/chat/SettingsPanel.vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { computed, onMounted, ref } from 'vue'
import { fetchDefaults } from '@/api/agent'
import { defaultReportName, getLastAssistantMarkdown, saveMarkdownFile } from '@/utils/report'

defineOptions({ name: 'HomeView' })

const chat = useChatStore()
const settings = useSettingsStore()
const serverHasKey = ref(false)

const saving = ref(false)
const saveTip = ref('')
let saveTipTimer: ReturnType<typeof setTimeout> | null = null

onMounted(async () => {
  try {
    const defaults = await fetchDefaults()
    serverHasKey.value = defaults.llm.hasApiKey
    await settings.hydrateFromServer()
  } catch {
    serverHasKey.value = false
  }
})

const canSend = computed(() => {
  const llm = settings.settings.llm
  const hasKey = Boolean(llm.apiKey) || serverHasKey.value
  return Boolean(llm.baseUrl && hasKey && llm.model)
})

const lastAssistantMarkdown = computed(() => getLastAssistantMarkdown(chat.messages))

const hasResult = computed(() => Boolean(lastAssistantMarkdown.value))

const canSave = computed(() => !chat.isRunning && hasResult.value)

function flashTip(message: string) {
  saveTip.value = message
  if (saveTipTimer) clearTimeout(saveTipTimer)
  saveTipTimer = setTimeout(() => {
    saveTip.value = ''
  }, 4000)
}

async function saveReport() {
  if (!canSave.value || saving.value) return
  const content = lastAssistantMarkdown.value
  if (!content) {
    flashTip('暂无最终 Markdown 报告可保存（过程分析不会被保存）')
    return
  }
  saving.value = true
  try {
    const result = await saveMarkdownFile(content, defaultReportName())
    flashTip(result === 'picked' ? '已保存最终 Markdown 报告' : '当前浏览器不支持选目录，已下载最终 Markdown 报告')
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      // 用户在保存对话框点了取消，无需提示
    } else {
      flashTip(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="topbar__left">
        <AppNav />
        <div class="titles">
          <h1>Browser Automated Testing</h1>
          <p>AI 模拟测试人员 · 控制浏览器 · 流式反馈</p>
        </div>
      </div>
      <div class="topbar__actions">
        <Transition name="tip">
          <span v-if="saveTip" class="save-tip">{{ saveTip }}</span>
        </Transition>
        <button
          type="button"
          class="btn ghost save"
          :disabled="!canSave || saving"
          :title="canSave ? '仅保存最终 Markdown 报告，不含过程分析' : '请先让 AI 输出完整最终 MD 报告后再保存'"
          @click="saveReport"
        >
          {{ saving ? '保存中...' : '保存本次测试结果' }}
        </button>
        <button type="button" class="btn ghost" :disabled="chat.isRunning" @click="chat.clear()">
          清空会话
        </button>
      </div>
    </header>

    <div class="shell-body">
      <SettingsPanel />

      <main class="main">
        <div v-if="chat.statusText || chat.errorText" class="status-bar" :class="{ error: !!chat.errorText }">
          <span class="status-dot" aria-hidden="true"></span>
          <span>{{ chat.errorText || chat.statusText }}</span>
        </div>

        <MessageList :messages="chat.visibleMessages" />

        <Composer
          :disabled="!canSend"
          :running="chat.isRunning"
          :config-tip="canSend ? '' : '请先配置 Base URL / Model；API Key 可写在页面或服务端 .env'"
          @send="chat.send"
          @stop="chat.stop"
        />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100%;
  overflow: hidden;
  color: var(--text);
}

.topbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  flex-shrink: 0;
  min-height: 60px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel) 82%, transparent);
  backdrop-filter: blur(12px);
  box-shadow: var(--shadow-xs);
  z-index: 5;
}

.topbar__left {
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 0;
}

.titles {
  min-width: 0;
  padding-left: 16px;
  border-left: 1px solid var(--border);
}

.titles h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.titles p {
  margin: 2px 0 0;
  color: var(--muted);
  font-size: 12px;
  letter-spacing: 0.01em;
}

.topbar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.save-tip {
  font-size: 12px;
  color: var(--info-text);
  background: var(--info-soft);
  border: 1px solid var(--info-border);
  border-radius: var(--radius-pill);
  padding: 6px 10px;
  max-width: 280px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.btn {
  border-radius: var(--radius-md);
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  min-height: 36px;
}

.btn.ghost {
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel-soft) 80%, transparent);
  color: var(--text);
}

.btn.ghost:hover:not(:disabled) {
  border-color: var(--border-hover);
  background: var(--surface-hover);
  transform: translateY(-1px);
}

.btn.ghost.save:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  color: var(--accent);
  background: var(--accent-soft);
}

.btn.ghost.save:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: color-mix(in srgb, var(--accent-soft) 70%, var(--accent));
  color: var(--text-on-accent);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.shell-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 320px 1fr;
  overflow: hidden;
}

.shell-body > :deep(*) {
  min-height: 0;
}

.main {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: color-mix(in srgb, var(--bg-elevated) 55%, transparent);
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin: 12px 16px 0;
  padding: 9px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--info-border);
  background: var(--info-soft);
  color: var(--info-text);
  font-size: 13px;
  animation: fade-up 0.35s var(--ease-out) both;
}

.status-bar.error {
  border-color: var(--error-border);
  background: var(--error-soft);
  color: var(--error-text);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 0 currentColor;
  animation: signal-glow 1.8s ease-out infinite;
  flex-shrink: 0;
}

.tip-enter-active,
.tip-leave-active {
  transition:
    opacity var(--duration-normal) var(--ease-out),
    transform var(--duration-normal) var(--ease-out);
}

.tip-enter-from,
.tip-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 1100px) {
  .titles {
    display: none;
  }

  .shell-body {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }
}

@media (max-width: 760px) {
  .topbar {
    padding: 10px 12px;
    align-items: flex-start;
    flex-direction: column;
  }

  .topbar__actions {
    width: 100%;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .btn {
    min-height: 40px;
  }
}
</style>
