<script setup lang="ts">
import Composer from '@/components/chat/Composer.vue'
import MessageList from '@/components/chat/MessageList.vue'
import SettingsPanel from '@/components/chat/SettingsPanel.vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { computed, onMounted, ref } from 'vue'
import { fetchDefaults } from '@/api/agent'

const chat = useChatStore()
const settings = useSettingsStore()
const serverHasKey = ref(false)

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

.ghost {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  border-radius: 10px;
  padding: 8px 12px;
  cursor: pointer;
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
