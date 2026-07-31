import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import { config } from './config.js'
import { chatRouter } from './routes/chat.js'
import { requirementsRouter } from './routes/requirements.js'

fs.mkdirSync(config.screenshotDir, { recursive: true })

const app = express()
app.use(cors())
app.use(express.json({ limit: '8mb' }))
app.use(express.urlencoded({ extended: true, limit: '8mb' }))
app.use('/screenshots', express.static(config.screenshotDir))
app.use('/api', chatRouter)
app.use('/api', requirementsRouter)

app.get('/', (_req, res) => {
  res.json({
    name: 'browser-automated-testing-agent',
    endpoints: [
      '/api/health',
      '/api/defaults',
      '/api/skills',
      '/api/browser/tabs',
      '/api/chat',
      '/api/requirements/analyze',
      '/api/requirements/extract',
      '/api/requirements/test-cases',
      '/api/requirements/analyze/stream',
      '/api/requirements/mindmap/stream',
      '/api/requirements/test-cases/stream',
      '/screenshots/*',
    ],
  })
})

app.listen(config.port, () => {
  console.log(`Agent server listening on http://127.0.0.1:${config.port}`)
  console.log(`Skills dir: ${config.skillsDir}`)
  console.log(`Screenshots: ${config.screenshotDir}`)
})
