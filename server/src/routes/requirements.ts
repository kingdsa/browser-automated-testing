import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { config } from '../config.js'
import { analyzeRequirementDocument } from '../requirements/analyze.js'
import { extractRequirementText } from '../requirements/extractText.js'
import { generateTestCasesFromFeatures } from '../requirements/generateTestCases.js'

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

