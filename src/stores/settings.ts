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
  jev: {
    enabled: false,
    baseUrl: 'https://api.typesafe.ai/v1',
    apiKey: '',
    model: 'jev-latest',
  },
  session: {
    targetUrl: '',
    headless: false,
    maxSteps: 0,
    browserMode: 'auto',
    cdpEndpoint: '',
    attachUrlIncludes: '',
    waitForLogin: false,
    loginWaitSeconds: 180,
  },
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return structuredClone(defaultSettings)
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    const parsedLlm = parsed.llm
    const parsedJev = parsed.jev
    return {
      ...structuredClone(defaultSettings),
      ...parsed,
      llm: {
        baseUrl: typeof parsedLlm?.baseUrl === 'string' ? parsedLlm.baseUrl : '',
        apiKey: typeof parsedLlm?.apiKey === 'string' ? parsedLlm.apiKey : '',
        model: typeof parsedLlm?.model === 'string' ? parsedLlm.model : 'gpt-4o-mini',
      },
      jev: {
        enabled: typeof parsedJev?.enabled === 'boolean' ? parsedJev.enabled : false,
        baseUrl:
          typeof parsedJev?.baseUrl === 'string' && parsedJev.baseUrl
            ? parsedJev.baseUrl
            : defaultSettings.jev.baseUrl,
        apiKey: typeof parsedJev?.apiKey === 'string' ? parsedJev.apiKey : '',
        model:
          typeof parsedJev?.model === 'string' && parsedJev.model
            ? parsedJev.model
            : defaultSettings.jev.model,
      },
      session: { ...defaultSettings.session, ...parsed.session },
    }
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
      if (!rawHasSessionMax() && typeof defaults.session.maxSteps === 'number') {
        settings.value.session.maxSteps = defaults.session.maxSteps
      }
      // Prefer server-side headless default on first visit / bare settings.
      if (!rawHasSessionHeadless() && typeof defaults.session.headless === 'boolean') {
        settings.value.session.headless = defaults.session.headless
      }
      if (settings.value.jev) {
        if (!settings.value.jev.baseUrl && defaults.jev?.baseUrl) {
          settings.value.jev.baseUrl = defaults.jev.baseUrl
        }
        if (!settings.value.jev.model && defaults.jev?.model) {
          settings.value.jev.model = defaults.jev.model
        }
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
      return typeof parsed?.session?.maxSteps === 'number'
    } catch {
      return false
    }
  }

  function rawHasSessionHeadless() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return false
      const parsed = JSON.parse(raw)
      return typeof parsed?.session?.headless === 'boolean'
    } catch {
      return false
    }
  }

  return { settings, reset, hydrateFromServer }
})
