import { Router } from 'express'
import { z } from 'zod'
import { runAgent } from '../agent/runner.js'
import { config } from '../config.js'
import { loadSkills } from '../skills/loader.js'

const chatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1),
      }),
    )
    .min(1),
  llm: z
    .object({
      baseUrl: z.string().optional(),
      apiKey: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
  session: z
    .object({
      targetUrl: z.string().url().optional().or(z.literal('')),
      headless: z.boolean().optional(),
      maxSteps: z.number().int().min(1).max(50).optional(),
    })
    .optional(),
})

export const chatRouter = Router()

chatRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'browser-automated-testing-agent' })
})


chatRouter.get('/defaults', (_req, res) => {
  res.json({
    llm: {
      baseUrl: config.defaultLlm.baseUrl,
      model: config.defaultLlm.model,
      hasApiKey: Boolean(config.defaultLlm.apiKey),
    },
    session: {
      maxSteps: config.defaultMaxSteps,
      headless: false,
    },
  })
})

chatRouter.get('/skills', async (_req, res) => {
  const skills = await loadSkills()
  res.json({
    skills: skills.map((s) => ({ name: s.name, description: s.description })),
  })
})

chatRouter.post('/chat', async (req, res) => {
  const parsed = chatBodySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() })
    return
  }

  const body = parsed.data
  const llm = {
    baseUrl: body.llm?.baseUrl || config.defaultLlm.baseUrl,
    apiKey: body.llm?.apiKey || config.defaultLlm.apiKey,
    model: body.llm?.model || config.defaultLlm.model,
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const abortController = new AbortController()
  // Only abort when the client disconnects mid-stream, not when the request body ends.
  res.on('close', () => {
    if (!res.writableEnded) abortController.abort()
  })

  const writeEvent = (event: { type: string; data: unknown }) => {
    res.write(`event: ${event.type}\n`)
    res.write(`data: ${JSON.stringify(event.data)}\n\n`)
  }

  try {
    await runAgent({
      messages: body.messages,
      llm,
      session: {
        targetUrl: body.session?.targetUrl || undefined,
        headless: body.session?.headless,
        maxSteps: body.session?.maxSteps,
      },
      signal: abortController.signal,
      onEvent: (event) => writeEvent(event),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeEvent({ type: 'error', data: { message } })
    writeEvent({ type: 'done', data: {} })
  } finally {
    res.end()
  }
})
