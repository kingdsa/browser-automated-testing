<script setup lang="ts">
import Composer from '@/components/chat/Composer.vue'
import MessageList from '@/components/chat/MessageList.vue'
import SettingsPanel from '@/components/chat/SettingsPanel.vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { computed, onMounted, ref } from 'vue'
import { fetchDefaults } from '@/api/agent'
import { buildMarkdownReport, defaultReportName, saveMarkdownFile } from '@/utils/report'

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

const hasResult = computed(() =>
  chat.messages.some((m) => m.role === 'assistant' && m.content.trim() && !m.streaming),
)

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
  saving.value = true
  try {
    const content = buildMarkdownReport(chat.messages, {
      targetUrl: settings.settings.session.targetUrl,
      model: settings.settings.llm.model,
    })
    const result = await saveMarkdownFile(content, defaultReportName())
    flashTip(result === 'picked' ? '已保存到所选位置' : '当前浏览器不支持选目录，已下载到默认下载文件夹')
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
  <div class="layout">
    <SettingsPanel />

    <main class="main">
      <header class="topbar">
        <div>
          <h1>Browser Automated Testing</h1>
          <p>AI 模拟测试人员 · 控制浏览器 · 流式反馈</p>
        </div>
        <div class="topbar__actions">
          <Transition name="tip">
            <span v-if="saveTip" class="save-tip">{{ saveTip }}</span>
          </Transition>
          <button
            type="button"
            class="ghost save"
            :disabled="!canSave || saving"
            :title="canSave ? '保存本次测试结果为 Markdown' : '分析结束后可保存结果'"
            @click="saveReport"
          >
            {{ saving ? '保存中...' : '保存本次测试结果' }}
          </button>
          <button type="button" class="ghost" :disabled="chat.isRunning" @click="chat.clear()">
            清空会话
          </button>
        </div>
      </header>

      <div v-if="chat.statusText || chat.errorText" class="status-bar" :class="{ error: !!chat.errorText }">
        <span>{{ chat.errorText || chat.statusText }}</span>
      </div>

      <MessageList :messages="chat.visibleMessages" />

      <Composer
        :disabled="!canSend"
        :running="chat.isRunning"
        @send="chat.send"
        @stop="chat.stop"
      />

      <p v-if="!canSend" class="config-tip">请先配置 Base URL / Model；API Key 可写在页面或服务端 .env</p>
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 340px 1fr;
  height: 100vh;
  width: 100%;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
}

.layout > :deep(*) {
  min-height: 0;
}

.main {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.topbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  flex-shrink: 0;
  padding: 18px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}

.topbar h1 {
  margin: 0;
  font-size: 20px;
}

.topbar p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 13px;
}

.topbar__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.save-tip {
  font-size: 12px;
  color: #175cd3;
  background: #eff8ff;
  border: 1px solid #b2ddff;
  border-radius: 999px;
  padding: 4px 10px;
  white-space: nowrap;
}

.tip-enter-active,
.tip-leave-active {
  transition: opacity 0.2s ease;
}

.tip-enter-from,
.tip-leave-to {
  opacity: 0;
}

.ghost {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  border-radius: 10px;
  padding: 8px 12px;
  cursor: pointer;
}

.ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ghost.save:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  color: var(--accent);
  font-weight: 600;
}

.status-bar {
  flex-shrink: 0;
  padding: 8px 24px;
  font-size: 13px;
  color: #175cd3;
  background: #eff8ff;
  border-bottom: 1px solid #b2ddff;
}

.status-bar.error {
  color: #b42318;
  background: #fef3f2;
  border-bottom-color: #fecdca;
}

.config-tip {
  position: absolute;
  left: 24px;
  bottom: 110px;
  margin: 0;
  color: #b54708;
  background: #fffaeb;
  border: 1px solid #fedf89;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 12px;
}

@media (max-width: 960px) {
  .layout {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(240px, 40vh) 1fr;
    height: 100vh;
    overflow: hidden;
  }
}
</style>
