<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  deleteCategorySkill,
  listCategorySkills,
  selectCategorySkills,
  uploadCategorySkill,
  type CategorySkill,
  type SkillCategory,
} from '@/api/skills'

const props = defineProps<{
  category: SkillCategory
  title?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  change: [skills: CategorySkill[]]
}>()

const skills = ref<CategorySkill[]>([])
const loading = ref(false)
const uploading = ref(false)
const errorText = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)

const selectedFileNames = computed(() =>
  skills.value.filter((skill) => skill.selected).map((skill) => skill.fileName),
)

async function refresh() {
  loading.value = true
  errorText.value = ''
  try {
    skills.value = await listCategorySkills(props.category)
    emit('change', skills.value)
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

async function toggleSelect(skill: CategorySkill, checked: boolean) {
  const next = checked
    ? Array.from(new Set([...selectedFileNames.value, skill.fileName]))
    : selectedFileNames.value.filter((name) => name !== skill.fileName)
  try {
    skills.value = await selectCategorySkills(props.category, next)
    emit('change', skills.value)
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : String(error)
    // Re-sync local state with server on failure.
    await refresh()
  }
}

function onPickFile() {
  fileInputRef.value?.click()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] || null
  if (!file) return
  uploading.value = true
  errorText.value = ''
  try {
    skills.value = await uploadCategorySkill(props.category, file)
    emit('change', skills.value)
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : String(error)
  } finally {
    uploading.value = false
    input.value = ''
  }
}

async function onDelete(skill: CategorySkill) {
  if (skill.isDefault) return
  if (!confirm(`确认删除 skill「${skill.name || skill.fileName}」？此操作不可撤销。`)) return
  try {
    skills.value = await deleteCategorySkill(props.category, skill.fileName)
    emit('change', skills.value)
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : String(error)
  }
}

onMounted(() => {
  refresh()
})

defineExpose({ refresh })
</script>

<template>
  <div class="skills-panel">
    <div class="skills-panel__head">
      <span class="skills-panel__title">{{ title || 'Skills' }}</span>
      <div class="skills-panel__actions">
        <button
          type="button"
          class="icon-btn"
          :disabled="loading || uploading || disabled"
          :title="loading ? '刷新中…' : '刷新'"
          :aria-label="loading ? '刷新中' : '刷新'"
          @click="refresh"
        >
          <svg
            class="icon-btn__svg"
            :class="{ spinning: loading }"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            aria-hidden="true"
            focusable="false"
          >
            <path
              fill="currentColor"
              d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.74 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
            />
          </svg>
        </button>
        <button
          type="button"
          class="icon-btn"
          :disabled="uploading || disabled"
          :title="uploading ? '上传中…' : '上传 .md'"
          :aria-label="uploading ? '上传中' : '上传 .md'"
          @click="onPickFile"
        >
          <svg
            class="icon-btn__svg"
            :class="{ pulsing: uploading }"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            aria-hidden="true"
            focusable="false"
          >
            <path
              fill="currentColor"
              d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"
            />
          </svg>
        </button>
        <input
          ref="fileInputRef"
          class="hidden"
          type="file"
          accept=".md,.markdown,text/markdown"
          :disabled="uploading || disabled"
          @change="onFileChange"
        />
      </div>
    </div>

    <p v-if="errorText" class="skills-panel__error">{{ errorText }}</p>

    <ul v-if="skills.length" class="skills-list">
      <li
        v-for="skill in skills"
        :key="skill.fileName"
        class="skill-item"
        :class="{ 'skill-item--default': skill.isDefault }"
      >
        <label class="skill-item__main">
          <input
            type="checkbox"
            :checked="skill.selected"
            :disabled="disabled"
            @change="toggleSelect(skill, ($event.target as HTMLInputElement).checked)"
          />
          <span class="skill-item__name">{{ skill.name }}</span>
          <span v-if="skill.isDefault" class="skill-item__badge">默认</span>
        </label>
        <p v-if="skill.description" class="skill-item__desc">{{ skill.description }}</p>
        <div class="skill-item__meta">
          <span class="skill-item__file">{{ skill.fileName }}</span>
          <button
            v-if="!skill.isDefault"
            type="button"
            class="delete-btn mini"
            :disabled="disabled"
            @click="onDelete(skill)"
          >
            删除
          </button>
        </div>
      </li>
    </ul>
    <p v-else-if="!loading" class="skills-panel__empty">
      该类别暂无 skill。可点击「上传 .md」添加自定义 skill 文件。
    </p>
  </div>
</template>

<style scoped>
.skills-panel {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px dashed color-mix(in srgb, var(--accent) 35%, var(--border));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--accent) 4%, var(--panel-soft));
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skills-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.skills-panel__title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.skills-panel__actions {
  display: flex;
  gap: 6px;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  line-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--panel-soft) 85%, transparent);
  color: var(--text-secondary);
  cursor: pointer;
}

.icon-btn:hover:not(:disabled) {
  border-color: var(--border-hover);
  background: var(--surface-hover);
  color: var(--accent);
  transform: translateY(-1px);
}

.icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon-btn__svg {
  display: block;
}

.icon-btn__svg.spinning {
  animation: skills-spin 0.9s linear infinite;
}

.icon-btn__svg.pulsing {
  animation: skills-pulse 1s ease-in-out infinite;
}

@keyframes skills-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes skills-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.skills-panel__error {
  margin: 0;
  color: var(--error-text);
  font-size: 11px;
}

.skills-panel__empty {
  margin: 0;
  color: var(--muted);
  font-size: 11px;
}

.skills-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.skill-item {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--panel);
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.skill-item--default {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  background: color-mix(in srgb, var(--accent) 6%, var(--panel));
}

.skill-item__main {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.skill-item__main input[type='checkbox'] {
  width: 14px;
  height: 14px;
  min-width: 14px;
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;
}

.skill-item__name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  word-break: break-all;
}

.skill-item__badge {
  font-size: 10px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-radius: 999px;
  padding: 1px 6px;
  font-weight: 600;
}

.skill-item__desc {
  margin: 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.skill-item__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.skill-item__file {
  font-size: 10px;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
}

.delete-btn.mini {
  padding: 2px 6px;
  font-size: 10px;
}

.hidden {
  display: none;
}
</style>
