import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '../..')

function envFlag(name: string): boolean | undefined {
  const raw = process.env[name]
  if (raw == null || raw === '') return undefined
  const value = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(value)) return true
  if (['0', 'false', 'no', 'off'].includes(value)) return false
  return undefined
}

/** Linux servers without DISPLAY/Wayland cannot open a headed Chromium window. */
export function canUseHeadedBrowser(): boolean {
  if (process.platform !== 'linux') return true
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return true
  return false
}

export function resolveDefaultHeadless(): boolean {
  const fromEnv = envFlag('PLAYWRIGHT_HEADLESS') ?? envFlag('HEADLESS')
  if (fromEnv != null) return fromEnv
  // Local desktop defaults to headed; server / CI defaults to headless.
  return !canUseHeadedBrowser()
}

export const config = {
  port: Number(process.env.PORT || 8787),
  rootDir,
  skillsDir: path.join(rootDir, 'skills'),
  screenshotDir: path.join(rootDir, 'server/data/screenshots'),
  defaultLlm: {
    baseUrl: process.env.LLM_BASE_URL || '',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
  },
  requirementsGenerationMaxDurationMs: Number(
    process.env.REQUIREMENTS_AI_MAX_RUN_MS || 60 * 60 * 1000,
  ),
  requirementsNoProgressLimit: Number(process.env.REQUIREMENTS_AI_NO_PROGRESS_LIMIT || 3),
  requirementsRetryBaseDelayMs: Number(process.env.REQUIREMENTS_AI_RETRY_BASE_DELAY_MS || 1000),
  defaultMaxSteps: Number(process.env.MAX_AGENT_STEPS || 0),
  defaultHeadless: resolveDefaultHeadless(),
  canUseHeadedBrowser: canUseHeadedBrowser(),
}
