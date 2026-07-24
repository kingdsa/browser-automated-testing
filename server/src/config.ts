import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '../..')

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
  defaultMaxSteps: Number(process.env.MAX_AGENT_STEPS || 20),
}
