<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppNav from '@/components/requirements/AppNav.vue'
import FeatureMindMap from '@/components/requirements/FeatureMindMap.vue'
import TestCasePanel from '@/components/requirements/TestCasePanel.vue'
import { analyzeRequirement, extractRequirementFile, generateTestCases } from '@/api/requirements'
import { fetchDefaults } from '@/api/agent'
import { useSettingsStore } from '@/stores/settings'
import type { MindMapNode, TestCase } from '@/types/requirements'
import { defaultTestCaseExportName, downloadTextFile, testCasesToMarkdown } from '@/utils/testCases'

const settings = useSettingsStore()
const serverHasKey = ref(false)

const fileInputRef = ref<HTMLInputElement | null>(null)
const jsonInputRef = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const draftText = ref('')
const fileName = ref('')
const analyzing = ref(false)
const generatingCases = ref(false)
const extracting = ref(false)
const errorText = ref('')
const statusText = ref('')
const title = ref('')
const summary = ref('')
const featureCount = ref(0)
const mindMapData = ref<MindMapNode | null>(null)
const mindMapRef = ref<InstanceType<typeof FeatureMindMap> | null>(null)
const activeTab = ref<'upload' | 'text'>('upload')
const mainTab = ref<'map' | 'cases'>('map')
const readonlyMap = ref(false)

const testCaseTitle = ref('')
const testCaseSummary = ref('')
const testCases = ref<TestCase[]>([])

const canAnalyze = computed(() => {
  const llm = settings.settings.llm
  const hasKey = Boolean(llm.apiKey) || serverHasKey.value
  const hasContent = Boolean(selectedFile.value || draftText.value.trim())
  return Boolean(llm.baseUrl && hasKey && llm.model && hasContent && !analyzing.value)
})

const canGenerateCases = computed(() => {
  const llm = settings.settings.llm
  const hasKey = Boolean(llm.apiKey) || serverHasKey.value
  return Boolean(
    mindMapData.value &&
      featureList.value.length > 0 &&
      llm.baseUrl &&
      hasKey &&
      llm.model &&
      !generatingCases.value &&
      !analyzing.value,
  )
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

function flattenFeatures(
  node: MindMapNode | null,
  path: string[] = [],
  acc: Array<{ path: string; text: string; note?: string; tags?: string[] }> = [],
) {
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
  testCases.value = []
  testCaseTitle.value = ''
  testCaseSummary.value = ''
  mainTab.value = 'map'
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
    testCases.value = []
    testCaseTitle.value = ''
    testCaseSummary.value = ''
    mainTab.value = 'map'
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

async function runGenerateTestCases() {
  if (!canGenerateCases.value || !mindMapData.value) return
  generatingCases.value = true
  errorText.value = ''
  statusText.value = `AI 正在根据 ${featureList.value.length} 个功能点生成测试用例...`
  mainTab.value = 'cases'
  try {
    const result = await generateTestCases({
      llm: {
        baseUrl: settings.settings.llm.baseUrl,
        apiKey: settings.settings.llm.apiKey,
        model: settings.settings.llm.model,
      },
      title: title.value,
      summary: summary.value,
      root: mindMapRef.value?.exportData() || mindMapData.value,
      features: featureList.value,
    })
    testCases.value = result.cases
    testCaseTitle.value = result.title
    testCaseSummary.value = result.summary
    statusText.value = `已生成 ${result.caseCount} 条测试用例，可继续编辑后导出`
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : String(error)
    statusText.value = ''
  } finally {
    generatingCases.value = false
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
  downloadTextFile(
    JSON.stringify(payload, null, 2),
    `${(title.value || 'requirement-features').replace(/[\\/:*?"<>|]/g, '_')}.json`,
    'application/json;charset=utf-8',
  )
}

function exportTestCases(format: 'md' | 'json') {
  if (!testCases.value.length) return
  const baseName = defaultTestCaseExportName(testCaseTitle.value || title.value || 'test-cases')
  if (format === 'json') {
    const payload = {
      title: testCaseTitle.value || `${title.value || '需求'}测试用例`,
      summary: testCaseSummary.value,
      sourceTitle: title.value,
      caseCount: testCases.value.length,
      cases: testCases.value,
      exportedAt: new Date().toISOString(),
    }
    downloadTextFile(JSON.stringify(payload, null, 2), `${baseName}.json`, 'application/json;charset=utf-8')
    statusText.value = `已导出 JSON：${baseName}.json`
    return
  }

  const markdown = testCasesToMarkdown({
    title: testCaseTitle.value || `${title.value || '需求'}测试用例`,
    summary: testCaseSummary.value,
    cases: testCases.value,
  })
  downloadTextFile(markdown, `${baseName}.md`, 'text/markdown;charset=utf-8')
  statusText.value = `已导出 Markdown：${baseName}.md`
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
    candidate = payload
  } else if (isMindMapNode(payload.data)) {
    candidate = payload.data
  }

  if (!isMindMapNode(candidate)) {
    throw new Error('JSON 格式不正确：未找到有效的思维导图节点（需要 root 或 { data, children }）')
  }

  return {
    title:
      typeof payload.title === 'string' && payload.title.trim()
        ? payload.title.trim()
        : candidate.data.text || '导入的需求功能点',
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
    testCases.value = []
    testCaseTitle.value = ''
    testCaseSummary.value = ''
    mainTab.value = 'map'
    statusText.value = `已导入 JSON 思维导图：${file.name}（${featureCount.value} 个功能点）`
    await nextFrame()
    mindMapRef.value?.fit()
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : String(error)
  } finally {
    input.value = ''
  }
}

function walk(node: MindMapNode, acc: MindMapNode[], isRoot = true) {
  if (!isRoot) acc.push(node)
  for (const child of node.children || []) walk(child, acc, false)
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

function removeFeature(index: number) {
  if (!mindMapData.value) return
  const target = featureList.value[index]
  const label = target?.text || '该功能点'
  if (!window.confirm(`确认删除功能点「${label}」及其子功能？`)) return

  const cloned = structuredClone(mindMapData.value)
  const removed = removeFeatureAt(cloned, index)
  if (!removed) {
    errorText.value = '删除失败：未找到对应功能点'
    return
  }
  mindMapData.value = cloned
  featureCount.value = flattenFeatures(cloned).length
  statusText.value = `已删除功能点「${label}」，当前剩余 ${featureCount.value} 个`
  errorText.value = ''
}

/** 按功能点列表的前序遍历顺序删除指定节点（含子树）。 */
function removeFeatureAt(parent: MindMapNode, index: number, counter = { i: 0 }): boolean {
  const children = parent.children || []
  for (let i = 0; i < children.length; i += 1) {
    if (counter.i === index) {
      children.splice(i, 1)
      parent.children = children
      return true
    }
    counter.i += 1
    if (removeFeatureAt(children[i]!, index, counter)) return true
  }
  return false
}

function addFeature() {
  if (!mindMapData.value) {
    mindMapData.value = {
      data: { text: title.value || '需求功能点', expand: true },
      children: [],
    }
  }
  const cloned = structuredClone(mindMapData.value)
  if (!cloned.children) cloned.children = []
  const nextIndex = flattenFeatures(cloned).length + 1
  cloned.children.push({
    data: {
      text: `新功能点 ${nextIndex}`,
      note: '',
      expand: true,
    },
    children: [],
  })
  mindMapData.value = cloned
  featureCount.value = flattenFeatures(cloned).length
  statusText.value = `已新增功能点，当前共 ${featureCount.value} 个`
  mainTab.value = 'map'
}
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div class="topbar__left">
        <AppNav />
        <div class="titles">
          <h1>需求文档分析</h1>
          <p>上传 PRD / 需求说明，AI 提取功能点、生成可编辑测试用例并导出</p>
        </div>
      </div>
      <div class="topbar__actions">
        <button type="button" class="ghost" @click="clearAll">清空</button>
      </div>
    </header>

    <div class="body">
      <aside class="side">
        <section class="card">
          <div class="card__head">
            <h2>1. 输入需求</h2>
            <div class="tabs">
              <button type="button" :class="{ active: activeTab === 'upload' }" @click="activeTab = 'upload'">
                上传文件
              </button>
              <button type="button" :class="{ active: activeTab === 'text' }" @click="activeTab = 'text'">
                粘贴文本
              </button>
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
          <button
            type="button"
            class="secondary"
            :disabled="!canGenerateCases"
            @click="runGenerateTestCases"
          >
            {{ generatingCases ? '生成用例中...' : '生成测试用例' }}
          </button>
          <p v-if="!canAnalyze && !analyzing" class="hint">请配置 LLM，并上传/粘贴需求内容。</p>
          <p v-else-if="featureList.length && !canGenerateCases && !generatingCases" class="hint">
            配置好 LLM 后，可基于当前功能点生成测试用例。
          </p>
        </section>

        <section v-if="title || summary" class="card meta">
          <h2>{{ title || '分析结果' }}</h2>
          <p>{{ summary }}</p>
          <div class="badge-row">
            <div class="badge">功能点 {{ featureCount }}</div>
            <div v-if="testCases.length" class="badge badge--case">用例 {{ testCases.length }}</div>
          </div>
        </section>

        <section v-if="featureList.length || mindMapData" class="card list-card">
          <div class="card__head">
            <h2>3. 功能点列表（可编辑）</h2>
            <button type="button" class="mini-btn" @click="addFeature">新增</button>
          </div>
          <div v-if="featureList.length" class="feature-list">
            <div v-for="(item, index) in featureList" :key="`${item.path}-${index}`" class="feature-item">
              <div class="feature-item__row">
                <input
                  class="feature-input"
                  :value="item.text"
                  @change="updateFeatureText(index, ($event.target as HTMLInputElement).value)"
                />
                <button
                  type="button"
                  class="delete-btn"
                  title="删除该功能点及其子功能"
                  @click="removeFeature(index)"
                >
                  删除
                </button>
              </div>
              <div class="feature-path">{{ item.path }}</div>
              <div v-if="item.note" class="feature-note">{{ item.note }}</div>
              <div v-if="item.tags?.length" class="tags">
                <span v-for="tag in item.tags" :key="tag" class="tag">{{ tag }}</span>
              </div>
            </div>
          </div>
          <div v-else class="hint">暂无功能点，可点击“新增”手动添加。</div>
        </section>
      </aside>

      <main class="main">
        <div class="main-toolbar">
          <div class="tabs main-tabs">
            <button type="button" :class="{ active: mainTab === 'map' }" @click="mainTab = 'map'">功能点导图</button>
            <button type="button" :class="{ active: mainTab === 'cases' }" @click="mainTab = 'cases'">
              测试用例{{ testCases.length ? ` (${testCases.length})` : '' }}
            </button>
          </div>
          <div class="main-toolbar__actions">
            <template v-if="mainTab === 'map'">
              <button type="button" class="ghost" :disabled="!mindMapData" @click="readonlyMap = !readonlyMap">
                {{ readonlyMap ? '启用编辑' : '只读预览' }}
              </button>
              <button type="button" class="ghost" :disabled="!mindMapData" @click="mindMapRef?.fit()">
                适应画布
              </button>
              <button type="button" class="ghost" @click="onPickJson">导入 JSON</button>
              <input
                ref="jsonInputRef"
                class="hidden"
                type="file"
                accept=".json,application/json"
                @change="onJsonFileChange"
              />
              <button type="button" class="ghost" :disabled="!mindMapData" @click="downloadJson">导出功能点</button>
            </template>
            <template v-else>
              <button
                type="button"
                class="ghost"
                :disabled="!canGenerateCases"
                @click="runGenerateTestCases"
              >
                {{ generatingCases ? '生成中...' : '生成测试用例' }}
              </button>
              <button type="button" class="ghost" :disabled="!testCases.length" @click="exportTestCases('md')">
                导出 MD
              </button>
              <button type="button" class="ghost" :disabled="!testCases.length" @click="exportTestCases('json')">
                导出 JSON
              </button>
            </template>
          </div>
        </div>

        <div v-if="statusText || errorText" class="status" :class="{ error: !!errorText }">
          {{ errorText || statusText }}
        </div>

        <FeatureMindMap
          v-show="mainTab === 'map'"
          ref="mindMapRef"
          :model-value="mindMapData"
          :readonly="readonlyMap"
          @update:model-value="onMindMapUpdate"
        />

        <TestCasePanel
          v-show="mainTab === 'cases'"
          v-model="testCases"
          :title="testCaseTitle"
          :summary="testCaseSummary"
          :generating="generatingCases"
          @update:title="testCaseTitle = $event"
          @update:summary="testCaseSummary = $event"
        />

        <div v-if="mainTab === 'map'" class="tips">
          <span>逻辑图布局（XMind 风格）</span>
          <span>双击节点可编辑文字</span>
          <span>左侧列表可删除功能点</span>
          <span>可导入/导出 JSON 思维导图</span>
        </div>
        <div v-else class="tips">
          <span>支持编辑标题、步骤、期望结果</span>
          <span>可新增/删除/排序用例</span>
          <span>导出 Markdown 或 JSON</span>
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

.topbar__actions,
.main-toolbar__actions {
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

.main-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-shrink: 0;
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
input,
select {
  width: 100%;
  border: 1px solid var(--border);
  background: var(--input);
  color: var(--text);
  border-radius: 10px;
  padding: 10px 12px;
  outline: none;
}

textarea:focus,
input:focus,
select:focus {
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
.secondary,
.ghost,
.mini-btn,
.delete-btn {
  border-radius: 10px;
  padding: 9px 12px;
  cursor: pointer;
}

.primary,
.secondary {
  width: 100%;
  border: 0;
  margin-top: 0;
}

.primary {
  background: var(--accent);
  color: white;
  font-weight: 600;
}

.secondary {
  margin-top: 8px;
  background: color-mix(in srgb, var(--accent) 12%, var(--panel));
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
  font-weight: 600;
}

.primary:disabled,
.secondary:disabled,
.ghost:disabled,
.mini-btn:disabled,
.delete-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ghost,
.mini-btn {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
}

.mini-btn {
  padding: 4px 10px;
  font-size: 12px;
}

.meta p {
  margin: 8px 0 10px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}

.badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  background: #eff8ff;
  color: #175cd3;
  border: 1px solid #b2ddff;
}

.badge--case {
  background: #ecfdf3;
  color: #067647;
  border-color: #abefc6;
}

.feature-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 360px;
  overflow: auto;
}

.feature-item {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
  background: var(--panel);
}

.feature-item__row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
}

.feature-input {
  font-weight: 600;
}

.delete-btn {
  border: 1px solid #fecdca;
  background: #fef3f2;
  color: #b42318;
  padding: 6px 10px;
  font-size: 12px;
  white-space: nowrap;
}

.feature-path {
  margin-top: 6px;
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

  .main-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
