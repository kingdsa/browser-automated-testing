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
}>()

const containerRef = ref<HTMLDivElement | null>(null)
let mindMap: InstanceType<typeof MindMap> | null = null
let resizeObserver: ResizeObserver | null = null
let applyingExternal = false

function emptyRoot(): MindMapNode {
  return {
    data: { text: '需求功能点', expand: true },
    children: [],
  }
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
  })

  mindMap.on('data_change', (data: MindMapNode) => {
    if (applyingExternal) return
    emit('update:modelValue', data)
  })

  emit('ready')
}

function destroyMindMap() {
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
  applyingExternal = true
  try {
    mindMap.setData(data)
    mindMap.view?.fit?.()
  } finally {
    // allow internal events to settle
    window.setTimeout(() => {
      applyingExternal = false
    }, 0)
  }
}

function fit() {
  mindMap?.view?.fit?.()
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
    const current = JSON.stringify(mindMap.getData(false))
    const next = JSON.stringify(value)
    if (current === next) return
    applyData(value)
  },
  { deep: true },
)

watch(
  () => props.readonly,
  () => {
    createMindMap()
  },
)
</script>

<template>
  <div class="mindmap-wrap">
    <div ref="containerRef" class="mindmap-el" />
    <div v-if="!modelValue" class="placeholder">
      上传需求文档并点击「AI 分析」后，功能点思维导图会显示在这里
    </div>
  </div>
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
    radial-gradient(circle at top left, color-mix(in srgb, var(--accent) 14%, transparent), transparent 42%),
    radial-gradient(circle at bottom right, color-mix(in srgb, var(--accent-secondary) 12%, transparent), transparent 45%),
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
</style>
