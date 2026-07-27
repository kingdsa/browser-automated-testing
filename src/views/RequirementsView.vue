<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppNav from '@/components/requirements/AppNav.vue'
import FeatureMindMap from '@/components/requirements/FeatureMindMap.vue'
import GenerationStreamPanel from '@/components/requirements/GenerationStreamPanel.vue'
import TestCasePanel from '@/components/requirements/TestCasePanel.vue'
import {
  extractRequirementFile,
  streamAnalyzeRequirement,
  streamGenerateTestCases,
} from '@/api/requirements'
import { fetchDefaults } from '@/api/agent'
import { useSettingsStore } from '@/stores/settings'
import type {
  GenerationMessage,
  GenerateTestCasesResult,
  MindMapNode,
  MindMapProgressSnapshot,
  RequirementAnalysisResult,
  TestCase,
} from '@/types/requirements'
import {
  defaultTestCaseExportName,
  downloadTextFile,
  normalizeImportedTestCases,
  testCasesToMarkdown,
} from '@/utils/testCases'

defineOptions({ name: 'RequirementsView' })

const settings = useSettingsStore()
const serverHasKey = ref(false)

const fileInputRef = ref<HTMLInputElement | null>(null)
const mindMapJsonInputRef = ref<HTMLInputElement | null>(null)
const testCaseJsonInputRef = ref<HTMLInputElement | null>(null)
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

const showGenerationPanel = ref(false)
const generationKind = ref<'analyze' | 'cases' | null>(null)
const generationMessages = ref<GenerationMessage[]>([])
const generationRunning = ref(false)
const generationStatus = ref('')
const generationError = ref('')
const progressiveMapVisible = ref(false)
let generationAbort: AbortController | null = null
let generationSeq = 0
let progressiveMapTimer: ReturnType<typeof setTimeout> | null = null
let pendingProgressiveMap: MindMapProgressSnapshot | null = null

const canAnalyze = computed(() => {
  const llm = settings.settings.llm
  const hasKey = Boolean(llm.apiKey) || serverHasKey.value
  const hasContent = Boolean(selectedFile.value || draftText.value.trim())
  return Boolean(
    llm.baseUrl && hasKey && llm.model && hasContent && !analyzing.value && !generatingCases.value,
  )
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
const showTextGenerationPanel = computed(
  () => showGenerationPanel.value && !progressiveMapVisible.value,
)

onMounted(async () => {
  try {
    const defaults = await fetchDefaults()
    serverHasKey.value = defaults.llm.hasApiKey
    await settings.hydrateFromServer()
  } catch {
    serverHasKey.value = false
  }
})

onBeforeUnmount(() => {
  generationAbort?.abort()
  cancelProgressiveMapUpdate()
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
  stopGeneration(false)
  showGenerationPanel.value = false
  generationKind.value = null
  generationMessages.value = []
  generationStatus.value = ''
  generationError.value = ''
  progressiveMapVisible.value = false
  cancelProgressiveMapUpdate()
}

function uid(prefix: string) {
  generationSeq += 1
  return `${prefix}_${Date.now()}_${generationSeq}`
}

function llmPayload() {
  return {
    baseUrl: settings.settings.llm.baseUrl,
    apiKey: settings.settings.llm.apiKey,
    model: settings.settings.llm.model,
  }
}

function beginGeneration(kind: 'analyze' | 'cases', userText: string, assistantPlaceholder = '') {
  stopGeneration(false)
  cancelProgressiveMapUpdate()
  progressiveMapVisible.value = false
  generationAbort = new AbortController()
  generationKind.value = kind
  showGenerationPanel.value = true
  generationRunning.value = true
  generationStatus.value = kind === 'analyze' ? '准备分析功能点...' : '准备生成测试用例...'
  generationError.value = ''
  errorText.value = ''
  statusText.value = generationStatus.value
  generationMessages.value = [
    {
      id: uid('user'),
      role: 'user',
      content: userText,
    },
    {
      id: uid('assistant'),
      role: 'assistant',
      content: assistantPlaceholder,
      kind: kind === 'analyze' ? 'reasoning' : undefined,
      streaming: true,
    },
  ]
}

function currentAssistant(kind?: GenerationMessage['kind']) {
  return (
    [...generationMessages.value]
      .reverse()
      .find((message) => message.role === 'assistant' && (!kind || message.kind === kind)) || null
  )
}

function ensureAssistant(kind: NonNullable<GenerationMessage['kind']>) {
  const existing = currentAssistant(kind)
  if (existing) return existing

  const message: GenerationMessage = {
    id: uid(`assistant_${kind}`),
    role: 'assistant',
    kind,
    content: '',
    streaming: true,
  }
  generationMessages.value.push(message)
  return message
}

function appendAssistantDelta(content: string, kind?: GenerationMessage['kind']) {
  const assistant = kind ? ensureAssistant(kind) : currentAssistant()
  if (!assistant) return
  assistant.content += content
}

function finishAssistant(content?: string, kind?: GenerationMessage['kind']) {
  const assistant = currentAssistant(kind)
  if (!assistant) return
  if (typeof content === 'string' && content && !assistant.content) assistant.content = content
  assistant.streaming = false
  if (!assistant.content) assistant.content = '本次没有生成文本输出。'
}

function finishAllAssistants(fallback?: string) {
  for (const assistant of generationMessages.value.filter(
    (message) => message.role === 'assistant',
  )) {
    assistant.streaming = false
    if (!assistant.content) assistant.content = fallback || '本次没有生成文本输出。'
  }
}

function stopGeneration(updateUi = true) {
  if (generationAbort) {
    generationAbort.abort()
    generationAbort = null
  }
  if (!updateUi) return
  flushProgressiveMapUpdate()
  generationRunning.value = false
  analyzing.value = false
  generatingCases.value = false
  const assistant = currentAssistant()
  if (assistant?.streaming) finishAllAssistants('已取消生成。')
  generationStatus.value = '已取消生成'
  statusText.value = '已取消生成'
}

function dismissGenerationPanel() {
  if (generationRunning.value) stopGeneration(true)
  showGenerationPanel.value = false
  progressiveMapVisible.value = false
  cancelProgressiveMapUpdate()
}

const generationPanelTitle = computed(() => {
  if (generationKind.value === 'cases') return 'AI 正在生成测试用例'
  if (generationKind.value === 'analyze') return 'AI 正在分析功能点'
  return 'AI 生成过程'
})

const generationPanelSubtitle = computed(() => {
  if (generationRunning.value) return '流式输出中，可随时取消'
  if (generationError.value) return '生成失败，可返回后重试'
  if (generationStatus.value.includes('取消')) return '已取消，可返回结果页'
  return '生成完成，可返回查看结果'
})

function applyProgressiveMap(snapshot: MindMapProgressSnapshot) {
  const firstSnapshot = !progressiveMapVisible.value
  if (firstSnapshot) {
    progressiveMapVisible.value = true
    testCases.value = []
    testCaseTitle.value = ''
    testCaseSummary.value = ''
  }

  mindMapData.value = snapshot.root
  title.value = snapshot.title || snapshot.root.data.text
  summary.value = snapshot.summary
  featureCount.value = snapshot.featureCount
  mainTab.value = 'map'
  generationStatus.value = `正在绘制功能点导图：已生成 ${snapshot.featureCount} 个功能点...`
  statusText.value = generationStatus.value
}

function queueProgressiveMap(snapshot: MindMapProgressSnapshot) {
  if (!progressiveMapVisible.value) {
    applyProgressiveMap(snapshot)
    return
  }

  pendingProgressiveMap = snapshot
  if (progressiveMapTimer) return
  progressiveMapTimer = setTimeout(() => {
    progressiveMapTimer = null
    if (!pendingProgressiveMap) return
    const next = pendingProgressiveMap
    pendingProgressiveMap = null
    applyProgressiveMap(next)
  }, 120)
}

function cancelProgressiveMapUpdate() {
  if (progressiveMapTimer) clearTimeout(progressiveMapTimer)
  progressiveMapTimer = null
  pendingProgressiveMap = null
}

function flushProgressiveMapUpdate() {
  if (progressiveMapTimer) clearTimeout(progressiveMapTimer)
  progressiveMapTimer = null
  if (!pendingProgressiveMap) return
  const next = pendingProgressiveMap
  pendingProgressiveMap = null
  applyProgressiveMap(next)
}

async function runAnalyze() {
  if (!canAnalyze.value) return
  analyzing.value = true
  const sourceName = fileName.value || selectedFile.value?.name || 'requirement.md'
  const preview = draftText.value.trim()
  const previewText = preview
    ? preview.slice(0, 500) + (preview.length > 500 ? '\n\n...(已截断预览)' : '')
    : `（将解析上传文件：${sourceName}）`

  beginGeneration(
    'analyze',
    `请分析需求文档「${sourceName}」，提取可测试功能点，并输出思维导图 JSON。\n\n文档预览：\n${previewText}`,
  )

  let gotResult = false
  try {
    await streamAnalyzeRequirement({
      llm: llmPayload(),
      content: draftText.value,
      fileName: sourceName,
      file: selectedFile.value,
      handlers: {
        signal: generationAbort?.signal,
        onEvent(type, data) {
          const payload = (data || {}) as Record<string, unknown>
          if (type === 'status') {
            const message = String(payload.message || '')
            generationStatus.value = message
            statusText.value = message
          } else if (type === 'reasoning') {
            appendAssistantDelta(String(payload.content || ''), 'reasoning')
            generationStatus.value = 'AI 正在分析需求...'
            statusText.value = generationStatus.value
          } else if (type === 'delta') {
            const reasoning = currentAssistant('reasoning')
            if (reasoning) reasoning.streaming = false
            appendAssistantDelta(String(payload.content || ''), 'result')
            generationStatus.value = '模型正在输出功能点 JSON...'
            statusText.value = generationStatus.value
          } else if (type === 'mindmap') {
            const snapshot = payload as unknown as MindMapProgressSnapshot
            if (!snapshot?.root || !isMindMapNode(snapshot.root)) return
            queueProgressiveMap(snapshot)
          } else if (type === 'result') {
            const result = payload as unknown as RequirementAnalysisResult
            if (!result?.root) return
            cancelProgressiveMapUpdate()
            gotResult = true
            mindMapData.value = result.root
            title.value = result.title
            summary.value = result.summary
            featureCount.value = result.featureCount
            testCases.value = []
            testCaseTitle.value = ''
            testCaseSummary.value = ''
            mainTab.value = 'map'
            generationStatus.value = `分析完成：识别到 ${result.featureCount} 个功能点`
            statusText.value = generationStatus.value
          } else if (type === 'error') {
            generationError.value = String(payload.message || '分析失败')
            errorText.value = generationError.value
          }
        },
      },
    })

    finishAllAssistants()
    if (gotResult) {
      showGenerationPanel.value = false
      progressiveMapVisible.value = false
      await nextTick()
      await nextFrame()
      mindMapRef.value?.fit()
    } else if (!generationError.value) {
      generationError.value = '未收到有效的功能点结果'
      errorText.value = generationError.value
    }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      generationStatus.value = '已取消生成'
      statusText.value = '已取消生成'
      finishAllAssistants('已取消生成。')
    } else {
      generationError.value = error instanceof Error ? error.message : String(error)
      errorText.value = generationError.value
      statusText.value = ''
      finishAllAssistants()
    }
  } finally {
    generationRunning.value = false
    analyzing.value = false
    generationAbort = null
  }
}

async function runGenerateTestCases() {
  if (!canGenerateCases.value || !mindMapData.value) return
  generatingCases.value = true
  mainTab.value = 'cases'

  const rootSnapshot = mindMapRef.value?.exportData() || mindMapData.value
  const featuresSnapshot = featureList.value.slice()
  const count = featuresSnapshot.length

  beginGeneration(
    'cases',
    `请根据当前 ${count} 个功能点生成可执行测试用例，输出 JSON。\n\n功能点摘要：\n${featuresSnapshot
      .slice(0, 12)
      .map((item, index) => `${index + 1}. ${item.path}`)
      .join('\n')}${count > 12 ? `\n... 另有 ${count - 12} 个功能点` : ''}`,
  )

  let gotResult = false
  try {
    await streamGenerateTestCases({
      llm: llmPayload(),
      title: title.value,
      summary: summary.value,
      root: rootSnapshot,
      features: featuresSnapshot,
      handlers: {
        signal: generationAbort?.signal,
        onEvent(type, data) {
          const payload = (data || {}) as Record<string, unknown>
          if (type === 'status') {
            const message = String(payload.message || '')
            generationStatus.value = message
            statusText.value = message
          } else if (type === 'delta') {
            appendAssistantDelta(String(payload.content || ''))
            generationStatus.value = '模型正在输出测试用例 JSON...'
            statusText.value = generationStatus.value
          } else if (type === 'result') {
            const result = payload as unknown as GenerateTestCasesResult
            if (!result?.cases) return
            gotResult = true
            testCases.value = result.cases
            testCaseTitle.value = result.title
            testCaseSummary.value = result.summary
            mainTab.value = 'cases'
            generationStatus.value = `已生成 ${result.caseCount} 条测试用例，可继续编辑后导出`
            statusText.value = generationStatus.value
          } else if (type === 'error') {
            generationError.value = String(payload.message || '生成失败')
            errorText.value = generationError.value
          }
        },
      },
    })

    finishAssistant()
    if (gotResult) {
      showGenerationPanel.value = false
    } else if (!generationError.value) {
      generationError.value = '未收到有效的测试用例结果'
      errorText.value = generationError.value
    }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      generationStatus.value = '已取消生成'
      statusText.value = '已取消生成'
      finishAssistant('已取消生成。')
    } else {
      generationError.value = error instanceof Error ? error.message : String(error)
      errorText.value = generationError.value
      statusText.value = ''
      finishAssistant()
    }
  } finally {
    generationRunning.value = false
    generatingCases.value = false
    generationAbort = null
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
    downloadTextFile(
      JSON.stringify(payload, null, 2),
      `${baseName}.json`,
      'application/json;charset=utf-8',
    )
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

function onPickMindMapJson() {
  mindMapJsonInputRef.value?.click()
}

function onPickTestCaseJson() {
  testCaseJsonInputRef.value?.click()
}

function isMindMapNode(value: unknown): value is MindMapNode {
  if (!value || typeof value !== 'object') return false
  const node = value as MindMapNode
  if (!node.data || typeof node.data !== 'object') return false
  if (typeof node.data.text !== 'string') return false
  if (node.children !== undefined && !Array.isArray(node.children)) return false
  return (node.children || []).every((child) => isMindMapNode(child))
}

function normalizeImportedMindMap(raw: unknown): {
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

async function onMindMapJsonFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] || null
  errorText.value = ''
  statusText.value = ''
  if (!file) return

  try {
    const textContent = await file.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(textContent.replace(/^\uFEFF/, ''))
    } catch {
      throw new Error('无法解析 JSON 文件，请确认文件内容合法')
    }

    const imported = normalizeImportedMindMap(parsed)
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
    await nextTick()
    await nextFrame()
    mindMapRef.value?.fit()
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : String(error)
  } finally {
    input.value = ''
  }
}

async function onTestCaseJsonFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] || null
  errorText.value = ''
  statusText.value = ''
  if (!file) return

  try {
    const textContent = await file.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(textContent.replace(/^\uFEFF/, ''))
    } catch {
      throw new Error('无法解析测试用例 JSON，请确认文件内容合法')
    }

    const imported = normalizeImportedTestCases(parsed)
    testCases.value = imported.cases
    testCaseTitle.value = imported.title
    testCaseSummary.value = imported.summary
    mainTab.value = 'cases'
    statusText.value = `已导入测试用例：${file.name}（${imported.cases.length} 条）`
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : String(error)
  } finally {
    input.value = ''
  }
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
              <button
                type="button"
                :class="{ active: activeTab === 'upload' }"
                @click="activeTab = 'upload'"
              >
                上传文件
              </button>
              <button
                type="button"
                :class="{ active: activeTab === 'text' }"
                @click="activeTab = 'text'"
              >
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
            <div v-if="selectedFile || fileName" class="upload__file">
              {{ selectedFile?.name || fileName }}
            </div>
          </div>

          <div v-else class="text-panel">
            <textarea
              id="req-text"
              v-model="draftText"
              class="req-text"
              rows="8"
              placeholder="粘贴 PRD、用户故事、功能清单..."
            />
          </div>
        </section>

        <section class="card">
          <div class="card__head">
            <h2>2. AI 分析</h2>
          </div>
          <div class="llm-row">
            <label>
              <span>Base URL</span>
              <input
                v-model="settings.settings.llm.baseUrl"
                placeholder="https://api.example.com/v1"
              />
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
          <button
            type="button"
            class="primary"
            :disabled="(!canAnalyze && !analyzing) || extracting || generatingCases"
            @click="analyzing ? stopGeneration(true) : runAnalyze()"
          >
            {{ analyzing ? '取消分析' : extracting ? '解析文档中...' : 'AI 分析功能点' }}
          </button>
          <button
            type="button"
            class="secondary"
            :disabled="(!canGenerateCases && !generatingCases) || analyzing"
            @click="generatingCases ? stopGeneration(true) : runGenerateTestCases()"
          >
            {{ generatingCases ? '取消生成' : '生成测试用例' }}
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
      </aside>

      <main class="main">
        <div class="main-toolbar">
          <div class="tabs main-tabs">
            <button type="button" :class="{ active: mainTab === 'map' }" @click="mainTab = 'map'">
              功能点导图
            </button>
            <button
              type="button"
              :class="{ active: mainTab === 'cases' }"
              @click="mainTab = 'cases'"
            >
              测试用例{{ testCases.length ? ` (${testCases.length})` : '' }}
            </button>
          </div>
          <div class="main-toolbar__actions">
            <template v-if="mainTab === 'map'">
              <button
                type="button"
                class="ghost"
                :disabled="!mindMapData || analyzing"
                @click="readonlyMap = !readonlyMap"
              >
                {{ readonlyMap ? '启用编辑' : '只读预览' }}
              </button>
              <button
                type="button"
                class="ghost"
                :disabled="!mindMapData"
                @click="mindMapRef?.fit()"
              >
                适应画布
              </button>
              <button type="button" class="ghost" @click="onPickMindMapJson">
                导入功能点 JSON
              </button>
              <input
                ref="mindMapJsonInputRef"
                class="hidden"
                type="file"
                accept=".json,application/json"
                @change="onMindMapJsonFileChange"
              />
              <button type="button" class="ghost" :disabled="!mindMapData" @click="downloadJson">
                导出功能点
              </button>
            </template>
            <template v-else>
              <button
                type="button"
                class="ghost"
                :disabled="generatingCases || analyzing"
                @click="onPickTestCaseJson"
              >
                导入用例 JSON
              </button>
              <input
                ref="testCaseJsonInputRef"
                class="hidden"
                type="file"
                accept=".json,application/json"
                @change="onTestCaseJsonFileChange"
              />
              <button
                type="button"
                class="ghost"
                :disabled="(!canGenerateCases && !generatingCases) || analyzing"
                @click="generatingCases ? stopGeneration(true) : runGenerateTestCases()"
              >
                {{ generatingCases ? '取消生成' : '生成测试用例' }}
              </button>
              <button
                type="button"
                class="ghost"
                :disabled="!testCases.length"
                @click="exportTestCases('md')"
              >
                导出 MD
              </button>
              <button
                type="button"
                class="ghost"
                :disabled="!testCases.length"
                @click="exportTestCases('json')"
              >
                导出 JSON
              </button>
            </template>
          </div>
        </div>

        <div
          v-if="(statusText || errorText) && !showGenerationPanel"
          class="status"
          :class="{ error: !!errorText }"
        >
          {{ errorText || statusText }}
        </div>

        <GenerationStreamPanel
          v-if="showTextGenerationPanel"
          :title="generationPanelTitle"
          :subtitle="generationPanelSubtitle"
          :messages="generationMessages"
          :running="generationRunning"
          :status-text="generationStatus"
          :error-text="generationError"
          @stop="stopGeneration(true)"
          @dismiss="dismissGenerationPanel"
        />

        <template v-else>
          <section
            v-if="mainTab === 'map' && showGenerationPanel && progressiveMapVisible"
            class="map-stream-status"
            :class="{ error: !!generationError }"
          >
            <div class="map-stream-status__summary">
              <span v-if="generationRunning" class="map-stream-status__pulse" aria-hidden="true" />
              <div>
                <strong>{{
                  generationError ? '导图生成遇到问题' : 'AI 正在绘制功能点导图'
                }}</strong>
                <span>{{ generationError || generationStatus }}</span>
              </div>
            </div>
            <button
              type="button"
              :class="generationRunning ? 'stream-stop' : 'ghost'"
              @click="generationRunning ? stopGeneration(true) : dismissGenerationPanel()"
            >
              {{ generationRunning ? '取消生成' : '返回结果' }}
            </button>
          </section>

          <FeatureMindMap
            v-if="mainTab === 'map'"
            ref="mindMapRef"
            :model-value="mindMapData"
            :readonly="readonlyMap || (analyzing && progressiveMapVisible)"
            @update:model-value="onMindMapUpdate"
          />

          <TestCasePanel
            v-else
            v-model="testCases"
            :title="testCaseTitle"
            :summary="testCaseSummary"
            :generating="generatingCases"
            @update:title="testCaseTitle = $event"
            @update:summary="testCaseSummary = $event"
          />

          <div v-if="mainTab === 'map' && !progressiveMapVisible" class="tips">
            <span>逻辑图布局（XMind 风格）</span>
            <span>双击节点可编辑文字</span>
            <span>左侧列表可删除功能点</span>
            <span>可导入/导出 JSON 思维导图</span>
          </div>
          <div v-else-if="mainTab === 'cases'" class="tips">
            <span>左侧目录可按功能点快速跳转</span>
            <span>支持编辑标题、步骤、期望结果</span>
            <span>可新增/删除/排序用例</span>
            <span>可导入 JSON，导出 Markdown 或 JSON</span>
          </div>
        </template>
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
  background: transparent;
  color: var(--text);
}

.topbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  min-height: 60px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel) 82%, transparent);
  backdrop-filter: blur(12px);
  box-shadow: var(--shadow-xs);
  flex-shrink: 0;
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
  grid-template-columns: 360px 1fr;
  gap: 0;
}

.side {
  min-height: 0;
  overflow: auto;
  border-right: 1px solid var(--border);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--accent) 4%, transparent), transparent 140px),
    color-mix(in srgb, var(--panel) 92%, transparent);
  backdrop-filter: blur(10px);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  scrollbar-gutter: stable;
}

.main {
  min-width: 0;
  min-height: 0;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: color-mix(in srgb, var(--bg-elevated) 55%, transparent);
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
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--panel) 90%, transparent);
  padding: 14px;
  box-shadow: var(--shadow-xs);
  animation: fade-up 0.4s var(--ease-out) both;
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
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.tabs {
  display: flex;
  gap: 4px;
  background: var(--panel-soft);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px;
}

.tabs button {
  border: 0;
  background: transparent;
  color: var(--muted);
  border-radius: 999px;
  padding: 5px 11px;
  font-size: 12px;
  cursor: pointer;
  transition:
    color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.tabs button.active {
  background: var(--accent);
  color: var(--text-on-accent);
  font-weight: 600;
  box-shadow: 0 6px 14px rgba(var(--accent-rgb), 0.2);
}

.upload {
  border: 1.5px dashed color-mix(in srgb, var(--accent) 40%, var(--border));
  border-radius: var(--radius-md);
  min-height: 188px;
  padding: 22px 14px;
  text-align: center;
  cursor: pointer;
  background: color-mix(in srgb, var(--accent) 5%, var(--panel));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.upload:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
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

.req-text {
  min-height: 188px;
  height: 188px;
  resize: vertical;
  line-height: 1.6;
  overflow: auto;
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
  border-radius: var(--radius-md);
  padding: 10px 12px;
  outline: none;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

textarea:focus,
input:focus,
select:focus {
  border-color: var(--accent);
  box-shadow: var(--shadow-focus);
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
  border-radius: var(--radius-md);
  padding: 9px 12px;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out),
    opacity var(--duration-fast) var(--ease-out);
}

.primary,
.secondary {
  width: 100%;
  border: 0;
  margin-top: 0;
}

.primary {
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 92%, white), var(--accent));
  color: var(--text-on-accent);
  font-weight: 600;
  box-shadow:
    0 1px 0 color-mix(in srgb, white 18%, transparent) inset,
    0 8px 18px rgba(var(--accent-rgb), 0.2);
}

.primary:hover:not(:disabled) {
  background: var(--accent-hover);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.secondary {
  margin-top: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
  font-weight: 600;
}

.secondary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent-soft) 70%, var(--accent));
  color: var(--text-on-accent);
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
  background: color-mix(in srgb, var(--panel-soft) 85%, transparent);
  color: var(--text);
  font-size: 13px;
}

.ghost:hover:not(:disabled),
.mini-btn:hover:not(:disabled) {
  border-color: var(--border-hover);
  background: var(--surface-hover);
  transform: translateY(-1px);
}

.delete-btn {
  border: 1px solid var(--error-border);
  background: var(--error-soft);
  color: var(--error-text);
  font-size: 12px;
  padding: 6px 8px;
}

.delete-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--error-soft) 65%, var(--error-border));
}

.meta .badge-row,
.badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-pill);
  border: 1px solid var(--success-border);
  background: var(--success-soft);
  color: var(--success-text);
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
}

.badge--case {
  border-color: var(--info-border);
  background: var(--info-soft);
  color: var(--info-text);
}

.feature-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 42vh;
  overflow: auto;
  padding-right: 2px;
}

.feature-item {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--panel-soft);
  padding: 10px;
}

.feature-item__row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
}

.feature-input {
  min-width: 0;
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
  gap: 6px;
  margin-top: 8px;
}

.tag {
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--accent-secondary) 10%, var(--panel));
  color: var(--info-text);
  font-size: 11px;
  padding: 2px 8px;
}

.status {
  border-radius: var(--radius-md);
  padding: 9px 12px;
  font-size: 13px;
  background: var(--info-soft);
  color: var(--info-text);
  border: 1px solid var(--info-border);
}

.status.error {
  background: var(--error-soft);
  color: var(--error-text);
  border-color: var(--error-border);
}

.map-stream-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
  min-height: 54px;
  padding: 9px 12px;
  border: 1px solid var(--info-border);
  border-radius: var(--radius-md);
  background: var(--info-soft);
  color: var(--info-text);
}

.map-stream-status.error {
  border-color: var(--error-border);
  background: var(--error-soft);
  color: var(--error-text);
}

.map-stream-status__summary {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.map-stream-status__summary > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.map-stream-status__summary strong {
  font-size: 13px;
}

.map-stream-status__summary span:not(.map-stream-status__pulse) {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map-stream-status__pulse {
  width: 9px;
  height: 9px;
  flex: 0 0 9px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0.45);
  animation: map-stream-pulse 1.4s ease-out infinite;
}

.stream-stop {
  flex-shrink: 0;
  border: 1px solid var(--error-border);
  border-radius: var(--radius-md);
  background: var(--error-soft);
  color: var(--error-text);
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

@keyframes map-stream-pulse {
  70% {
    box-shadow: 0 0 0 7px rgba(var(--accent-rgb), 0);
  }

  100% {
    box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0);
  }
}

.workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.meta h2 {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  text-transform: none;
  color: var(--text);
}

.meta p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.65;
}

.list-card {
  min-height: 0;
}

.main :deep(.mindmap-wrap),
.main :deep(.stream-panel),
.main :deep(.panel) {
  flex: 1;
  min-height: 0;
}

.tips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

.tips span {
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel-soft) 80%, transparent);
  border-radius: var(--radius-pill);
  padding: 4px 10px;
}

.main-tabs {
  flex-shrink: 0;
}

@media (max-width: 1100px) {
  .titles {
    display: none;
  }

  .body {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(280px, 42vh) 1fr;
  }

  .side {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
}

@media (max-width: 760px) {
  .topbar {
    padding: 10px 12px;
    flex-direction: column;
    align-items: flex-start;
  }

  .topbar__actions {
    width: 100%;
  }

  .main-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .map-stream-status {
    align-items: stretch;
    flex-direction: column;
  }

  .map-stream-status__summary span:not(.map-stream-status__pulse) {
    white-space: normal;
  }

  .ghost,
  .primary,
  .secondary,
  .mini-btn {
    min-height: 40px;
  }
}
</style>
