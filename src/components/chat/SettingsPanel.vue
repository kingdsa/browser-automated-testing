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
        <span>等待手动登录（本机有界面时推荐）</span>
      </label>
      <p class="hint">
        本机桌面：勾选后会弹出浏览器，你登录完自动继续。
        线上无图形服务器：不能本地弹窗，请在“高级”里填远程 CDP，在有界面机器上登录，系统会等待该浏览器完成登录。
        若目标就是测登录页本身，请关闭此项，否则系统会一直等待离开登录页。
      </p>
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
      <p class="hint">
        部署到无图形界面的 Linux 服务器时：无头模式可直接跑无需登录的页面；
        需要手动登录时请配置远程 CDP（或 xvfb + VNC），不要指望服务器本地弹窗。
      </p>
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
        <p class="hint">
          线上服务器要“等待手动登录”时必填：指向你本机/有界面机器的 Chromium 远程调试地址，
          推荐经 SSH 隧道后填 `http://127.0.0.1:9222`。
        </p>
        <label>
          <span>CDP Endpoint（留空=自动扫描本机端口）</span>
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
  gap: 12px;
  min-height: 0;
  height: 100%;
  overflow: auto;
  padding: 14px;
  border-right: 1px solid var(--border);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--accent) 4%, transparent), transparent 120px),
    color-mix(in srgb, var(--panel) 92%, transparent);
  backdrop-filter: blur(10px);
  scrollbar-gutter: stable;
}

.panel__header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  padding: 4px 2px 8px;
  animation: fade-up 0.4s var(--ease-out) both;
}

.panel__header h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.muted {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}

.badge {
  flex-shrink: 0;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: var(--panel-soft);
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  padding: 5px 10px;
  white-space: nowrap;
}

.badge.ok {
  color: var(--success-text);
  background: var(--success-soft);
  border-color: var(--success-border);
}

.badge.down {
  color: var(--error-text);
  background: var(--error-soft);
  border-color: var(--error-border);
}

.badge.unknown {
  color: var(--info-text);
  background: var(--info-soft);
  border-color: var(--info-border);
  animation: pulse-soft 1.6s ease-in-out infinite;
}

.section {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  padding: 14px;
  box-shadow: var(--shadow-xs);
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: fade-up 0.45s var(--ease-out) both;
}

.section:nth-of-type(2) { animation-delay: 0.04s; }
.section:nth-of-type(3) { animation-delay: 0.08s; }

.section h3 {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.section__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.section__title-row h3,
.section__title-row strong {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}

label.inline {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 13px;
}

label.inline input[type='checkbox'] {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
}

input,
select,
textarea {
  width: 100%;
  border: 1px solid var(--border);
  background: var(--input);
  color: var(--text);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  outline: none;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out);
}

input:hover,
select:hover,
textarea:hover {
  border-color: var(--border-hover);
}

input:focus,
select:focus,
textarea:focus {
  border-color: var(--accent);
  box-shadow: var(--shadow-focus);
}

.hint {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}

.advanced {
  border-top: 1px dashed var(--border);
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.advanced summary {
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  list-style: none;
}

.advanced summary::-webkit-details-marker {
  display: none;
}

.advanced summary::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 8px;
  border-right: 1.5px solid var(--accent);
  border-bottom: 1.5px solid var(--accent);
  transform: rotate(-45deg) translateY(-1px);
  transition: transform var(--duration-fast) var(--ease-out);
}

.advanced[open] summary::before {
  transform: rotate(45deg) translateY(-2px);
}

.ghost {
  border: 1px solid var(--border);
  background: var(--panel-soft);
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
}

.ghost:hover:not(:disabled) {
  border-color: var(--border-hover);
  background: var(--surface-hover);
}

.ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tab-list,
.skill-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tab-item {
  width: 100%;
  text-align: left;
  border: 1px solid var(--border);
  background: var(--panel-soft);
  color: var(--text);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.tab-item:hover {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  background: var(--accent-soft);
  transform: translateY(-1px);
}

.tab-item strong {
  font-size: 13px;
}

.tab-item span,
.tab-item em {
  font-size: 11px;
  color: var(--muted);
  font-style: normal;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-list li {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--panel-soft);
  padding: 10px 12px;
}

.skill-list strong {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--accent);
}

.skill-list strong::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.skill-list p {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}

@media (max-width: 1100px) {
  .panel {
    border-right: 0;
    border-bottom: 1px solid var(--border);
    max-height: 42vh;
  }
}
</style>
