import express from 'express'
import cors from 'cors'
import path from 'node:path'
import fs from 'node:fs'
import { config } from './config.js'
import { chatRouter } from './routes/chat.js'

fs.mkdirSync(config.screenshotDir, { recursive: true })

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))
app.use('/screenshots', express.static(config.screenshotDir))
app.use('/api', chatRouter)

app.get('/', (_req, res) => {
  res.json({
    name: 'browser-automated-testing-agent',
    endpoints: ['/api/health', '/api/defaults', '/api/skills', '/api/browser/tabs', '/api/chat', '/screenshots/*'],
  })
})

app.listen(config.port, () => {
  console.log(`Agent server listening on http://127.0.0.1:${config.port}`)
  console.log(`Skills dir: ${config.skillsDir}`)
  console.log(`Screenshots: ${config.screenshotDir}`)
})
