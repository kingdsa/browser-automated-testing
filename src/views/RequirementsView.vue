<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppNav from '@/components/requirements/AppNav.vue'
import FeatureMindMap from '@/components/requirements/FeatureMindMap.vue'
import { analyzeRequirement, extractRequirementFile } from '@/api/requirements'
import { fetchDefaults } from '@/api/agent'
import { useSettingsStore } from '@/stores/settings'
import type { MindMapNode } from '@/types/requirements'

const settings = useSettingsStore()
const serverHasKey = ref(false)

const fileInputRef = ref<HTMLInputElement | null>(null)
const jsonInputRef = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const draftText = ref('')
const fileName = ref('')
const analyzing = ref(false)
const extracting = ref(false)
const errorText = ref('')
const statusText = ref('')
const title = ref('')
const summary = ref('')
const featureCount = ref(0)
const mindMapData = ref<MindMapNode | null>(null)
const mindMapRef = ref<InstanceType<typeof FeatureMindMap> | null>(null)
const activeTab = ref<'upload' | 'text'>('upload')
const readonlyMap = ref(false)

const canAnalyze = computed(() => {
  const llm = settings.settings.llm
  const hasKey = Boolean(llm.apiKey) || serverHasKey.value
  const hasContent = Boolean(selectedFile.value || draftText.value.trim())
  return Boolean(llm.baseUrl && hasKey && llm.model && hasContent && !analyzing.value)
})

const featureList = computed(() => flattenFeatures(mindMapData.value))

onMounted(async () => {
  try {
    const defaults = await fetchDefaults()
    serverHasKey.value = defaults.llm.hasApiKey
    await settings.hydrateFromServer()
  } catch {
    serverHasKey.value = false
  }
})

function flattenFeatures(node: MindMapNode | null, path: string[] = [], acc: Array<{ path: string; text: string; note?: string; tags?: string[] }> = []) {
  if (!node) return acc
  const nextPath = [...path, node.data.text]
  if (path.length > 0) {
    acc.push({
      path: nextPath.join(' / '),
      text: node.data.text,
      note: node.data.note,
      tags: node.data.tag,
    })
  }
  for (const child of node.children || []) {
    flattenFeatures(child, nextPath, acc)
  }
  return acc
}

function onPickFile() {
  fileInputRef.value?.click()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] || null
  selectedFile.value = file
  errorText.value = ''
  statusText.value = ''
  if (!file) return

  fileName.value = file.name
  extracting.value = true
  try {
    // Prefer local preview for plain text; server extract for docx.
    if (/\.(md|markdown|txt|text|csv|json|log)$/i.test(file.name)) {
      draftText.value = await file.text()
      statusText.value = `已加载文本文件：${file.name}`
    } else {
      const extracted = await extractRequirementFile(file)
      draftText.value = extracted.content
      statusText.value = `已解析文档：${file.name}（${extracted.contentLength} 字）`
    }
    activeTab.value = 'text'
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : String(error)
  } finally {
    extracting.value = false
    input.value = ''
  }
}

function clearAll() {
  selectedFile.value = null
  draftText.value = ''
  fileName.value = ''
  title.value = ''
  summary.value = ''
  featureCount.value = 0
  mindMapData.value = null
  errorText.value = ''
  statusText.value = ''
}

async function runAnalyze() {
  if (!canAnalyze.value) return
  analyzing.value = true
  errorText.value = ''
  statusText.value = 'AI 正在分析需求文档中的功能点...'
  try {
    const result = await analyzeRequirement({
      llm: {
        baseUrl: settings.settings.llm.baseUrl,
        apiKey: settings.settings.llm.apiKey,
        model: settings.settings.llm.model,
      },
      content: draftText.value,
      fileName: fileName.value || selectedFile.value?.name || 'requirement.md',
      file: selectedFile.value,
    })
    mindMapData.value = result.root
    title.value = result.title
    summary.value = result.summary
    featureCount.value = result.featureCount
    statusText.value = `分析完成：识别到 ${result.featureCount} 个功能点`
    await nextFrame()
    mindMapRef.value?.fit()
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : String(error)
    statusText.value = ''
  } finally {
    analyzing.value = false
  }
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

function onMindMapUpdate(value: MindMapNode) {
  mindMapData.value = value
  featureCount.value = Math.max(0, flattenFeatures(value).length)
}

function downloadJson() {
  const data = mindMapRef.value?.exportData() || mindMapData.value
  if (!data) return
  const payload = {
    title: title.value || '需求功能点',
    summary: summary.value,
    featureCount: featureCount.value,
    root: data,
    exportedAt: new Date().toISOString(),
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(title.value || 'requirement-features').replace(/[\\/:*?"<>|]/g, '_')}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function onPickJson() {
  jsonInputRef.value?.click()
}

function isMindMapNode(value: unknown): value is MindMapNode {
  if (!value || typeof value !== 'object') return false
  const node = value as MindMapNode
  if (!node.data || typeof node.data !== 'object') return false
  if (typeof node.data.text !== 'string') return false
  if (node.children !== undefined && !Array.isArray(node.children)) return false
  return (node.children || []).every((child) => isMindMapNode(child))
}

function normalizeImportedPayload(raw: unknown): {
  title: string
  summary: string
  root: MindMapNode
} {
  if (!raw || typeof raw !== 'object') {
    throw new Error('JSON 内容无效：需要对象结构')
  }

  const payload = raw as Record<string, unknown>
  let candidate: unknown = null

  if (isMindMapNode(payload.root)) {
    candidate = payload.root
  } else if (isMindMapNode(payload)) {
    // Support raw simple-mind-map node JSON: { data, children }
    candidate = payload
  } else if (isMindMapNode(payload.data)) {
    candidate = payload.data
  }

  if (!isMindMapNode(candidate)) {
    throw new Error('JSON 格式不正确：未找到有效的思维导图节点（需要 root 或 { data, children }）')
  }

  return {
    title: typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : candidate.data.text || '导入的需求功能点',
    summary: typeof payload.summary === 'string' ? payload.summary : '从 JSON 导入的思维导图',
    root: candidate,
  }
}

async function onJsonFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] || null
  errorText.value = ''
  statusText.value = ''
  if (!file) return

  try {
    const textContent = await file.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(textContent)
    } catch {
      throw new Error('无法解析 JSON 文件，请确认文件内容合法')
    }

    const imported = normalizeImportedPayload(parsed)
    mindMapData.value = imported.root
    title.value = imported.title
    summary.value = imported.summary
    featureCount.value = Math.max(0, flattenFeatures(imported.root).length)
    fileName.value = file.name
    statusText.value = `已导入 JSON 思维导图：${file.name}（${featureCount.value} 个功能点）`
    await nextFrame()
    mindMapRef.value?.fit()
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : String(error)
  } finally {
    input.value = ''
  }
}

function updateFeatureText(index: number, text: string) {
  if (!mindMapData.value) return
  const cloned = structuredClone(mindMapData.value)
  const list: MindMapNode[] = []
  walk(cloned, list)
  if (!list[index]) return
  list[index].data.text = text.trim() || list[index].data.text
  mindMapData.value = cloned
  featureCount.value = list.length
}

function walk(node: MindMapNode, acc: MindMapNode[], isRoot = true) {
  if (!isRoot) acc.push(node)
  for (const child of node.children || []) walk(child, acc, false)
}
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div class="topbar__left">
        <AppNav />
        <div class="titles">
          <h1>需求文档分析</h1>
          <p>上传 PRD / 需求说明，AI 提取功能点并以可编辑逻辑图展示</p>
        </div>
      </div>
      <div class="topbar__actions">
        <button type="button" class="ghost" :disabled="!mindMapData" @click="readonlyMap = !readonlyMap">
          {{ readonlyMap ? '启用编辑' : '只读预览' }}
        </button>
        <button type="button" class="ghost" :disabled="!mindMapData" @click="mindMapRef?.fit()">适应画布</button>
        <button type="button" class="ghost" @click="onPickJson">导入 JSON</button>
        <input
          ref="jsonInputRef"
          class="hidden"
          type="file"
          accept=".json,application/json"
          @change="onJsonFileChange"
        />
        <button type="button" class="ghost" :disabled="!mindMapData" @click="downloadJson">导出 JSON</button>
        <button type="button" class="ghost" @click="clearAll">清空</button>
      </div>
    </header>

    <div class="body">
      <aside class="side">
        <section class="card">
          <div class="card__head">
            <h2>1. 输入需求</h2>
            <div class="tabs">
              <button type="button" :class="{ active: activeTab === 'upload' }" @click="activeTab = 'upload'">上传文件</button>
              <button type="button" :class="{ active: activeTab === 'text' }" @click="activeTab = 'text'">粘贴文本</button>
            </div>
          </div>

          <div v-if="activeTab === 'upload'" class="upload" @click="onPickFile">
            <input
              ref="fileInputRef"
              class="hidden"
              type="file"
              accept=".md,.markdown,.txt,.text,.csv,.json,.log,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              @change="onFileChange"
            />
            <div class="upload__icon">↑</div>
            <div class="upload__title">点击选择需求文档</div>
            <div class="upload__desc">支持 Markdown / TXT / DOCX</div>
            <div v-if="selectedFile || fileName" class="upload__file">{{ selectedFile?.name || fileName }}</div>
          </div>

          <div v-else class="text-panel">
            <label class="label" for="req-text">需求正文</label>
            <textarea
              id="req-text"
              v-model="draftText"
              rows="12"
              placeholder="粘贴 PRD、用户故事、功能清单..."
            />
            <div class="hint">也可先上传文件，系统会把解析结果填到这里供你微调。</div>
          </div>
        </section>

        <section class="card">
          <div class="card__head">
            <h2>2. AI 分析</h2>
          </div>
          <div class="llm-row">
            <label>
              <span>Base URL</span>
              <input v-model="settings.settings.llm.baseUrl" placeholder="https://api.example.com/v1" />
            </label>
            <label>
              <span>Model</span>
              <input v-model="settings.settings.llm.model" placeholder="gpt-4o-mini" />
            </label>
            <label>
              <span>API Key {{ serverHasKey ? '（可留空，使用服务端 .env）' : '' }}</span>
              <input v-model="settings.settings.llm.apiKey" type="password" placeholder="sk-..." />
            </label>
          </div>
          <button type="button" class="primary" :disabled="!canAnalyze || extracting" @click="runAnalyze">
            {{ analyzing ? '分析中...' : extracting ? '解析文档中...' : 'AI 分析功能点' }}
          </button>
          <p v-if="!canAnalyze && !analyzing" class="hint">
            请配置 LLM，并上传/粘贴需求内容。
          </p>
        </section>

        <section v-if="title || summary" class="card meta">
          <h2>{{ title || '分析结果' }}</h2>
          <p>{{ summary }}</p>
          <div class="badge">功能点 {{ featureCount }}</div>
        </section>

        <section v-if="featureList.length" class="card list-card">
          <div class="card__head">
            <h2>3. 功能点列表（可编辑）</h2>
          </div>
          <div class="feature-list">
            <div v-for="(item, index) in featureList" :key="`${item.path}-${index}`" class="feature-item">
              <input
                class="feature-input"
                :value="item.text"
                @change="updateFeatureText(index, ($event.target as HTMLInputElement).value)"
              />
              <div class="feature-path">{{ item.path }}</div>
              <div v-if="item.note" class="feature-note">{{ item.note }}</div>
              <div v-if="item.tags?.length" class="tags">
                <span v-for="tag in item.tags" :key="tag" class="tag">{{ tag }}</span>
              </div>
            </div>
          </div>
        </section>
      </aside>

      <main class="main">
        <div v-if="statusText || errorText" class="status" :class="{ error: !!errorText }">
          {{ errorText || statusText }}
        </div>
        <FeatureMindMap
          ref="mindMapRef"
          :model-value="mindMapData"
          :readonly="readonlyMap"
          @update:model-value="onMindMapUpdate"
        />
        <div class="tips">
          <span>逻辑图布局（XMind 风格）</span>
          <span>双击节点可编辑文字</span>
          <span>支持拖拽、缩放、增删节点</span>
          <span>可导入/导出 JSON 思维导图</span>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.page {
  height: 100vh;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
}

.topbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex-shrink: 0;
}

.topbar__left {
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 0;
}

.titles h1 {
  margin: 0;
  font-size: 18px;
}

.titles p {
  margin: 2px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.topbar__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 380px 1fr;
  gap: 0;
}

.side {
  min-height: 0;
  overflow: auto;
  border-right: 1px solid var(--border);
  background: var(--panel);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.main {
  min-width: 0;
  min-height: 0;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card {
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel-soft);
  padding: 14px;
}

.card__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.card h2 {
  margin: 0;
  font-size: 14px;
}

.tabs {
  display: flex;
  gap: 4px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px;
}

.tabs button {
  border: 0;
  background: transparent;
  color: var(--muted);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.tabs button.active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  font-weight: 600;
}

.upload {
  border: 1.5px dashed color-mix(in srgb, var(--accent) 40%, var(--border));
  border-radius: 12px;
  padding: 22px 14px;
  text-align: center;
  cursor: pointer;
  background: color-mix(in srgb, var(--accent) 4%, var(--panel));
}

.upload:hover {
  border-color: var(--accent);
}

.upload__icon {
  width: 36px;
  height: 36px;
  margin: 0 auto 8px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
  font-weight: 700;
}

.upload__title {
  font-size: 14px;
  font-weight: 600;
}

.upload__desc,
.hint,
.feature-path,
.feature-note {
  color: var(--muted);
  font-size: 12px;
}

.upload__file {
  margin-top: 10px;
  font-size: 12px;
  color: var(--accent);
  word-break: break-all;
}

.hidden {
  display: none;
}

.text-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.label {
  font-size: 12px;
  color: var(--muted);
}

textarea,
input {
  width: 100%;
  border: 1px solid var(--border);
  background: var(--input);
  color: var(--text);
  border-radius: 10px;
  padding: 10px 12px;
  outline: none;
}

textarea:focus,
input:focus {
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
}

.llm-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.llm-row label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}

.primary,
.ghost {
  border-radius: 10px;
  padding: 9px 12px;
  cursor: pointer;
}

.primary {
  width: 100%;
  border: 0;
  background: var(--accent);
  color: white;
  font-weight: 600;
}

.primary:disabled,
.ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ghost {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
}

.meta p {
  margin: 8px 0 10px;
  font-size: 13px;
  color: var(--muted);
}

.badge {
  display: inline-flex;
  padding: 4px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
}

.list-card {
  flex: 1;
  min-height: 180px;
  display: flex;
  flex-direction: column;
}

.feature-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
  max-height: 360px;
  padding-right: 2px;
}

.feature-item {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
  background: var(--panel);
}

.feature-input {
  font-weight: 600;
  margin-bottom: 4px;
}

.feature-path {
  margin-top: 2px;
}

.feature-note {
  margin-top: 4px;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.tag {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 999px;
  background: #ecfdf3;
  color: #067647;
  border: 1px solid #abefc6;
}

.status {
  flex-shrink: 0;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
  background: #eff8ff;
  color: #175cd3;
  border: 1px solid #b2ddff;
}

.status.error {
  background: #fef3f2;
  color: #b42318;
  border-color: #fecdca;
}

.tips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--muted);
  font-size: 12px;
}

.tips span {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 4px 10px;
  background: var(--panel);
}

@media (max-width: 1100px) {
  .body {
    grid-template-columns: 1fr;
  }

  .side {
    border-right: 0;
    border-bottom: 1px solid var(--border);
    max-height: 46vh;
  }
}
</style>
