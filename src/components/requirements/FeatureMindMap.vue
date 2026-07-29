<script setup lang="ts">
import { nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type MindMap from 'simple-mind-map'
import type { MindMapNode } from '@/types/requirements'

const props = withDefaults(
  defineProps<{
    modelValue: MindMapNode | null
    readonly?: boolean
  }>(),
  {
    readonly: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: MindMapNode]
  ready: []
  /** 点击思维导图节点时触发，path 为从根节点（不含）到点击节点的文本路径 */
  nodeClick: [path: string[]]
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const noteTooltipRef = ref<HTMLDivElement | null>(null)
const noteTooltipText = ref('')
const noteTooltipLeft = ref(0)
const noteTooltipTop = ref(0)
const noteTooltipVisible = ref(false)
let mindMap: InstanceType<typeof MindMap> | null = null
let resizeObserver: ResizeObserver | null = null
let applyingExternal = false
let noteTooltipUpdate = 0

interface LibraryMindMapNode extends MindMapNode {
  data: MindMapNode['data'] & {
    uid?: string
    isActive?: boolean
  }
  children?: LibraryMindMapNode[]
  smmVersion?: string
}

function emptyRoot(): MindMapNode {
  return {
    data: { text: '需求功能点', expand: true },
    children: [],
  }
}

function hideNoteTooltip() {
  noteTooltipUpdate += 1
  noteTooltipVisible.value = false
}

async function showNoteTooltip(content: unknown, left: number, top: number) {
  const update = ++noteTooltipUpdate
  noteTooltipText.value = String(content || '')
  noteTooltipLeft.value = left
  noteTooltipTop.value = top + 6
  noteTooltipVisible.value = true

  await nextTick()
  window.requestAnimationFrame(() => {
    if (update !== noteTooltipUpdate || !noteTooltipVisible.value || !noteTooltipRef.value) return

    const margin = 12
    const { width, height } = noteTooltipRef.value.getBoundingClientRect()
    noteTooltipLeft.value = Math.min(
      Math.max(margin, left),
      Math.max(margin, window.innerWidth - width - margin),
    )
    noteTooltipTop.value = Math.min(
      Math.max(margin, top + 6),
      Math.max(margin, window.innerHeight - height - margin),
    )
  })
}

function cloneWithStableNodeIds(
  nextNode: MindMapNode,
  currentNode?: LibraryMindMapNode,
): LibraryMindMapNode {
  const data: LibraryMindMapNode['data'] = { ...nextNode.data }
  if (currentNode?.data.uid) data.uid = currentNode.data.uid

  const currentChildren = currentNode?.children || []
  const usedCurrentIndexes = new Set<number>()
  const children = (nextNode.children || []).map((child, index) => {
    let currentIndex = currentChildren.findIndex(
      (candidate, candidateIndex) =>
        !usedCurrentIndexes.has(candidateIndex) && candidate.data.text === child.data.text,
    )
    if (currentIndex < 0 && currentChildren[index] && !usedCurrentIndexes.has(index)) {
      currentIndex = index
    }
    if (currentIndex >= 0) usedCurrentIndexes.add(currentIndex)
    return cloneWithStableNodeIds(child, currentChildren[currentIndex])
  })

  return { data, children }
}

function comparableData(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(comparableData)
  if (!node || typeof node !== 'object') return node

  return Object.fromEntries(
    Object.entries(node).flatMap(([key, value]) => {
      if (key === 'uid' || key === 'isActive' || key === 'smmVersion' || key.startsWith('_')) {
        return []
      }
      return [[key, comparableData(value)]]
    }),
  )
}

function dataMatchesCurrent(data: MindMapNode) {
  if (!mindMap) return false
  return JSON.stringify(comparableData(mindMap.getData(false))) === JSON.stringify(data)
}

async function createMindMap() {
  if (!containerRef.value) return
  destroyMindMap()

  const [{ default: MindMapCtor }] = await Promise.all([
    import('simple-mind-map'),
    import('simple-mind-map/dist/simpleMindMap.esm.css'),
  ])

  // Component may have unmounted while the heavy library was loading.
  if (!containerRef.value) return

  mindMap = new MindMapCtor({
    el: containerRef.value,
    data: props.modelValue || emptyRoot(),
    readonly: props.readonly,
    layout: 'logicalStructure',
    theme: 'default',
    themeConfig: {
      backgroundColor: 'transparent',
      lineColor: '#2EE6A8',
      generalizationLineColor: '#8B9CFF',
      root: {
        fillColor: '#2EE6A8',
        color: '#04130E',
        borderRadius: 12,
        fontFamily: 'Sora, Noto Sans SC, sans-serif',
      },
      second: {
        fillColor: '#1B2330',
        color: '#E8EEF7',
        borderColor: 'rgba(46, 230, 168, 0.35)',
        borderWidth: 1,
        borderRadius: 10,
        fontFamily: 'Sora, Noto Sans SC, sans-serif',
      },
      node: {
        fillColor: '#121820',
        color: '#E8EEF7',
        borderColor: 'rgba(148, 163, 184, 0.22)',
        borderWidth: 1,
        borderRadius: 10,
        fontFamily: 'Sora, Noto Sans SC, sans-serif',
      },
    },
    mousewheelAction: 'zoom',
    mousewheelZoomActionReverse: true,
    textAutoWrapWidth: 220,
    customNoteContentShow: {
      show: showNoteTooltip,
      hide: hideNoteTooltip,
    },
  })

  mindMap.on('data_change', (data: MindMapNode) => {
    if (applyingExternal) return
    emit('update:modelValue', data)
  })
  mindMap.on('node_tree_render_start', hideNoteTooltip)
  mindMap.on('node_click', (node: unknown) => {
    const path = buildNodePath(node)
    if (path !== null) emit('nodeClick', path)
  })

  emit('ready')
}

/** 根据库内部 MindMapNode 实例还原出从根（不含）到该节点的文本路径 */
function buildNodePath(node: unknown): string[] | null {
  if (!node || typeof node !== 'object') return null
  const inst = node as {
    isRoot?: boolean
    parent?: unknown
    nodeData?: { data?: { text?: string } }
  }
  if (typeof inst.isRoot !== 'boolean') return null
  const path: string[] = []
  let current: typeof inst | undefined = inst
  while (current && !current.isRoot) {
    const text = current.nodeData?.data?.text
    if (typeof text !== 'string' || !text) return null
    path.unshift(text)
    current = current.parent as typeof inst | undefined
  }
  return path
}

function destroyMindMap() {
  hideNoteTooltip()
  if (mindMap) {
    try {
      mindMap.destroy()
    } catch {
      // ignore destroy race
    }
    mindMap = null
  }
  if (containerRef.value) {
    containerRef.value.innerHTML = ''
  }
}

function applyData(data: MindMapNode | null) {
  if (!mindMap || !data) return
  hideNoteTooltip()
  applyingExternal = true
  try {
    const current = mindMap.getData(false) as LibraryMindMapNode
    mindMap.updateData(cloneWithStableNodeIds(data, current))
  } finally {
    // allow internal events to settle
    window.setTimeout(() => {
      applyingExternal = false
    }, 0)
  }
}

function fit() {
  const currentMindMap = mindMap
  if (!currentMindMap) return

  currentMindMap.resize?.()
  currentMindMap.render?.(() => {
    if (mindMap !== currentMindMap) return
    currentMindMap.view?.fit?.()
  })
}

function exportData(): MindMapNode | null {
  if (!mindMap) return props.modelValue
  return mindMap.getData(false) as MindMapNode
}

defineExpose({ fit, exportData })

onMounted(async () => {
  await nextTick()
  createMindMap()
  if (containerRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      mindMap?.resize?.()
    })
    resizeObserver.observe(containerRef.value)
  }
})

onActivated(async () => {
  await nextTick()
  mindMap?.resize?.()
  window.requestAnimationFrame(() => {
    mindMap?.resize?.()
    mindMap?.view?.fit?.()
  })
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  destroyMindMap()
})

watch(
  () => props.modelValue,
  (value) => {
    if (!mindMap || !value) return
    if (dataMatchesCurrent(value)) return
    applyData(value)
  },
  { deep: true },
)

watch(
  () => props.readonly,
  (readonly) => {
    mindMap?.setMode?.(readonly ? 'readonly' : 'edit')
  },
)
</script>

<template>
  <div class="mindmap-wrap">
    <div ref="containerRef" class="mindmap-el" @mouseleave="hideNoteTooltip" />
    <div v-if="!modelValue" class="placeholder">
      上传需求文档并点击「AI 分析」后，功能点思维导图会显示在这里
    </div>
  </div>
  <Teleport to="body">
    <div
      ref="noteTooltipRef"
      v-show="noteTooltipVisible"
      class="mindmap-note-tooltip"
      role="tooltip"
      :style="{
        left: `${noteTooltipLeft}px`,
        top: `${noteTooltipTop}px`,
      }"
    >
      {{ noteTooltipText }}
    </div>
  </Teleport>
</template>

<style scoped>
.mindmap-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 420px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background:
    radial-gradient(
      circle at top left,
      color-mix(in srgb, var(--accent) 14%, transparent),
      transparent 42%
    ),
    radial-gradient(
      circle at bottom right,
      color-mix(in srgb, var(--accent-secondary) 12%, transparent),
      transparent 45%
    ),
    color-mix(in srgb, var(--panel) 94%, transparent);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  animation: fade-up 0.4s var(--ease-out) both;
}

.mindmap-el {
  width: 100%;
  height: 100%;
  min-height: 420px;
}

.placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
  pointer-events: none;
  background: color-mix(in srgb, var(--panel) 70%, transparent);
}

.mindmap-note-tooltip {
  position: fixed;
  z-index: 3000;
  max-width: min(360px, calc(100vw - 24px));
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: var(--radius-sm);
  background: #101722;
  box-shadow: var(--shadow-float);
  color: #f5f7fb;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.6;
  overflow-wrap: anywhere;
  pointer-events: none;
  white-space: pre-wrap;
}
</style>
