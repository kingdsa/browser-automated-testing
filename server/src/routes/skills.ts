import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import {
  deleteSkill,
  isSkillCategory,
  loadCategorySkills,
  saveSkill,
  selectCategorySkills,
} from '../skills/loader.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 1,
  },
})

function badCategory(res: import('express').Response) {
  res.status(400).json({ ok: false, error: '未知的 skill 类别，仅支持 function-point / test-case / control-chrome' })
}

export const skillsRouter = Router()

skillsRouter.get('/skills/:category', async (req, res) => {
  const { category } = req.params
  if (!isSkillCategory(category)) {
    badCategory(res)
    return
  }
  try {
    const skills = await loadCategorySkills(category)
    res.json({ ok: true, category, skills })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ ok: false, error: message })
  }
})

skillsRouter.post('/skills/:category/select', async (req, res) => {
  const { category } = req.params
  if (!isSkillCategory(category)) {
    badCategory(res)
    return
  }
  const parsed = z
    .object({
      fileNames: z.array(z.string()).default([]),
    })
    .safeParse(req.body || {})
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'fileNames 参数无效', details: parsed.error.flatten() })
    return
  }
  try {
    const skills = await selectCategorySkills(category, parsed.data.fileNames)
    res.json({ ok: true, category, skills })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(400).json({ ok: false, error: message })
  }
})

skillsRouter.post('/skills/:category/upload', upload.single('file'), async (req, res) => {
  const { category } = req.params
  if (!isSkillCategory(category)) {
    badCategory(res)
    return
  }
  const explicitName = typeof req.body?.fileName === 'string' ? req.body.fileName.trim() : ''
  const file = req.file

  if (!file && !explicitName) {
    res.status(400).json({ ok: false, error: '请上传 skill 文件或提供文件名 + 内容' })
    return
  }

  let fileName = explicitName
  let content = ''
  if (file) {
    fileName = fileName || file.originalname
    content = file.buffer.toString('utf8')
  } else if (typeof req.body?.content === 'string') {
    content = req.body.content
  }

  if (!content.trim()) {
    res.status(400).json({ ok: false, error: 'skill 文件内容为空' })
    return
  }
  if (!fileName) {
    res.status(400).json({ ok: false, error: '缺少 skill 文件名' })
    return
  }

  try {
    const result = await saveSkill(category, fileName, content)
    const skills = await loadCategorySkills(category)
    res.json({ ok: true, category, fileName: result.fileName, skills })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(400).json({ ok: false, error: message })
  }
})

skillsRouter.delete('/skills/:category/:fileName', async (req, res) => {
  const { category, fileName } = req.params
  if (!isSkillCategory(category)) {
    badCategory(res)
    return
  }
  try {
    await deleteSkill(category, fileName)
    const skills = await loadCategorySkills(category)
    res.json({ ok: true, category, skills })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(400).json({ ok: false, error: message })
  }
})
