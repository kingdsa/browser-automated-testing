<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { fetchBrowserTabs, fetchDefaults, fetchHealth, fetchSkills } from '@/api/agent'
import { useSettingsStore } from '@/stores/settings'

const settingsStore = useSettingsStore()
const health = ref<'unknown' | 'ok' | 'down'>('unknown')
const skills = ref<Array<{ name: string; description: string }>>([])
const hasServerKey = ref(false)
const tabsLoading = ref(false)
const tabsHint = ref('')
const tabs = ref<Array<{ endpoint: string; browser?: string; index: number; url: string; title: string }>>([])
const endpoints = ref<Array<{ endpoint: string; browser: string }>>([])

const browserModeLabel = computed(() => {
  const mode = settingsStore.settings.session.browserMode
  if (mode === 'attach') return '只附着已打开标签'
  if (mode === 'launch') return '只新开浏览器'
  return '自动（推荐）'
})

async function refreshMeta() {
  await settingsStore.hydrateFromServer()
  try {
    await fetchHealth()
    health.value = 'ok'
  } catch {
    health.value = 'down'
  }

  try {
    const data = await fetchSkills()
    skills.value = data.skills
  } catch {
    skills.value = []
  }

  try {
    const defaults = await fetchDefaults()
    hasServerKey.value = defaults.llm.hasApiKey
  } catch {
    hasServerKey.value = false
  }

  await refreshTabs()
}

async function refreshTabs() {
  tabsLoading.value = true
  try {
    const data = await fetchBrowserTabs(settingsStore.settings.session.cdpEndpoint || undefined)
    tabs.value = data.tabs || []
    endpoints.value = data.endpoints || []
    tabsHint.value = data.error
      ? `${data.hint || '扫描失败'}（${data.error}）`
      : data.hint || ''
  } catch (error) {
    tabs.value = []
    endpoints.value = []
    tabsHint.value = error instanceof Error ? error.message : '无法探测浏览器标签'
  } finally {
    tabsLoading.value = false
  }
}

function useTab(url: string) {
  settingsStore.settings.session.targetUrl = url
  settingsStore.settings.session.attachUrlIncludes = url
  settingsStore.settings.session.browserMode = 'attach'
  settingsStore.settings.session.waitForLogin = false
}

onMounted(refreshMeta)
</script>

<template>
  <aside class="panel">
    <header class="panel__header">
      <div>
        <h2>测试配置</h2>
        <p class="muted">对接 OpenAI 兼容中转站，驱动浏览器自动化检测</p>
      </div>
      <span class="badge" :class="health">
        {{ health === 'ok' ? '后端在线' : health === 'down' ? '后端离线' : '检测中' }}
      </span>
    </header>

    <section class="section">
      <h3>LLM 中转站</h3>
      <label>
        <span>Base URL</span>
        <input
          v-model="settingsStore.settings.llm.baseUrl"
          type="url"
          placeholder="https://your-gateway.com/v1"
        />
      </label>
      <label>
        <span>API Key {{ hasServerKey ? '(服务端 .env 已配置，可留空)' : '' }}</span>
        <input
          v-model="settingsStore.settings.llm.apiKey"
          type="password"
          placeholder="sk-... 或使用服务端 .env"
          autocomplete="off"
        />
      </label>
      <label>
        <span>Model</span>
        <input
          v-model="settingsStore.settings.llm.model"
          type="text"
          placeholder="gpt-4o-mini / claude-... / deepseek-..."
        />
      </label>
    </section>

    <section class="section">
      <h3>浏览器会话</h3>
      <label>
        <span>目标 URL</span>
        <input
          v-model="settingsStore.settings.session.targetUrl"
          type="url"
          placeholder="https://example.com（可空：直接测已打开标签）"
        />
      </label>
      <label>
        <span>浏览器模式 · {{ browserModeLabel }}</span>
        <select v-model="settingsStore.settings.session.browserMode">
          <option value="auto">自动：先附着已打开标签，失败再新开</option>
          <option value="attach">只附着已打开标签（保留登录态）</option>
          <option value="launch">只新开浏览器</option>
        </select>
      </label>
      <p class="hint">
        不用区分 Chrome / Edge / 360：只要浏览器开了远程调试端口，系统会自动扫描并附着。
        普通日常窗口默认不可附着；更省事的方式是勾选“等待手动登录”。
      </p>
      <label class="inline">
        <input v-model="settingsStore.settings.session.waitForLogin" type="checkbox" />
        <span>等待手动登录（推荐，免配浏览器）</span>
      </label>
      <label v-if="settingsStore.settings.session.waitForLogin">
        <span>登录等待秒数</span>
        <input
          v-model.number="settingsStore.settings.session.loginWaitSeconds"
          type="number"
          min="10"
          max="900"
        />
      </label>
      <label class="inline">
        <input
          v-model="settingsStore.settings.session.headless"
          type="checkbox"
          :disabled="settingsStore.settings.session.browserMode === 'attach' || settingsStore.settings.session.waitForLogin"
        />
        <span>无头模式（附着/手动登录时自动关闭）</span>
      </label>
      <label>
        <span>最大 Agent 步数（0 = 无限）</span>
        <input
          v-model.number="settingsStore.settings.session.maxSteps"
          type="number"
          min="0"
          max="1000"
          placeholder="0 表示不限制"
        />
      </label>
      <details class="advanced">
        <summary>高级：附着调试端口（可选）</summary>
        <label>
          <span>CDP Endpoint（留空=自动扫描）</span>
          <input
            v-model="settingsStore.settings.session.cdpEndpoint"
            type="text"
            placeholder="http://127.0.0.1:9222"
          />
        </label>
        <label>
          <span>优先匹配 URL 包含</span>
          <input
            v-model="settingsStore.settings.session.attachUrlIncludes"
            type="text"
            placeholder="默认用目标 URL"
          />
        </label>
        <div class="section__title-row">
          <strong>可附着标签</strong>
          <button class="ghost" type="button" :disabled="tabsLoading" @click="refreshTabs">
            {{ tabsLoading ? '扫描中…' : '重新扫描' }}
          </button>
        </div>
        <p class="hint">{{ tabsHint || '点击重新扫描，查找本机已开启远程调试的浏览器标签。' }}</p>
        <ul v-if="tabs.length" class="tab-list">
          <li v-for="tab in tabs" :key="`${tab.endpoint}-${tab.index}-${tab.url}`">
            <button class="tab-item" type="button" @click="useTab(tab.url)">
              <strong>{{ tab.title || '未命名标签' }}</strong>
              <span>{{ tab.url }}</span>
              <em>{{ tab.browser || tab.endpoint }}</em>
            </button>
          </li>
        </ul>
        <p v-else class="muted">当前未发现可附着标签。</p>
      </details>
    </section>

    <section class="section">
      <div class="section__title-row">
        <h3>已加载 Skills</h3>
        <button class="ghost" type="button" @click="refreshMeta">刷新</button>
      </div>
      <ul v-if="skills.length" class="skill-list">
        <li v-for="skill in skills" :key="skill.name">
          <strong>{{ skill.name }}</strong>
          <p>{{ skill.description || '无描述' }}</p>
        </li>
      </ul>
      <p v-else class="muted">未发现 skills，请检查 skills/*/SKILL.md</p>
    </section>
  </aside>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  height: 100%;
  min-height: 0;
  padding: 20px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--panel);
  border-right: 1px solid var(--border);
}

.panel__header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.panel__header h2 {
  margin: 0;
  font-size: 18px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel-soft);
}

.section h3 {
  margin: 0;
  font-size: 13px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}

.section__title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}

label.inline {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

label span {
  color: var(--muted);
}

input[type='url'],
input[type='text'],
input[type='password'],
input[type='number'] {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--input);
  color: var(--text);
  outline: none;
}

input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
}

.badge {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid var(--border);
}

.badge.ok {
  color: #067647;
  background: #ecfdf3;
  border-color: #abefc6;
}

.badge.down {
  color: #b42318;
  background: #fef3f2;
  border-color: #fecdca;
}

.badge.unknown {
  color: var(--muted);
  background: var(--panel-soft);
}

.skill-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.skill-list li {
  padding: 10px;
  border-radius: 10px;
  background: var(--input);
  border: 1px solid var(--border);
}

.skill-list p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}

.ghost {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  border-radius: 8px;
  padding: 4px 10px;
  cursor: pointer;
}

.muted {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}

.hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--muted);
}

select {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--input);
  color: var(--text);
  outline: none;
}

select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
}

.advanced {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 4px;
}

.advanced summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 12px;
  user-select: none;
}

.tab-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 220px;
  overflow: auto;
}

.tab-item {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
  background: var(--input);
  color: var(--text);
  cursor: pointer;
}

.tab-item:hover {
  border-color: var(--accent);
}

.tab-item strong {
  font-size: 13px;
}

.tab-item span,
.tab-item em {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
