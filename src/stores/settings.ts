import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { AppSettings } from '@/types/chat'
import { fetchDefaults } from '@/api/agent'

const STORAGE_KEY = 'bat.settings.v1'

const defaultSettings: AppSettings = {
  llm: {
    baseUrl: '',
    apiKey: '',
    model: 'gpt-4o-mini',
  },
  session: {
    targetUrl: '',
    headless: false,
    maxSteps: 16,
  },
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return structuredClone(defaultSettings)
    return { ...structuredClone(defaultSettings), ...JSON.parse(raw) }
  } catch {
    return structuredClone(defaultSettings)
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>(loadSettings())

  watch(
    settings,
    (value) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    },
    { deep: true },
  )

  function reset() {
    settings.value = structuredClone(defaultSettings)
  }

  async function hydrateFromServer() {
    try {
      const defaults = await fetchDefaults()
      if (!settings.value.llm.baseUrl && defaults.llm.baseUrl) {
        settings.value.llm.baseUrl = defaults.llm.baseUrl
      }
      if (!settings.value.llm.model && defaults.llm.model) {
        settings.value.llm.model = defaults.llm.model
      }
      if (defaults.llm.model && settings.value.llm.model === 'gpt-4o-mini' && defaults.llm.model !== 'gpt-4o-mini') {
        // prefer server model when still on template default
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) settings.value.llm.model = defaults.llm.model
      }
      if (!rawHasSessionMax() && defaults.session.maxSteps) {
        settings.value.session.maxSteps = defaults.session.maxSteps
      }
    } catch {
      // ignore offline backend during first paint
    }
  }

  function rawHasSessionMax() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return false
      const parsed = JSON.parse(raw)
      return Boolean(parsed?.session?.maxSteps)
    } catch {
      return false
    }
  }

  return { settings, reset, hydrateFromServer }
})
