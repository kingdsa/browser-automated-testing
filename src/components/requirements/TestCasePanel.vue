<script setup lang="ts">
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

    <div v-else class="list">
      <article v-for="(item, index) in modelValue" :key="`${item.id}-${index}`" class="case-card">
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
              @change="updateCase(index, { priority: ($event.target as HTMLSelectElement).value as TestCasePriority })"
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
            <input :value="step" @input="updateStep(index, stepIndex, ($event.target as HTMLInputElement).value)" />
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
</template>

<style scoped>
.panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--panel);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}

.panel__head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  padding: 14px 14px 0;
  flex-shrink: 0;
}

.meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.title-input {
  font-size: 16px;
  font-weight: 700;
}

.summary-input {
  font-size: 13px;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.count {
  font-size: 12px;
  color: var(--muted);
}

.empty {
  margin: 0 14px 14px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  padding: 40px 16px;
  text-align: center;
  color: var(--muted);
  background: var(--panel-soft);
}

.list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.case-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--panel-soft);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.case-card:hover {
  border-color: var(--border-hover);
  box-shadow: var(--shadow-xs);
}

.case-card__head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.ids {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 8px;
}

.id-input {
  font-weight: 700;
}

.case-title {
  font-weight: 600;
}

.case-actions,
.steps__head,
.step-row,
.head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr 100px 100px;
  gap: 8px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}

.block {
  width: 100%;
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.steps__head {
  justify-content: space-between;
  font-size: 12px;
  color: var(--muted);
}

.step-row {
  display: grid;
  grid-template-columns: 28px 1fr 32px;
  gap: 6px;
  align-items: center;
}

.step-no {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
}

input,
textarea,
select {
  width: 100%;
  border: 1px solid var(--border);
  background: var(--input);
  color: var(--text);
  border-radius: var(--radius-md);
  padding: 8px 10px;
  outline: none;
  font: inherit;
}

input:focus,
textarea:focus,
select:focus {
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
}

.ghost,
.mini {
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.ghost {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  padding: 8px 10px;
}

.mini {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  padding: 4px 8px;
  font-size: 12px;
}

.mini.danger {
  color: var(--error-text);
  border-color: var(--error-border);
  background: var(--error-soft);
}

@media (max-width: 1100px) {
  .grid,
  .ids {
    grid-template-columns: 1fr;
  }

  .panel__head {
    flex-direction: column;
  }
}
</style>
