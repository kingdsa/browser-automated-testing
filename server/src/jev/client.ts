/**
 * TypeSafe Jev (System One) client.
 *
 * Jev returns typed decisions (Choice / Score / Noul) with calibrated
 * probabilities. Everything here is best-effort: when Jev is not configured or
 * a request fails, callers get `null` and must keep their existing code path.
 */
import { config } from '../config.js'
import type { JevSettings } from '../types/index.js'

export interface JevNoulQuestion {
  type: 'noul'
  instructions: string
  criteria?: { true?: string; false?: string }
}

export interface JevChoiceQuestion {
  type: 'choice'
  instructions: string
  criteria: Record<string, string | null>
}

export interface JevScoreQuestion {
  type: 'score'
  instructions: string
  criteria: string[]
}

export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion

export interface JevNoulAnswer {
  type: 'noul'
  noul: number
}

export interface JevChoiceAnswer {
  type: 'choice'
  choice: string
  probabilities: Record<string, number>
  confidence: number
}

export interface JevScoreAnswer {
  type: 'score'
  score: number
  legend: Record<string, string>
  probabilities: Record<string, number>
  confidence: number
}

export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer

export type JevAnswers = Record<string, JevAnswer>

export interface ResolvedJevSettings {
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
}

export function resolveJevSettings(input?: JevSettings | null): ResolvedJevSettings {
  return {
    enabled: input?.enabled !== false,
    baseUrl: input?.baseUrl?.trim() || config.defaultJev.baseUrl,
    apiKey: input?.apiKey?.trim() || config.defaultJev.apiKey,
    model: input?.model?.trim() || config.defaultJev.model,
  }
}

function normalizeSystemOneUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (/\/systemone$/i.test(trimmed)) return trimmed
  if (/\/v\d+$/i.test(trimmed)) return `${trimmed}/systemone`
  return `${trimmed}/v1/systemone`
}

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_RETRIES = 2
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529])

export interface JevClientOptions {
  signal?: AbortSignal
  timeoutMs?: number
  maxRetries?: number
  /** Surfaced to the UI for observability (e.g. fallback notices). */
  onNote?: (message: string) => void
}

export class JevClient {
  private readonly settings: ResolvedJevSettings
  private readonly options: JevClientOptions
  private noteCount = 0

  constructor(settings: ResolvedJevSettings, options: JevClientOptions = {}) {
    this.settings = settings
    this.options = options
  }

  get active(): boolean {
    return Boolean(this.settings.enabled && this.settings.apiKey && this.settings.baseUrl)
  }

  get model(): string {
    return this.settings.model
  }

  private note(message: string) {
    // Keep fallback noise bounded: one notice per client is enough.
    if (this.noteCount >= 2) return
    this.noteCount += 1
    this.options.onNote?.(message)
  }

  /**
   * Ask one or more questions against a shared state.
   * Returns null when Jev is disabled or unavailable; never throws.
   */
  async ask(state: unknown, questions: Record<string, JevQuestion>): Promise<JevAnswers | null> {
    if (!this.active) return null
    const questionKeys = Object.keys(questions)
    if (!questionKeys.length) return null

    const url = normalizeSystemOneUrl(this.settings.baseUrl)
    if (!url) return null

    const body = JSON.stringify({
      state: typeof state === 'string' ? state : state,
      model: this.settings.model,
      questions,
    })

    const maxRetries = this.options.maxRetries ?? DEFAULT_MAX_RETRIES
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    let lastError: unknown = null

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (this.options.signal?.aborted) return null
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.settings.apiKey}`,
          },
          body,
          signal: this.options.signal
            ? AbortSignal.any([this.options.signal, AbortSignal.timeout(timeoutMs)])
            : AbortSignal.timeout(timeoutMs),
        })

        if (!response.ok) {
          const text = await response.text().catch(() => '')
          if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
            const retryAfter = Number(response.headers.get('retry-after'))
            const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(retryAfter * 1000, 2000)
              : 300 * 2 ** attempt
            await new Promise((resolve) => setTimeout(resolve, delayMs))
            continue
          }
          throw new Error(`Jev HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
        }

        const payload = (await response.json()) as { answers?: JevAnswers }
        if (!payload?.answers || typeof payload.answers !== 'object') {
          throw new Error('Jev 响应缺少 answers')
        }
        return payload.answers
      } catch (error) {
        if (this.options.signal?.aborted) return null
        lastError = error
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt))
          continue
        }
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError)
    this.note(`Jev 不可用，已自动回退常规流程：${message}`)
    return null
  }
}

export function createJevClient(input?: JevSettings | null, options?: JevClientOptions): JevClient {
  return new JevClient(resolveJevSettings(input), options)
}