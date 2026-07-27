import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { config } from '../config.js'
import { analyzeRequirementDocument, streamAnalyzeRequirementDocument } from '../requirements/analyze.js'
import { extractRequirementText } from '../requirements/extractText.js'
import { generateTestCasesFromFeatures, streamGenerateTestCasesFromFeatures } from '../requirements/generateTestCases.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 1,
  },
})

const llmSchema = z
  .object({
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
  })
  .optional()

const sessionSchema = z
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
  .optional()

function resolveSession(bodySession?: z.infer<typeof sessionSchema>) {
  if (!bodySession) return undefined
  const targetUrl = bodySession.targetUrl?.trim() || undefined
  const cdpEndpoint = bodySession.cdpEndpoint?.trim() || undefined
  const attachUrlIncludes = bodySession.attachUrlIncludes?.trim() || targetUrl || undefined
  return {
    targetUrl,
    headless: bodySession.headless,
    maxSteps: bodySession.maxSteps,
    browserMode: bodySession.browserMode,
    cdpEndpoint,
    attachUrlIncludes,
    waitForLogin: bodySession.waitForLogin,
    loginWaitSeconds: bodySession.loginWaitSeconds,
  }
}

function resolveLlm(bodyLlm?: { baseUrl?: string; apiKey?: string; model?: string }) {
  return {
    baseUrl: bodyLlm?.baseUrl || config.defaultLlm.baseUrl,
    apiKey: bodyLlm?.apiKey || config.defaultLlm.apiKey,
    model: bodyLlm?.model || config.defaultLlm.model,
  }
}

function parseMaybeJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      return undefined
    }
  }
  return undefined
}


function beginSse(res: import('express').Response) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const abortController = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) abortController.abort()
  })

  const writeEvent = (event: { type: string; data: unknown }) => {
    if (res.writableEnded) return
    res.write(`event: ${event.type}\n`)
    res.write(`data: ${JSON.stringify(event.data)}\n\n`)
  }

  return { abortController, writeEvent }
}

export const requirementsRouter = Router()

requirementsRouter.post('/requirements/analyze', upload.single('file'), async (req, res) => {
  try {
    const bodyLlm = parseMaybeJsonObject(req.body?.llm)
    const llmParsed = llmSchema.safeParse(bodyLlm)
    if (!llmParsed.success) {
      res.status(400).json({ error: 'llm 参数无效', details: llmParsed.error.flatten() })
      return
    }

    const llm = resolveLlm(llmParsed.data)
    const pastedContent = typeof req.body?.content === 'string' ? req.body.content : ''
    const fileNameFromBody = typeof req.body?.fileName === 'string' ? req.body.fileName : ''
    let content = pastedContent.trim()
    let fileName = fileNameFromBody.trim() || 'pasted-requirement.md'
    let source: 'file' | 'text' = 'text'

    if (req.file && !content) {
      const extracted = await extractRequirementText({
        buffer: req.file.buffer,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
      })
      content = extracted.text
      fileName = req.file.originalname
      source = 'file'
    } else if (req.file && content) {
      // Prefer user-edited text, but keep original filename for context.
      fileName = req.file.originalname || fileName
      source = 'text'
    }

    if (!content) {
      res.status(400).json({ error: '请上传需求文档，或粘贴需求文本' })
      return
    }

    const result = await analyzeRequirementDocument({
      llm,
      content,
      fileName,
    })

    res.json({
      ok: true,
      source,
      fileName,
      contentLength: content.length,
      ...result,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ ok: false, error: message })
  }
})

requirementsRouter.post('/requirements/extract', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: '请上传文件' })
      return
    }
    const extracted = await extractRequirementText({
      buffer: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
    })
    res.json({
      ok: true,
      fileName: req.file.originalname,
      kind: extracted.kind,
      content: extracted.text,
      contentLength: extracted.text.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ ok: false, error: message })
  }
})

requirementsRouter.post('/requirements/test-cases', async (req, res) => {
  try {
    const bodyLlm = parseMaybeJsonObject(req.body?.llm) || (typeof req.body?.llm === 'object' ? req.body.llm : undefined)
    const llmParsed = llmSchema.safeParse(bodyLlm)
    if (!llmParsed.success) {
      res.status(400).json({ error: 'llm 参数无效', details: llmParsed.error.flatten() })
      return
    }

    const llm = resolveLlm(llmParsed.data)
    const sessionParsed = sessionSchema.safeParse(req.body?.session)
    if (!sessionParsed.success) {
      res.status(400).json({ error: 'session 参数无效', details: sessionParsed.error.flatten() })
      return
    }
    const title = typeof req.body?.title === 'string' ? req.body.title : ''
    const summary = typeof req.body?.summary === 'string' ? req.body.summary : ''
    const root = req.body?.root
    const features = Array.isArray(req.body?.features) ? req.body.features : undefined

    if (!root && (!features || features.length === 0)) {
      res.status(400).json({ error: '请先提供功能点树 root 或 features 列表' })
      return
    }

    const result = await generateTestCasesFromFeatures({
      llm,
      title,
      summary,
      root,
      features,
      session: resolveSession(sessionParsed.data),
    })

    res.json({
      ok: true,
      ...result,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ ok: false, error: message })
  }
})


requirementsRouter.post('/requirements/analyze/stream', upload.single('file'), async (req, res) => {
  const { abortController, writeEvent } = beginSse(res)
  try {
    const bodyLlm = parseMaybeJsonObject(req.body?.llm)
    const llmParsed = llmSchema.safeParse(bodyLlm)
    if (!llmParsed.success) {
      writeEvent({ type: 'error', data: { message: 'llm 参数无效' } })
      writeEvent({ type: 'done', data: {} })
      res.end()
      return
    }

    const llm = resolveLlm(llmParsed.data)
    const pastedContent = typeof req.body?.content === 'string' ? req.body.content : ''
    const fileNameFromBody = typeof req.body?.fileName === 'string' ? req.body.fileName : ''
    let content = pastedContent.trim()
    let fileName = fileNameFromBody.trim() || 'pasted-requirement.md'
    let source: 'file' | 'text' = 'text'

    if (req.file && !content) {
      writeEvent({ type: 'status', data: { message: '正在解析上传的需求文档...' } })
      const extracted = await extractRequirementText({
        buffer: req.file.buffer,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
      })
      content = extracted.text
      fileName = req.file.originalname
      source = 'file'
    } else if (req.file && content) {
      fileName = req.file.originalname || fileName
      source = 'text'
    }

    if (!content) {
      writeEvent({ type: 'error', data: { message: '请上传需求文档，或粘贴需求文本' } })
      writeEvent({ type: 'done', data: {} })
      res.end()
      return
    }

    writeEvent({
      type: 'status',
      data: { message: `准备分析「${fileName}」（${content.length} 字）...` },
    })

    const result = await streamAnalyzeRequirementDocument({
      llm,
      content,
      fileName,
      signal: abortController.signal,
      onEvent: (event) => writeEvent(event),
    })

    // Ensure result payload also includes source metadata for the client.
    writeEvent({
      type: 'meta',
      data: {
        ok: true,
        source,
        fileName,
        contentLength: content.length,
        featureCount: result.featureCount,
      },
    })
  } catch (error) {
    if (abortController.signal.aborted || (error as Error)?.name === 'AbortError' || (error as Error)?.name === 'APIUserAbortError') {
      writeEvent({ type: 'status', data: { message: '已取消生成' } })
      writeEvent({ type: 'done', data: { cancelled: true } })
    } else {
      const message = error instanceof Error ? error.message : String(error)
      writeEvent({ type: 'error', data: { message } })
      writeEvent({ type: 'done', data: {} })
    }
  } finally {
    if (!res.writableEnded) res.end()
  }
})

requirementsRouter.post('/requirements/test-cases/stream', async (req, res) => {
  const { abortController, writeEvent } = beginSse(res)
  try {
    const bodyLlm = parseMaybeJsonObject(req.body?.llm) || (typeof req.body?.llm === 'object' ? req.body.llm : undefined)
    const llmParsed = llmSchema.safeParse(bodyLlm)
    if (!llmParsed.success) {
      writeEvent({ type: 'error', data: { message: 'llm 参数无效' } })
      writeEvent({ type: 'done', data: {} })
      res.end()
      return
    }

    const llm = resolveLlm(llmParsed.data)
    const sessionParsed = sessionSchema.safeParse(req.body?.session)
    if (!sessionParsed.success) {
      writeEvent({ type: 'error', data: { message: 'session 参数无效' } })
      writeEvent({ type: 'done', data: {} })
      res.end()
      return
    }
    const title = typeof req.body?.title === 'string' ? req.body.title : ''
    const summary = typeof req.body?.summary === 'string' ? req.body.summary : ''
    const root = req.body?.root
    const features = Array.isArray(req.body?.features) ? req.body.features : undefined

    if (!root && (!features || features.length === 0)) {
      writeEvent({ type: 'error', data: { message: '请先提供功能点树 root 或 features 列表' } })
      writeEvent({ type: 'done', data: {} })
      res.end()
      return
    }

    await streamGenerateTestCasesFromFeatures({
      llm,
      title,
      summary,
      root,
      features,
      session: resolveSession(sessionParsed.data),
      signal: abortController.signal,
      onEvent: (event) => writeEvent(event),
    })
  } catch (error) {
    if (abortController.signal.aborted || (error as Error)?.name === 'AbortError' || (error as Error)?.name === 'APIUserAbortError') {
      writeEvent({ type: 'status', data: { message: '已取消生成' } })
      writeEvent({ type: 'done', data: { cancelled: true } })
    } else {
      const message = error instanceof Error ? error.message : String(error)
      writeEvent({ type: 'error', data: { message } })
      writeEvent({ type: 'done', data: {} })
    }
  } finally {
    if (!res.writableEnded) res.end()
  }
})

