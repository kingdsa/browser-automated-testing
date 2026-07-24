import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'

export interface SkillMeta {
  name: string
  description: string
  content: string
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
    const skillPath = path.join(config.skillsDir, entry, 'SKILL.md')
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
    '- 输出使用中文，过程中可简要说明当前测试意图。',
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
    '6. 输出结构化测试报告',
  ].join('\n')
}
