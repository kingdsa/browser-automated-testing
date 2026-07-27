<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { TestCase, TestCasePriority } from '@/types/requirements'
import { createEmptyTestCase } from '@/utils/testCases'

const props = defineProps<{
  modelValue: TestCase[]
  title?: string
  summary?: string
  generating?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: TestCase[]]
  'update:title': [value: string]
  'update:summary': [value: string]
}>()

const priorities: TestCasePriority[] = ['P0', 'P1', 'P2', 'P3']
const types = ['功能', '异常', '边界', '权限', '兼容', '性能']

const listRef = ref<HTMLElement | null>(null)
const activeCaseKey = ref<string | null>(null)
const collapsedGroups = ref<Set<string>>(new Set())
const treeFilter = ref('')
let observer: IntersectionObserver | null = null
const visibleRatios = new Map<string, number>()

interface TreeLeaf {
  key: string
  index: number
  id: string
  title: string
  priority: TestCasePriority
  type: string
}

interface TreeGroup {
  key: string
  label: string
  path: string
  items: TreeLeaf[]
}

function caseKey(item: TestCase, index: number) {
  return `${item.id || 'case'}-${index}`
}

function groupKeyOf(item: TestCase) {
  const path = (item.featurePath || item.feature || '').trim()
  return path || '__ungrouped__'
}

function groupLabelOf(item: TestCase) {
  const path = (item.featurePath || '').trim()
  const feature = (item.feature || '').trim()
  if (path) return path
  if (feature) return feature
  return '未分组'
}

const treeGroups = computed<TreeGroup[]>(() => {
  const map = new Map<string, TreeGroup>()
  const filter = treeFilter.value.trim().toLowerCase()

  props.modelValue.forEach((item, index) => {
    const key = caseKey(item, index)
    const id = item.id || `TC-${index + 1}`
    const title = item.title || `用例 ${index + 1}`
    if (
      filter &&
      !id.toLowerCase().includes(filter) &&
      !title.toLowerCase().includes(filter) &&
      !(item.feature || '').toLowerCase().includes(filter) &&
      !(item.featurePath || '').toLowerCase().includes(filter)
    ) {
      return
    }

    const groupKey = groupKeyOf(item)
    let group = map.get(groupKey)
    if (!group) {
      group = {
        key: groupKey,
        label: groupLabelOf(item),
        path: (item.featurePath || item.feature || '').trim(),
        items: [],
      }
      map.set(groupKey, group)
    }
    group.items.push({
      key,
      index,
      id,
      title,
      priority: item.priority,
      type: item.type,
    })
  })

  return Array.from(map.values())
})

const flatLeaves = computed(() => treeGroups.value.flatMap((group) => group.items))

function updateCase(index: number, patch: Partial<TestCase>) {
  const next = props.modelValue.map((item, i) => (i === index ? { ...item, ...patch } : item))
  emit('update:modelValue', next)
}

function updateStep(caseIndex: number, stepIndex: number, value: string) {
  const current = props.modelValue[caseIndex]
  if (!current) return
  const steps = current.steps.map((step, i) => (i === stepIndex ? value : step))
  updateCase(caseIndex, { steps })
}

function addStep(caseIndex: number) {
  const current = props.modelValue[caseIndex]
  if (!current) return
  updateCase(caseIndex, { steps: [...current.steps, ''] })
}

function removeStep(caseIndex: number, stepIndex: number) {
  const current = props.modelValue[caseIndex]
  if (!current) return
  const steps = current.steps.filter((_, i) => i !== stepIndex)
  updateCase(caseIndex, { steps: steps.length ? steps : [''] })
}

function addCase() {
  emit('update:modelValue', [...props.modelValue, createEmptyTestCase(props.modelValue.length)])
}

function removeCase(index: number) {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  )
}

function moveCase(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= props.modelValue.length) return
  const next = [...props.modelValue]
  const [item] = next.splice(index, 1)
  if (!item) return
  next.splice(target, 0, item)
  emit('update:modelValue', next)
}

function isGroupCollapsed(groupKey: string) {
  return collapsedGroups.value.has(groupKey)
}

function toggleGroup(groupKey: string) {
  const next = new Set(collapsedGroups.value)
  if (next.has(groupKey)) next.delete(groupKey)
  else next.add(groupKey)
  collapsedGroups.value = next
}

function expandAll() {
  collapsedGroups.value = new Set()
}

function collapseAll() {
  collapsedGroups.value = new Set(treeGroups.value.map((group) => group.key))
}

async function scrollToCase(index: number) {
  const item = props.modelValue[index]
  if (!item) return
  const key = caseKey(item, index)
  activeCaseKey.value = key
  await nextTick()
  const el = listRef.value?.querySelector<HTMLElement>(`[data-case-key="${CSS.escape(key)}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  el.classList.add('case-card--flash')
  window.setTimeout(() => el.classList.remove('case-card--flash'), 900)
}

function pickActiveFromVisibility() {
  let bestKey: string | null = null
  let bestRatio = 0
  for (const [key, ratio] of visibleRatios.entries()) {
    if (ratio > bestRatio) {
      bestRatio = ratio
      bestKey = key
    }
  }
  if (bestKey) activeCaseKey.value = bestKey
}

function setupObserver() {
  observer?.disconnect()
  observer = null
  visibleRatios.clear()
  if (!listRef.value || !props.modelValue.length) return

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.caseKey
        if (!key) continue
        if (entry.isIntersecting) visibleRatios.set(key, entry.intersectionRatio)
        else visibleRatios.delete(key)
      }
      pickActiveFromVisibility()
    },
    {
      root: listRef.value,
      threshold: [0.15, 0.35, 0.55, 0.75],
      rootMargin: '-8% 0px -55% 0px',
    },
  )

  listRef.value.querySelectorAll<HTMLElement>('[data-case-key]').forEach((el) => observer?.observe(el))
}

watch(
  () => props.modelValue.map((item, index) => caseKey(item, index)).join('|'),
  async () => {
    await nextTick()
    setupObserver()
    if (!activeCaseKey.value && props.modelValue[0]) {
      activeCaseKey.value = caseKey(props.modelValue[0], 0)
    }
  },
)

onMounted(async () => {
  await nextTick()
  setupObserver()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div class="panel">
    <div class="panel__head">
      <div class="meta">
        <input
          class="title-input"
          :value="title || ''"
          placeholder="测试用例集标题"
          @input="emit('update:title', ($event.target as HTMLInputElement).value)"
        />
        <input
          class="summary-input"
          :value="summary || ''"
          placeholder="覆盖说明 / 摘要"
          @input="emit('update:summary', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="head-actions">
        <span class="count">共 {{ modelValue.length }} 条</span>
        <button type="button" class="ghost" :disabled="generating" @click="addCase">新增用例</button>
      </div>
    </div>

    <div v-if="!modelValue.length" class="empty">
      {{ generating ? 'AI 正在根据功能点生成测试用例...' : '暂无测试用例。点击“生成测试用例”开始。' }}
    </div>

    <div v-else class="workspace">
      <aside class="tree" aria-label="测试用例目录">
        <div class="tree__toolbar">
          <input
            v-model="treeFilter"
            class="tree__search"
            type="search"
            placeholder="筛选标题 / ID / 功能点"
          />
          <div class="tree__actions">
            <button type="button" class="mini" title="全部展开" @click="expandAll">展开</button>
            <button type="button" class="mini" title="全部折叠" @click="collapseAll">折叠</button>
          </div>
        </div>

        <div class="tree__scroll">
          <div v-if="!treeGroups.length" class="tree__empty">没有匹配的用例</div>

          <div v-for="group in treeGroups" :key="group.key" class="tree-group">
            <button type="button" class="tree-group__head" @click="toggleGroup(group.key)">
              <span class="chevron" :class="{ collapsed: isGroupCollapsed(group.key) }">▾</span>
              <span class="tree-group__label" :title="group.label">{{ group.label }}</span>
              <span class="tree-group__count">{{ group.items.length }}</span>
            </button>

            <ul v-show="!isGroupCollapsed(group.key)" class="tree-group__list">
              <li v-for="leaf in group.items" :key="leaf.key">
                <button
                  type="button"
                  class="tree-leaf"
                  :class="{ active: activeCaseKey === leaf.key }"
                  :title="`${leaf.id} ${leaf.title}`"
                  @click="scrollToCase(leaf.index)"
                >
                  <span class="tree-leaf__id">{{ leaf.id }}</span>
                  <span class="tree-leaf__title">{{ leaf.title }}</span>
                  <span class="tree-leaf__meta">
                    <span class="prio" :data-p="leaf.priority">{{ leaf.priority }}</span>
                  </span>
                </button>
              </li>
            </ul>
          </div>
        </div>

        <div class="tree__footer">目录 {{ flatLeaves.length }} / {{ modelValue.length }}</div>
      </aside>

      <div ref="listRef" class="list">
        <article
          v-for="(item, index) in modelValue"
          :key="caseKey(item, index)"
          class="case-card"
          :class="{ 'case-card--active': activeCaseKey === caseKey(item, index) }"
          :data-case-key="caseKey(item, index)"
        >
          <div class="case-card__head">
            <div class="ids">
              <input
                class="id-input"
                :value="item.id"
                @input="updateCase(index, { id: ($event.target as HTMLInputElement).value })"
              />
              <input
                class="case-title"
                :value="item.title"
                placeholder="用例标题"
                @input="updateCase(index, { title: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div class="case-actions">
              <button type="button" class="mini" title="上移" @click="moveCase(index, -1)">↑</button>
              <button type="button" class="mini" title="下移" @click="moveCase(index, 1)">↓</button>
              <button type="button" class="mini danger" title="删除" @click="removeCase(index)">删</button>
            </div>
          </div>

          <div class="grid">
            <label>
              <span>功能点</span>
              <input
                :value="item.feature"
                @input="updateCase(index, { feature: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <label>
              <span>路径</span>
              <input
                :value="item.featurePath"
                @input="updateCase(index, { featurePath: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <label>
              <span>优先级</span>
              <select
                :value="item.priority"
                @change="
                  updateCase(index, {
                    priority: ($event.target as HTMLSelectElement).value as TestCasePriority,
                  })
                "
              >
                <option v-for="p in priorities" :key="p" :value="p">{{ p }}</option>
              </select>
            </label>
            <label>
              <span>类型</span>
              <select
                :value="item.type"
                @change="updateCase(index, { type: ($event.target as HTMLSelectElement).value })"
              >
                <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
              </select>
            </label>
          </div>

          <label class="block">
            <span>前置条件</span>
            <textarea
              rows="2"
              :value="item.preconditions"
              @input="updateCase(index, { preconditions: ($event.target as HTMLTextAreaElement).value })"
            />
          </label>

          <div class="steps">
            <div class="steps__head">
              <span>步骤</span>
              <button type="button" class="mini" @click="addStep(index)">+ 步骤</button>
            </div>
            <div v-for="(step, stepIndex) in item.steps" :key="stepIndex" class="step-row">
              <span class="step-no">{{ stepIndex + 1 }}</span>
              <input
                :value="step"
                @input="updateStep(index, stepIndex, ($event.target as HTMLInputElement).value)"
              />
              <button type="button" class="mini danger" @click="removeStep(index, stepIndex)">×</button>
            </div>
          </div>

          <label class="block">
            <span>期望结果</span>
            <textarea
              rows="2"
              :value="item.expected"
              @input="updateCase(index, { expected: ($event.target as HTMLTextAreaElement).value })"
            />
          </label>

          <label class="block">
            <span>备注</span>
            <input
              :value="item.note || ''"
              @input="updateCase(index, { note: ($event.target as HTMLInputElement).value })"
            />
          </label>
        </article>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--panel) 94%, transparent);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  animation: fade-up 0.4s var(--ease-out) both;
}

.panel__head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--accent) 5%, var(--panel));
  flex-shrink: 0;
}

.meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.title-input,
.summary-input {
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text);
  outline: none;
  border-radius: var(--radius-sm);
  padding: 2px 4px;
  line-height: 1.35;
}

.title-input {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.summary-input {
  font-size: 12px;
  color: var(--text-secondary);
}

.title-input:hover,
.summary-input:hover,
.title-input:focus,
.summary-input:focus {
  border-color: var(--border);
  background: var(--input);
}

.title-input:focus,
.summary-input:focus {
  border-color: var(--accent);
  box-shadow: var(--shadow-focus);
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.count {
  font-size: 11px;
  color: var(--muted);
  border: 1px solid var(--border);
  background: var(--panel-soft);
  border-radius: var(--radius-pill);
  padding: 2px 8px;
  line-height: 1.4;
}

.ghost {
  border: 1px solid var(--border);
  background: var(--panel-soft);
  color: var(--text);
  border-radius: var(--radius-md);
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.4;
}

.ghost:hover:not(:disabled) {
  border-color: var(--border-hover);
  background: var(--surface-hover);
  transform: translateY(-1px);
}

.ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.empty {
  margin: auto;
  padding: 36px 20px;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.7;
}

.workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
}

.tree {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel-soft) 88%, transparent);
}

.tree__toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.tree__search {
  width: 100%;
  border: 1px solid var(--border);
  background: var(--input);
  color: var(--text);
  border-radius: var(--radius-md);
  padding: 8px 10px;
  outline: none;
  font: inherit;
  font-size: 12px;
}

.tree__search:focus {
  border-color: var(--accent);
  box-shadow: var(--shadow-focus);
}

.tree__actions {
  display: flex;
  gap: 6px;
}

.tree__scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
  scrollbar-gutter: stable;
}

.tree__empty {
  padding: 18px 10px;
  text-align: center;
  color: var(--muted);
  font-size: 12px;
}

.tree-group + .tree-group {
  margin-top: 6px;
}

.tree-group__head {
  width: 100%;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
}

.tree-group__head:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.chevron {
  display: inline-flex;
  justify-content: center;
  transition: transform 0.18s ease;
  color: var(--muted);
}

.chevron.collapsed {
  transform: rotate(-90deg);
}

.tree-group__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-group__count {
  font-size: 11px;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  padding: 1px 7px;
  background: var(--panel);
}

.tree-group__list {
  list-style: none;
  margin: 2px 0 0;
  padding: 0 0 0 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tree-leaf {
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: 7px 8px;
  cursor: pointer;
  text-align: left;
  font: inherit;
}

.tree-leaf:hover {
  background: var(--surface-hover);
  border-color: var(--border);
}

.tree-leaf.active {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 28%, transparent);
  box-shadow: inset 2px 0 0 var(--accent);
}

.tree-leaf__id {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  font-weight: 700;
  color: var(--accent);
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-leaf__title {
  font-size: 12px;
  line-height: 1.35;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.tree-leaf__meta {
  display: inline-flex;
  align-items: center;
}

.prio {
  font-size: 10px;
  font-weight: 700;
  border-radius: 6px;
  padding: 2px 5px;
  border: 1px solid var(--border);
  color: var(--muted);
  background: var(--panel);
}

.prio[data-p='P0'] {
  color: var(--error-text, #ff6b6b);
  border-color: var(--error-border, rgba(255, 107, 107, 0.35));
  background: var(--error-soft, rgba(255, 107, 107, 0.12));
}

.prio[data-p='P1'] {
  color: #f0b429;
  border-color: rgba(240, 180, 41, 0.35);
  background: rgba(240, 180, 41, 0.12);
}

.tree__footer {
  flex-shrink: 0;
  border-top: 1px solid var(--border);
  padding: 8px 12px;
  font-size: 11px;
  color: var(--muted);
}

.list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scrollbar-gutter: stable;
  scroll-behavior: smooth;
}

.case-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--panel-soft);
  padding: 12px;
  box-shadow: var(--shadow-xs);
  scroll-margin-top: 12px;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.case-card--active {
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
}

.case-card--flash {
  animation: case-flash 0.9s ease;
}

@keyframes case-flash {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent);
  }
  30% {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent);
  }
  100% {
    box-shadow: var(--shadow-xs);
  }
}

.case-card__head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
}

.ids {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.id-input,
.case-title,
.grid input,
.grid select,
.block input,
.block textarea,
.step-row input {
  width: 100%;
  border: 1px solid var(--border);
  background: var(--input);
  color: var(--text);
  border-radius: var(--radius-md);
  padding: 8px 10px;
  outline: none;
  font: inherit;
}

.id-input {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
}

.case-title {
  font-weight: 600;
}

.id-input:focus,
.case-title:focus,
.grid input:focus,
.grid select:focus,
.block input:focus,
.block textarea:focus,
.step-row input:focus {
  border-color: var(--accent);
  box-shadow: var(--shadow-focus);
}

.case-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.mini {
  border-radius: var(--radius-sm);
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  padding: 4px 8px;
  font-size: 12px;
  min-width: 28px;
}

.mini:hover:not(:disabled) {
  background: var(--surface-hover);
  border-color: var(--border-hover);
}

.mini.danger {
  color: var(--error-text);
  border-color: var(--error-border);
  background: var(--error-soft);
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.grid label,
.block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}

.block {
  margin-top: 10px;
}

.block textarea {
  resize: vertical;
  line-height: 1.6;
  color: var(--text);
}

.steps {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.steps__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--muted);
  font-size: 12px;
}

.step-row {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  gap: 8px;
  align-items: center;
}

.step-no {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
}

@media (max-width: 1100px) {
  .workspace {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(180px, 34%) minmax(0, 1fr);
  }

  .tree {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .grid,
  .ids {
    grid-template-columns: 1fr;
  }

  .panel__head,
  .case-card__head {
    flex-direction: column;
    align-items: stretch;
  }

  .case-actions,
  .head-actions {
    justify-content: flex-end;
  }
}
</style>
