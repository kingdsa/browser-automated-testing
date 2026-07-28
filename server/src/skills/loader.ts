import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'

export interface SkillMeta {
  name: string
  description: string
  content: string
}

export interface CategorySkillMeta extends SkillMeta {
  /** File name relative to skills/<category>/ (e.g. "SKILL.md" or "custom-foo.md"). */
  fileName: string
  /** True for the built-in SKILL.md, which cannot be deleted. */
  isDefault: boolean
  /** True when currently selected (persisted in .selected.json). */
  selected: boolean
}

const DEFAULT_SKILL_FILE = 'SKILL.md'
const SELECTION_FILE = '.selected.json'
const VALID_CATEGORY = ['function-point', 'test-case', 'control-chrome'] as const
export type SkillCategory = (typeof VALID_CATEGORY)[number]

const ALLOWED_FILE_RE = /^(?!.*[\\/])(?!\.)(?:[A-Za-z0-9_\- ]+\/)*[A-Za-z0-9_\- ]+\.md$/i

function isCategory(value: string): value is SkillCategory {
  return (VALID_CATEGORY as readonly string[]).includes(value)
}

function categoryDir(category: string): string {
  return path.join(config.skillsDir, category)
}

function parseFrontmatter(raw: string): { name: string; description: string; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) {
    return { name: 'unnamed-skill', description: '', body: raw.trim() }
  }

  const front = match[1] ?? ''
  const body = (match[2] ?? '').trim()
  const nameMatch = front.match(/^name:\s*["']?(.+?)["']?\s*$/m)
  const descMatch = front.match(/^description:\s*["']?(.+?)["']?\s*$/m)

  return {
    name: nameMatch?.[1]?.trim() || 'unnamed-skill',
    description: descMatch?.[1]?.trim() || '',
    body,
  }
}

export async function loadSkills(): Promise<SkillMeta[]> {
  const skills: SkillMeta[] = []

  let entries: string[] = []
  try {
    entries = await fs.readdir(config.skillsDir)
  } catch {
    return skills
  }

  for (const entry of entries) {
    const skillPath = path.join(config.skillsDir, entry, DEFAULT_SKILL_FILE)
    try {
      const raw = await fs.readFile(skillPath, 'utf8')
      const parsed = parseFrontmatter(raw)
      skills.push({
        name: parsed.name || entry,
        description: parsed.description,
        content: parsed.body,
      })
    } catch {
      // ignore broken skill folders
    }
  }

  return skills
}

export function buildSystemPrompt(skills: SkillMeta[], targetUrl?: string): string {
  const skillBlocks = skills
    .map(
      (skill) =>
        `### Skill: ${skill.name}\n${skill.description ? `Description: ${skill.description}\n` : ''}${skill.content}`,
    )
    .join('\n\n')

  return [
    '你是一名资深前端自动化测试工程师 Agent。',
    '你的目标是像真实测试人员一样操作浏览器，发现页面问题并给出可执行的结论。',
    '',
    '## 能力与约束',
    '- 你只能通过提供的浏览器工具观察和操作页面，不要假装你已经看到页面。',
    '- 每一步先观察（snapshot / network / console / screenshot），再决定操作。',
    '- 关注布局、可用性、交互、接口错误、控制台报错、明显性能问题。',
    '- 发现问题时要记录：现象、定位证据、严重级别（critical/major/minor）、建议。',
    '- 不要无限点点点；优先覆盖核心路径，达到足够证据后及时汇总。',
    '- 对破坏性操作（提交订单、删除、支付）要谨慎，默认只做只读验证，除非用户明确要求。',
    '- 输出使用中文。过程分析与最终报告必须分开：工具调用之间只写简短测试意图/观察，不要写成完整报告。',
    '- 全部测试结束后，再单独输出一份完整、可直接保存的 Markdown 最终报告（作为最后一次无工具调用的回复主体）。',
    '- 用户只会保存最终 Markdown 报告，不会保存过程分析；因此最终报告必须自包含、可单独阅读。',
    '- Markdown 报告建议包含：测试目标、覆盖范围、问题列表（级别/现象/证据/建议）、结论与风险。',
    '- 若用户消息附带【测试用例附件】或明确给出用例清单：必须按用例逐条执行（优先级 P0>P1>P2>P3），不要只做自由探索。',
    '- 有测试用例时，最终 Markdown 报告必须包含「用例执行对照表」：用例 ID / 标题 / 结果(通过|失败|阻塞) / 证据 / 备注。',
    '- 无法执行某条用例时标记为阻塞并说明原因（登录、权限、环境、缺数据等），禁止编造通过结果。',
    '- 若目标 URL / 用例明确是登录页或登录功能：把登录页本身当作被测对象，直接测 UI、校验、交互、错误提示与相关接口；不要停下来要求用户输入账号密码。',
    '- 只有用户消息或测试用例附件已提供可用账号密码，且用例要求登录成功时，才填写真实凭据并尝试登录。',
    '- 缺少账号密码时：把“登录成功”类步骤标为阻塞，同时继续完成不依赖真实凭据的检查；禁止反复追问、空等或假装已登录。',
    '- 仅当目标是登录后的业务功能，且当前停在登录页、又未提供凭据时，才将依赖登录的部分标为阻塞。',
    '',
    targetUrl ? `## 本次目标 URL\n${targetUrl}` : '## 本次目标 URL\n由用户消息指定',
    '',
    '## 可用 Skills（行为准则）',
    skillBlocks || '（暂无额外 skill）',
    '',
    '## 工作流建议',
    '1. open_url / navigate 打开目标页',
    '2. get_page_snapshot 获取可交互元素与结构',
    '3. get_network_logs / get_console_logs 检查接口与错误',
    '4. 按测试路径 click / type / scroll / wait',
    '5. take_screenshot 记录关键证据',
    '6. 输出完整 Markdown 最终报告（最后一次回复只写报告，不要夹杂过程碎语）',
  ].join('\n')
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function readSelectionFile(category: string): Promise<string[] | null> {
  const file = path.join(categoryDir(category), SELECTION_FILE)
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return parsed as string[]
    }
    return null
  } catch {
    return null
  }
}

async function writeSelectionFile(category: string, fileNames: string[]): Promise<void> {
  const dir = categoryDir(category)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, SELECTION_FILE)
  await fs.writeFile(file, JSON.stringify(fileNames, null, 2), 'utf8')
}

/** Reads all `.md` files (excluding `.`-prefixed files) in skills/<category>/. */
export async function loadCategorySkills(category: string): Promise<CategorySkillMeta[]> {
  if (!isCategory(category)) return []
  const dir = categoryDir(category)

  let entries: string[] = []
  try {
    entries = await fs.readdir(dir)
  } catch {
    // directory does not exist yet; report nothing
    return []
  }

  const mdFiles = entries.filter((entry) => entry.toLowerCase().endsWith('.md'))
  const savedSelection = (await readSelectionFile(category)) ?? null

  const skills: CategorySkillMeta[] = []
  for (const fileName of mdFiles.sort()) {
    const fullPath = path.join(dir, fileName)
    try {
      const raw = await fs.readFile(fullPath, 'utf8')
      const parsed = parseFrontmatter(raw)
      const isDefault = fileName === DEFAULT_SKILL_FILE
      const selected = savedSelection
        ? savedSelection.includes(fileName)
        : isDefault
      skills.push({
        name: parsed.name || fileName.replace(/\.md$/i, ''),
        description: parsed.description,
        content: parsed.body,
        fileName,
        isDefault,
        selected,
      })
    } catch {
      // skip unreadable file
    }
  }

  return skills
}

/** Returns only the selected skills; if none selected, falls back to the default SKILL.md. */
export async function loadSelectedCategorySkills(
  category: string,
): Promise<CategorySkillMeta[]> {
  const all = await loadCategorySkills(category)
  const selected = all.filter((skill) => skill.selected)
  if (selected.length > 0) return selected
  const fallback = all.find((skill) => skill.isDefault)
  return fallback ? [fallback] : []
}

/** Updates the persisted selection list. Validates that each fileName exists in the category dir. */
export async function selectCategorySkills(
  category: string,
  fileNames: string[],
): Promise<CategorySkillMeta[]> {
  if (!isCategory(category)) {
    throw new Error(`未知的 skill 类别：${category}`)
  }
  const all = await loadCategorySkills(category)
  const known = new Set(all.map((skill) => skill.fileName))
  const sanitized = Array.from(new Set(fileNames)).filter((name) => known.has(name))
  await writeSelectionFile(category, sanitized)
  return loadCategorySkills(category)
}

/** Saves a new custom skill file. Returns the file name actually written. */
export async function saveSkill(
  category: string,
  fileName: string,
  content: string,
): Promise<{ fileName: string; fullPath: string }> {
  if (!isCategory(category)) {
    throw new Error(`未知的 skill 类别：${category}`)
  }
  const trimmed = (fileName || '').trim()
  if (!trimmed) throw new Error('文件名不能为空')
  if (!/\.md$/i.test(trimmed)) throw new Error('Skill 文件必须以 .md 结尾')
  if (!ALLOWED_FILE_RE.test(trimmed)) throw new Error('文件名仅允许字母、数字、空格、下划线、连字符')
  if (trimmed === DEFAULT_SKILL_FILE) {
    throw new Error('不能覆盖默认 SKILL.md，请改用其他文件名')
  }

  const dir = categoryDir(category)
  await fs.mkdir(dir, { recursive: true })
  const fullPath = path.join(dir, trimmed)
  if (await pathExists(fullPath)) {
    throw new Error(`同名文件已存在：${trimmed}`)
  }
  await fs.writeFile(fullPath, content, 'utf8')
  return { fileName: trimmed, fullPath }
}

/** Deletes a custom skill file. Default SKILL.md cannot be deleted. */
export async function deleteSkill(category: string, fileName: string): Promise<void> {
  if (!isCategory(category)) {
    throw new Error(`未知的 skill 类别：${category}`)
  }
  const trimmed = (fileName || '').trim()
  if (!trimmed) throw new Error('文件名不能为空')
  if (trimmed === DEFAULT_SKILL_FILE) {
    throw new Error('默认 SKILL.md 不能删除')
  }
  if (!ALLOWED_FILE_RE.test(trimmed)) throw new Error('文件名不合法')

  const fullPath = path.join(categoryDir(category), trimmed)
  // Resolve and ensure the resolved path stays inside the category directory.
  const dir = categoryDir(category)
  const resolved = path.resolve(fullPath)
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
    throw new Error('文件路径越界')
  }
  await fs.unlink(fullPath)

  // Clean up stale entries in .selected.json so persisted state stays tidy.
  const savedSelection = await readSelectionFile(category)
  if (savedSelection && savedSelection.includes(trimmed)) {
    await writeSelectionFile(
      category,
      savedSelection.filter((name) => name !== trimmed),
    )
  }
}

/** Composes the system prompt for a category by concatenating selected skill bodies. */
export function composeCategorySystemPrompt(skills: CategorySkillMeta[]): string {
  return skills
    .map((skill) => {
      const header = `### Skill: ${skill.name}\n${skill.description ? `Description: ${skill.description}\n` : ''}`
      return `${header}${skill.content}`
    })
    .join('\n\n')
}

/** Re-exports the static list so callers can validate input without importing types. */
export function isSkillCategory(value: unknown): value is SkillCategory {
  return typeof value === 'string' && isCategory(value)
}
