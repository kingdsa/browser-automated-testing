import { Router } from 'express'
import { z } from 'zod'
import { runAgent } from '../agent/runner.js'
import { config } from '../config.js'
import { loadSkills } from '../skills/loader.js'
import { BrowserSession } from '../browser/session.js'
import { createJevClient } from '../jev/client.js'
import { screenPromptInjection } from '../jev/decisions.js'

const jevBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
  })
  .optional()

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
  jev: jevBodySchema,
  session: z
    .object({
      targetUrl: z.string().url().optional().or(z.literal('')),
      headless: z.boolean().optional(),
      maxSteps: z.number().int().min(0).max(1000).optional(),
      browserMode: z.enum(['auto', 'launch', 'attach']).optional(),
      cdpEndpoint: z.string().optional().or(z.literal('')),
      attachUrlIncludes: z.string().optional().or(z.literal('')),
      waitForLogin: z.boolean().optional(),
      loginWaitSeconds: z.number().int().min(10).max(900).optional(),
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
    jev: {
      baseUrl: config.defaultJev.baseUrl,
      model: config.defaultJev.model,
      hasApiKey: Boolean(config.defaultJev.apiKey),
    },
    session: {
      maxSteps: config.defaultMaxSteps,
      headless: config.defaultHeadless,
      browserMode: 'auto',
      waitForLogin: false,
      loginWaitSeconds: 180,
      cdpEndpoint: '',
      canUseHeadedBrowser: config.canUseHeadedBrowser,
    },
  })
})

chatRouter.get('/skills', async (_req, res) => {
  const skills = await loadSkills()
  res.json({
    skills: skills.map((s) => ({ name: s.name, description: s.description })),
  })
})

chatRouter.get('/browser/tabs', async (req, res) => {
  const endpoint = typeof req.query.endpoint === 'string' ? req.query.endpoint : undefined
  try {
    const [endpoints, tabs] = await Promise.all([
      BrowserSession.discoverCdpEndpoints(),
      BrowserSession.listCdpTabs(endpoint),
    ])
    res.json({
      ok: true,
      endpoints,
      tabs,
      hint:
        tabs.length > 0
          ? '已发现可附着标签。可直接开始测试，系统会优先使用已打开页面（含登录态）。'
          : '未发现可附着标签。可新开浏览器并勾选“等待手动登录”，或用远程调试方式启动 Chrome/Edge 后刷新。',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ ok: false, error: message, endpoints: [], tabs: [] })
  }
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
  const jev = {
    enabled: body.jev?.enabled,
    baseUrl: body.jev?.baseUrl || config.defaultJev.baseUrl,
    apiKey: body.jev?.apiKey || config.defaultJev.apiKey,
    model: body.jev?.model || config.defaultJev.model,
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
    let injectionFlagged = false
    try {
      const jevClient = createJevClient(jev, { signal: abortController.signal })
      if (jevClient.active) {
        const lastUser = [...body.messages].reverse().find((message) => message.role === 'user')
        if (lastUser?.content) {
          const screen = await screenPromptInjection(jevClient, lastUser.content)
          if (screen?.flagged) {
            injectionFlagged = true
            writeEvent({
              type: 'status',
              data: {
                message: `Jev 护栏：用户消息疑似提示注入（noul=${screen.noul.toFixed(2)}），已按被测数据处理`,
              },
            })
          }
        }
      }
    } catch {
      // guardrail is best-effort; never block the run on its failure
    }

    await runAgent({
      messages: body.messages,
      llm,
      jev,
      guardrails: { injectionFlagged },
      session: {
        targetUrl: body.session?.targetUrl || undefined,
        headless: body.session?.headless,
        maxSteps: body.session?.maxSteps,
        browserMode: body.session?.browserMode,
        cdpEndpoint: body.session?.cdpEndpoint || undefined,
        attachUrlIncludes: body.session?.attachUrlIncludes || undefined,
        waitForLogin: body.session?.waitForLogin,
        loginWaitSeconds: body.session?.loginWaitSeconds,
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
