<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppNav from '@/components/requirements/AppNav.vue'
import FeatureMindMap from '@/components/requirements/FeatureMindMap.vue'
import GenerationStreamPanel from '@/components/requirements/GenerationStreamPanel.vue'
import SkillsPanel from '@/components/requirements/SkillsPanel.vue'
import TestCasePanel from '@/components/requirements/TestCasePanel.vue'
import {
  extractRequirementFile,
  streamAnalyzeRequirement,
  streamGenerateTestCases,
} from '@/api/requirements'
import { fetchBrowserTabs, fetchDefaults } from '@/api/agent'
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

/** 功能点「是否 AI 测试」勾选面板可见性 */
const showAiTestPanel = ref(false)
/** 「是否 AI 测试」面板当前聚焦的层级路径：从根节点的子层开始，空数组表示聚焦在根（展示一级内容） */
const aiTestFocusPath = ref<string[]>([])
/** 导出功能点时弹出选择：全部 / 仅 AI 测试 */
const showExportModal = ref(false)
const exportMode = ref<'all' | 'ai-only'>('all')
/** 用于在思维导图节点上做视觉标记的标签文案 */
const AI_TEST_TAG = 'AI测试'

const testCaseTitle = ref('')
const testCaseSummary = ref('')
const testCases = ref<TestCase[]>([])

/** Optional page grounding for test-case generation */
const caseTargetUrl = ref('')
const caseBrowserMode = ref<'auto' | 'launch' | 'attach'>('auto')
const caseWaitForLogin = ref(false)
const browserTabsLoading = ref(false)
const browserTabsHint = ref('')
const browserTabs = ref<
  Array<{ endpoint: string; browser?: string; index: number; url: string; title: string }>
>([])

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
  () =>
    showGenerationPanel.value &&
    !progressiveMapVisible.value &&
    (generationKind.value === 'analyze' || mainTab.value === 'cases'),
)

onMounted(async () => {
  try {
    const defaults = await fetchDefaults()
    serverHasKey.value = defaults.llm.hasApiKey
    await settings.hydrateFromServer()
    // Prefill from browser-test session settings when available.
    if (settings.settings.session.targetUrl) {
      caseTargetUrl.value = settings.settings.session.targetUrl
    }
    if (settings.settings.session.browserMode) {
      caseBrowserMode.value = settings.settings.session.browserMode
    }
    caseWaitForLogin.value = Boolean(settings.settings.session.waitForLogin)
  } catch {
    serverHasKey.value = false
  }
  await refreshBrowserTabs()
})

onBeforeUnmount(() => {
  generationAbort?.abort()
  cancelProgressiveMapUpdate()
})

function flattenFeatures(
  node: MindMapNode | null,
  path: string[] = [],
  acc: Array<{ path: string; text: string; note?: string; tags?: string[]; aiTest?: boolean }> = [],
) {
  if (!node) return acc
  const nextPath = [...path, node.data.text]
  if (path.length > 0) {
    acc.push({
      path: nextPath.join(' / '),
      text: node.data.text,
      note: node.data.note,
      tags: node.data.tag,
      aiTest: node.data.aiTest,
    })
  }
  for (const child of node.children || []) {
    flattenFeatures(child, nextPath, acc)
  }
  return acc
}

/** 在子树中按 path 段落查找目标节点 */
function findNodeBySegments(root: MindMapNode, segments: string[]): MindMapNode | null {
  let node: MindMapNode = root
  for (const segment of segments) {
    const next = (node.children || []).find((child) => child.data.text === segment)
    if (!next) return null
    node = next
  }
  return node
}

/** 将节点及其所有子孙节点的「是否 AI 测试」标记同步为 value */
function applyAiTestToSubtree(node: MindMapNode, value: boolean) {
  node.data.aiTest = value
  const tags = node.data.tag ? [...node.data.tag] : []
  const hasTag = tags.includes(AI_TEST_TAG)
  if (value && !hasTag) tags.push(AI_TEST_TAG)
  else if (!value && hasTag) {
    const idx = tags.indexOf(AI_TEST_TAG)
    if (idx >= 0) tags.splice(idx, 1)
  }
  node.data.tag = tags.length ? tags : undefined
  for (const child of node.children || []) applyAiTestToSubtree(child, value)
}

/** 当前聚焦层级对应的节点（基于 mindMapData 与 aiTestFocusPath） */
const aiTestFocusNode = computed<MindMapNode | null>(() => {
  if (!mindMapData.value) return null
  return findNodeBySegments(mindMapData.value, aiTestFocusPath.value)
})

/** 当前层级下需要展示的子项（即聚焦节点的直接子节点） */
const aiTestItems = computed(() => {
  const node = aiTestFocusNode.value
  if (!node) return []
  return (node.children || []).map((child) => ({
    text: child.data.text,
    aiTest: child.data.aiTest,
    hasChildren: Boolean(child.children && child.children.length),
  }))
})

/** 面包屑：第一项是根节点文案，后续依次为 aiTestFocusPath 各段 */
const aiTestBreadcrumb = computed(() => {
  const items: Array<{ label: string; depth: number }> = []
  items.push({ label: mindMapData.value?.data.text || '全部', depth: -1 })
  aiTestFocusPath.value.forEach((segment, index) => {
    items.push({ label: segment, depth: index })
  })
  return items
})

/** 当前层级已勾选数量（用于面板头部展示） */
const aiTestFocusSelectedCount = computed(
  () => aiTestItems.value.filter((item) => item.aiTest).length,
)

/** 当聚焦路径与新导图不匹配时自动回退到根层级 */
watch(aiTestFocusNode, (node) => {
  if (!node && aiTestFocusPath.value.length > 0 && mindMapData.value) {
    aiTestFocusPath.value = []
  }
})

/** 勾选/取消勾选当前层级下某个子项，并递归作用于其所有子孙节点 */
function toggleAiTestForFocusChild(childText: string, value: boolean) {
  if (!mindMapData.value) return
  const root = JSON.parse(JSON.stringify(mindMapData.value)) as MindMapNode
  const focus = findNodeBySegments(root, aiTestFocusPath.value)
  if (!focus) return
  const child = (focus.children || []).find((item) => item.data.text === childText)
  if (!child) return
  applyAiTestToSubtree(child, value)
  mindMapData.value = root
}

/** 在当前层级下双击某个子项，进入它的下一级 */
function drillIntoFocusChild(childText: string) {
  const focus = aiTestFocusNode.value
  if (!focus) return
  const child = (focus.children || []).find((item) => item.data.text === childText)
  if (!child || !child.children || child.children.length === 0) return
  aiTestFocusPath.value = [...aiTestFocusPath.value, childText]
}

/** 通过面包屑跳转到指定层级（depth=-1 表示根） */
function setAiTestFocusDepth(depth: number) {
  if (depth < 0) {
    aiTestFocusPath.value = []
    return
  }
  aiTestFocusPath.value = aiTestFocusPath.value.slice(0, depth + 1)
}

/** 思维导图节点被点击时，将面板聚焦路径同步到该节点 */
function onMindMapNodeClick(path: string[]) {
  // 校验路径在新数据里仍然有效；无效则忽略
  if (!mindMapData.value) return
  const node = findNodeBySegments(mindMapData.value, path)
  if (!node) return
  aiTestFocusPath.value = [...path]
}

/** 一键全选 / 全不选「是否 AI 测试」（作用于当前聚焦层级的所有子项及其子孙） */
function setAllAiTest(value: boolean) {
  if (!mindMapData.value) return
  const root = JSON.parse(JSON.stringify(mindMapData.value)) as MindMapNode
  const focus = findNodeBySegments(root, aiTestFocusPath.value)
  if (!focus) return
  for (const child of focus.children || []) {
    applyAiTestToSubtree(child, value)
  }
  mindMapData.value = root
}

const aiTestCount = computed(
  () => featureList.value.filter((item) => item.aiTest).length,
)

/** 复制思维导图并按需过滤掉未勾选 AI 测试的叶子功能点 */
function filterMindMapForExport(root: MindMapNode, aiOnly: boolean): MindMapNode {
  if (!aiOnly) return root
  const clone = JSON.parse(JSON.stringify(root)) as MindMapNode
  const prune = (node: MindMapNode): MindMapNode | null => {
    const isLeaf = !node.children || node.children.length === 0
    if (isLeaf) {
      return node.data.aiTest ? node : null
    }
    const kept: MindMapNode[] = []
    for (const child of node.children!) {
      const result = prune(child)
      if (result) kept.push(result)
    }
    if (kept.length === 0) {
      // 子节点全部被过滤，若当前节点本身也被标记为 AI 测试则保留为叶子
      return node.data.aiTest ? { data: node.data, children: [] } : null
    }
    return { data: node.data, children: kept }
  }
  const result = prune(clone)
  return result || { data: clone.data, children: [] }
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

function caseSessionPayload() {
  const targetUrl = caseTargetUrl.value.trim()
  // Only ground in a real page when user provided URL or explicitly chose attach mode.
  // Avoid accidental exploration from leftover browser-test attachUrlIncludes.
  if (!targetUrl && caseBrowserMode.value !== 'attach') {
    return undefined
  }
  return {
    targetUrl: targetUrl || undefined,
    headless: settings.settings.session.headless,
    maxSteps: settings.settings.session.maxSteps,
    browserMode: caseBrowserMode.value,
    cdpEndpoint: settings.settings.session.cdpEndpoint || undefined,
    attachUrlIncludes:
      targetUrl || settings.settings.session.attachUrlIncludes?.trim() || undefined,
    waitForLogin: caseWaitForLogin.value,
    loginWaitSeconds: settings.settings.session.loginWaitSeconds,
  }
}

async function refreshBrowserTabs() {
  browserTabsLoading.value = true
  try {
    const data = await fetchBrowserTabs(settings.settings.session.cdpEndpoint || undefined)
    browserTabs.value = data.tabs || []
    browserTabsHint.value = data.error
      ? `${data.hint || '扫描失败'}（${data.error}）`
      : data.hint || (data.tabs?.length ? `发现 ${data.tabs.length} 个可附着标签` : '未发现可附着标签')
  } catch (error) {
    browserTabs.value = []
    browserTabsHint.value = error instanceof Error ? error.message : '无法探测浏览器标签'
  } finally {
    browserTabsLoading.value = false
  }
}

function useBrowserTab(tab: { url: string; endpoint?: string; title?: string }) {
  caseTargetUrl.value = tab.url
  caseBrowserMode.value = 'attach'
  settings.settings.session.targetUrl = tab.url
  settings.settings.session.attachUrlIncludes = tab.url
  settings.settings.session.browserMode = 'attach'
  if (tab.endpoint) settings.settings.session.cdpEndpoint = tab.endpoint
  browserTabsHint.value = `已选用标签：${tab.title || tab.url}`
}

function useCurrentBrowserTab() {
  const first = browserTabs.value[0]
  if (!first) {
    browserTabsHint.value = '当前没有可附着标签，请先刷新或打开带远程调试的浏览器'
    return
  }
  useBrowserTab(first)
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
  if (generationKind.value === 'cases') {
    if (generationStatus.value.includes('探索')) return 'AI 正在探索目标页面'
    return 'AI 正在生成测试用例'
  }
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
          } else if (type === 'skills') {
            const loaded = Array.isArray(payload.skills)
              ? (payload.skills as Array<{ name?: string; fileName?: string }>)
                  .map((item) => item.name || item.fileName || '')
                  .filter(Boolean)
              : []
            if (loaded.length) {
              generationStatus.value = `已加载 skills：${loaded.join('、')}`
              statusText.value = generationStatus.value
            }
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
  const session = caseSessionPayload()
  const targetLabel =
    session?.targetUrl ||
    (session?.browserMode === 'attach' ? '当前浏览器标签' : '')

  // Keep browser-test settings in sync only when page grounding is enabled.
  if (session) {
    if (session.targetUrl) {
      settings.settings.session.targetUrl = session.targetUrl
      settings.settings.session.attachUrlIncludes =
        session.attachUrlIncludes || session.targetUrl
    }
    settings.settings.session.browserMode = caseBrowserMode.value
    settings.settings.session.waitForLogin = caseWaitForLogin.value
  }

  beginGeneration(
    'cases',
    [
      targetLabel
        ? `请基于目标页面（${targetLabel}）的真实探索结果，结合当前 ${count} 个功能点生成可执行测试用例。`
        : `请根据当前 ${count} 个功能点生成可执行测试用例（未指定目标页面，仅基于功能点）。`,
      '',
      '功能点摘要：',
      ...featuresSnapshot.slice(0, 12).map((item, index) => `${index + 1}. ${item.path}`),
      ...(count > 12 ? [`... 另有 ${count - 12} 个功能点`] : []),
      '',
      targetLabel
        ? '要求：先用 control-chrome 深度探索页面，步骤必须来自真实页面路径，禁止编造不存在的入口。'
        : '提示：可在左侧填写目标 URL 或选用当前浏览器标签，以页面事实落地生成用例。',
    ].join('\n'),
  )

  let gotResult = false
  try {
    await streamGenerateTestCases({
      llm: llmPayload(),
      title: title.value,
      summary: summary.value,
      root: rootSnapshot,
      features: featuresSnapshot,
      session,
      handlers: {
        signal: generationAbort?.signal,
        onEvent(type, data) {
          const payload = (data || {}) as Record<string, unknown>
          if (type === 'status') {
            const message = String(payload.message || '')
            generationStatus.value = message
            statusText.value = message
          } else if (type === 'skills') {
            const loaded = Array.isArray(payload.skills)
              ? (payload.skills as Array<{ name?: string; fileName?: string }>)
                  .map((item) => item.name || item.fileName || '')
                  .filter(Boolean)
              : []
            if (loaded.length) {
              generationStatus.value = `已加载 skills：${loaded.join('、')}`
              statusText.value = generationStatus.value
            }
          } else if (type === 'tool_start') {
            const name = String(payload.name || 'tool')
            const message = `浏览器操作：${name}`
            generationStatus.value = message
            statusText.value = message
            appendAssistantDelta(`\n\n> 🔧 ${message}\n`)
          } else if (type === 'tool_result') {
            const name = String(payload.name || 'tool')
            const result = (payload.result || {}) as Record<string, unknown>
            const ok = result.ok === false ? '失败' : '完成'
            const summaryText = String(result.summary || '')
            const message = `浏览器${ok}：${name}${summaryText ? ` — ${summaryText}` : ''}`
            generationStatus.value = message
            statusText.value = message
            appendAssistantDelta(`\n> ✅ ${message}\n`)
          } else if (type === 'delta') {
            appendAssistantDelta(String(payload.content || ''))
            if (!generationStatus.value.includes('探索')) {
              generationStatus.value = '模型正在输出测试用例 JSON...'
            }
            statusText.value = generationStatus.value
          } else if (type === 'result') {
            const result = payload as unknown as GenerateTestCasesResult
            if (!result?.cases) return
            gotResult = true
            testCases.value = result.cases
            testCaseTitle.value = result.title
            testCaseSummary.value = result.summary
            const grounded =
              (result as GenerateTestCasesResult & { groundedInPage?: boolean }).groundedInPage
                ? '（已基于真实页面探索）'
                : ''
            generationStatus.value = `已生成 ${result.caseCount} 条测试用例${grounded}，可继续编辑后导出`
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
  // 同步最新的导图数据，再弹出导出选项
  mindMapData.value = data
  featureCount.value = Math.max(0, flattenFeatures(data).length)
  exportMode.value = 'all'
  showExportModal.value = true
}

function confirmExport() {
  const source = mindMapRef.value?.exportData() || mindMapData.value
  if (!source) {
    showExportModal.value = false
    return
  }
  const aiOnly = exportMode.value === 'ai-only'
  const exportedRoot = filterMindMapForExport(source, aiOnly)
  const exportedFeatureCount = Math.max(0, flattenFeatures(exportedRoot).length)
  const payload = {
    title: title.value || '需求功能点',
    summary: summary.value,
    featureCount: exportedFeatureCount,
    root: exportedRoot,
    exportMode: aiOnly ? 'ai-only' : 'all',
    exportedAt: new Date().toISOString(),
  }
  downloadTextFile(
    JSON.stringify(payload, null, 2),
    `${(title.value || 'requirement-features').replace(/[\\/:*?"<>|]/g, '_')}${
      aiOnly ? '-ai-only' : ''
    }.json`,
    'application/json;charset=utf-8',
  )
  statusText.value = aiOnly
    ? `已导出（仅 AI 测试）：${exportedFeatureCount} 个功能点`
    : `已导出（全部）：${exportedFeatureCount} 个功能点`
  showExportModal.value = false
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

  // 兼容历史数据：若节点上带有「AI测试」标签但未设置 aiTest 字段，则同步标记
  const syncAiTest = (node: MindMapNode) => {
    const tags = node.data.tag || []
    const hasAiTag = tags.includes(AI_TEST_TAG)
    if (node.data.aiTest === undefined) node.data.aiTest = hasAiTag
    for (const child of node.children || []) syncAiTest(child)
  }
  syncAiTest(candidate)

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
          <SkillsPanel
            category="function-point"
            title="功能点 Skills（可多选拼接）"
            :disabled="analyzing || generatingCases"
          />
          <button
            type="button"
            class="primary"
            :disabled="(!canAnalyze && !analyzing) || extracting || generatingCases"
            @click="analyzing ? stopGeneration(true) : runAnalyze()"
          >
            {{ analyzing ? '取消分析' : extracting ? '解析文档中...' : 'AI 分析功能点' }}
          </button>

          <div class="case-target">
            <div class="case-target__head">
              <span class="case-target__title">3. 目标页面（可选）</span>
              <span class="case-target__badge">页面落地生成</span>
            </div>
            <label>
              <span>目标 URL</span>
              <input
                v-model="caseTargetUrl"
                type="url"
                placeholder="https://example.com（可空：仅基于功能点）"
                :disabled="generatingCases || analyzing"
              />
            </label>
            <label>
              <span>浏览器模式</span>
              <select v-model="caseBrowserMode" :disabled="generatingCases || analyzing">
                <option value="auto">自动：先附着已打开标签，失败再新开</option>
                <option value="attach">只附着已打开标签（保留登录态）</option>
                <option value="launch">只新开浏览器</option>
              </select>
            </label>
            <label class="inline">
              <input v-model="caseWaitForLogin" type="checkbox" :disabled="generatingCases || analyzing" />
              <span>等待手动登录（与浏览器测试一致）</span>
            </label>
            <div class="case-target__actions">
              <button
                type="button"
                class="ghost mini"
                :disabled="browserTabsLoading || generatingCases || analyzing"
                @click="refreshBrowserTabs"
              >
                {{ browserTabsLoading ? '扫描中…' : '刷新标签' }}
              </button>
              <button
                type="button"
                class="ghost mini"
                :disabled="!browserTabs.length || generatingCases || analyzing"
                @click="useCurrentBrowserTab"
              >
                使用当前标签
              </button>
            </div>
            <p v-if="browserTabsHint" class="hint">{{ browserTabsHint }}</p>
            <div v-if="browserTabs.length" class="tab-list">
              <button
                v-for="tab in browserTabs.slice(0, 6)"
                :key="`${tab.endpoint}-${tab.index}-${tab.url}`"
                type="button"
                class="tab-chip"
                :disabled="generatingCases || analyzing"
                :title="tab.url"
                @click="useBrowserTab(tab)"
              >
                <span class="tab-chip__title">{{ tab.title || '未命名标签' }}</span>
                <span class="tab-chip__url">{{ tab.url }}</span>
              </button>
            </div>
            <p class="hint">
              填写 URL 或选用当前浏览器标签后，将用 control-chrome 深度探索真实页面再生成用例；留空则仅按功能点生成。
            </p>
          </div>

          <SkillsPanel
            category="test-case"
            title="测试用例 Skills（可多选拼接；启用页面探索时自动叠加 control-chrome skill）"
            :disabled="analyzing || generatingCases"
          />
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
              <button
                type="button"
                class="ghost"
                :disabled="!mindMapData"
                :class="{ 'ghost--active': showAiTestPanel }"
                @click="showAiTestPanel = !showAiTestPanel"
              >
                AI测试选择{{ featureList.length ? ` (${aiTestCount}/${featureList.length})` : '' }}
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
            v-if="mainTab === 'map' && showAiTestPanel && featureList.length"
            class="ai-test-panel"
          >
            <div class="ai-test-panel__head">
              <div class="ai-test-panel__title">
                <span>是否 AI 测试</span>
                <span class="ai-test-panel__count">
                  {{ aiTestFocusSelectedCount }} / {{ aiTestItems.length }}
                </span>
              </div>
              <div class="ai-test-panel__actions">
                <button type="button" class="ghost mini" @click="setAllAiTest(true)">
                  全选
                </button>
                <button type="button" class="ghost mini" @click="setAllAiTest(false)">
                  全不选
                </button>
                <button type="button" class="ghost mini" @click="showAiTestPanel = false">
                  收起
                </button>
              </div>
            </div>
            <div class="ai-test-panel__breadcrumb">
              <template v-for="(crumb, idx) in aiTestBreadcrumb" :key="`${crumb.depth}-${idx}`">
                <button
                  type="button"
                  class="crumb"
                  :class="{ active: idx === aiTestBreadcrumb.length - 1 }"
                  :disabled="idx === aiTestBreadcrumb.length - 1"
                  :title="crumb.label"
                  @click="setAiTestFocusDepth(crumb.depth)"
                >
                  {{ crumb.label }}
                </button>
                <span v-if="idx < aiTestBreadcrumb.length - 1" class="crumb__sep">/</span>
              </template>
            </div>
            <div v-if="aiTestItems.length" class="ai-test-panel__list">
              <label
                v-for="item in aiTestItems"
                :key="item.text"
                class="ai-test-item"
                :class="{ 'ai-test-item--drillable': item.hasChildren }"
                :title="
                  item.hasChildren ? `${item.text}（双击进入下级）` : item.text
                "
                @dblclick="item.hasChildren && drillIntoFocusChild(item.text)"
              >
                <input
                  type="checkbox"
                  :checked="!!item.aiTest"
                  @change="
                    toggleAiTestForFocusChild(
                      item.text,
                      ($event.target as HTMLInputElement).checked,
                    )
                  "
                />
                <span class="ai-test-item__path">{{ item.text }}</span>
                <span v-if="item.hasChildren" class="ai-test-item__hint">双击进入下级 ›</span>
              </label>
            </div>
            <p v-else class="hint">当前层级没有下一级内容。</p>
            <p class="hint">
              勾选某项后会同时选中其下所有子级；双击可进入下一级；点击导图节点可跳转到对应层级。
            </p>
          </section>

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
            @node-click="onMindMapNodeClick"
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
            <span>工具栏「AI测试选择」可勾选需要 AI 测试的功能点</span>
            <span>点击导图节点可切换「是否 AI 测试」面板的当前层级</span>
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

    <Teleport to="body">
      <div v-if="showExportModal" class="export-modal-mask" @click.self="showExportModal = false">
        <div class="export-modal" role="dialog" aria-modal="true">
          <h3>导出功能点</h3>
          <p class="export-modal__desc">
            当前共 {{ featureList.length }} 个功能点，其中 {{ aiTestCount }} 个已勾选「是否 AI 测试」。
          </p>
          <div class="export-modal__options">
            <label class="export-option" :class="{ active: exportMode === 'all' }">
              <input
                v-model="exportMode"
                type="radio"
                value="all"
                name="export-mode"
              />
              <div class="export-option__body">
                <span class="export-option__title">全部导出</span>
                <span class="export-option__desc">导出所有 {{ featureList.length }} 个功能点</span>
              </div>
            </label>
            <label
              class="export-option"
              :class="{ active: exportMode === 'ai-only', disabled: aiTestCount === 0 }"
            >
              <input
                v-model="exportMode"
                type="radio"
                value="ai-only"
                name="export-mode"
                :disabled="aiTestCount === 0"
              />
              <div class="export-option__body">
                <span class="export-option__title">仅导出需要 AI 测试的</span>
                <span class="export-option__desc">
                  只导出已勾选的 {{ aiTestCount }} 个功能点{{
                    aiTestCount === 0 ? '（请先在「AI测试选择」中勾选）' : ''
                  }}
                </span>
              </div>
            </label>
          </div>
          <div class="export-modal__actions">
            <button type="button" class="ghost" @click="showExportModal = false">取消</button>
            <button type="button" class="primary" @click="confirmExport">确认导出</button>
          </div>
        </div>
      </div>
    </Teleport>
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

.case-target {
  margin: 12px 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--accent) 4%, var(--panel-soft));
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.case-target__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.case-target__title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.case-target__badge {
  font-size: 11px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-radius: 999px;
  padding: 2px 8px;
}

.case-target label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}

.case-target label.inline {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  width: fit-content;
  max-width: 100%;
  cursor: pointer;
  user-select: none;
  color: var(--text);
}

.case-target label.inline input[type='checkbox'] {
  width: 16px;
  height: 16px;
  min-width: 16px;
  margin: 0;
  padding: 0;
  flex: 0 0 16px;
  accent-color: var(--accent);
  cursor: pointer;
}

.case-target label.inline span {
  flex: 1 1 auto;
  line-height: 1.4;
  color: var(--text);
}

.case-target__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.case-target .mini {
  padding: 6px 10px;
  font-size: 12px;
}

.tab-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 160px;
  overflow: auto;
}

.tab-chip {
  text-align: left;
  border: 1px solid var(--border);
  background: var(--panel);
  border-radius: var(--radius-md);
  padding: 8px 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out);
}

.tab-chip:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.tab-chip:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.tab-chip__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-chip__url {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.ghost--active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.ai-test-panel {
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--panel) 92%, transparent);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: var(--shadow-xs);
  animation: fade-up 0.3s var(--ease-out) both;
}

.ai-test-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.ai-test-panel__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}

.ai-test-panel__count {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: var(--radius-pill);
  padding: 2px 8px;
}

.ai-test-panel__actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.ai-test-panel__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 240px;
  overflow: auto;
  padding-right: 4px;
}

.ai-test-panel__breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
  padding: 6px 8px;
  background: var(--panel-soft);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.ai-test-panel__breadcrumb .crumb {
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  padding: 2px 6px;
  border-radius: var(--radius-pill);
  cursor: pointer;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition:
    color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out);
}

.ai-test-panel__breadcrumb .crumb:hover:not(:disabled) {
  color: var(--accent);
  background: var(--accent-soft);
}

.ai-test-panel__breadcrumb .crumb.active {
  color: var(--text);
  font-weight: 600;
  cursor: default;
}

.ai-test-panel__breadcrumb .crumb:disabled {
  cursor: default;
}

.ai-test-panel__breadcrumb .crumb__sep {
  color: var(--muted);
  opacity: 0.6;
}

.ai-test-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
  transition: background-color var(--duration-fast) var(--ease-out);
}

.ai-test-item:hover {
  background: var(--surface-hover);
}

.ai-test-item--drillable {
  cursor: zoom-in;
}

.ai-test-item input[type='checkbox'] {
  width: 16px;
  height: 16px;
  min-width: 16px;
  margin: 0;
  flex: 0 0 16px;
  accent-color: var(--accent);
  cursor: pointer;
}

.ai-test-item__path {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-test-item__hint {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--accent);
  opacity: 0.7;
  white-space: nowrap;
}

.export-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(4, 10, 18, 0.55);
  backdrop-filter: blur(6px);
  animation: fade-up 0.2s var(--ease-out) both;
}

.export-modal {
  width: min(460px, 100%);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--panel);
  padding: 20px;
  box-shadow: var(--shadow-float);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.export-modal h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}

.export-modal__desc {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.5;
}

.export-modal__options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.export-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--panel-soft);
  cursor: pointer;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out);
}

.export-option:hover {
  border-color: var(--border-hover);
}

.export-option.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.export-option.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.export-option input[type='radio'] {
  margin-top: 2px;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  accent-color: var(--accent);
  cursor: pointer;
}

.export-option.disabled input[type='radio'] {
  cursor: not-allowed;
}

.export-option__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.export-option__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.export-option__desc {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}

.export-modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.export-modal__actions .primary,
.export-modal__actions .ghost {
  width: auto;
  margin-top: 0;
  min-width: 88px;
}
</style>
