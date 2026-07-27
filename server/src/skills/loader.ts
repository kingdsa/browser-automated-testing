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
