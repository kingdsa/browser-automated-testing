import OpenAI from 'openai'
import { z } from 'zod'
import type { LlmSettings, SessionConfig } from '../types/index.js'
import {
  explorePageForTestCases,
  shouldExploreWithBrowser,
  type PageExplorationResult,
} from './exploreForTestCases.js'
import {
  buildConcreteSteps,
  extractVerifiedPaths,
  normalizeCases as normalizeCasesGeneric,
  type FeaturePoint as FeaturePointLite,
} from './stepBuilder.js'
import {
  composeCategorySystemPrompt,
  loadSelectedCategorySkills,
  type CategorySkillMeta,
} from '../skills/loader.js'

export interface MindMapNodeData {
  text: string
  note?: string
  tag?: string[]
  expand?: boolean
}

export interface MindMapNode {
  data: MindMapNodeData
  children?: MindMapNode[]
}

export interface FeaturePoint {
  path: string
  text: string
  note?: string
  tags?: string[]
}

export type TestCasePriority = 'P0' | 'P1' | 'P2' | 'P3'

export interface TestCase {
  id: string
  feature: string
  featurePath: string
  title: string
  priority: TestCasePriority
  type: string
  preconditions: string
  steps: string[]
  expected: string
  note?: string
}

export interface GenerateTestCasesResult {
  title: string
  summary: string
  cases: TestCase[]
  caseCount: number
  groundedInPage?: boolean
  explorationNotes?: string
  visitedUrls?: string[]
}

export type TestCaseStreamEvent =
  | { type: 'status'; data: { message: string } }
  | { type: 'delta'; data: { content: string } }
  | { type: 'tool_start'; data: { id: string; name: string; arguments: string } }
  | {
      type: 'tool_result'
      data: {
        id?: string
        name: string
        result: {
          ok: boolean
          summary: string
          data?: unknown
          screenshotBase64?: string
        }
      }
    }
  | { type: 'result'; data: GenerateTestCasesResult }
  | { type: 'skills'; data: { skills: CategorySkillMeta[] } }
  | { type: 'error'; data: { message: string } }
  | { type: 'done'; data: Record<string, never> }

const prioritySchema = z.enum(['P0', 'P1', 'P2', 'P3'])

const testCaseSchema = z.object({
  id: z.string().optional(),
  feature: z.string().min(1),
  featurePath: z.string().optional(),
  title: z.string().min(1),
  priority: prioritySchema.optional().default('P1'),
  type: z.string().optional().default('功能'),
  preconditions: z.string().optional().default(''),
  steps: z.array(z.string()).min(1),
  expected: z.string().min(1),
  note: z.string().optional(),
})

const responseSchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional().default(''),
  cases: z.array(testCaseSchema).min(1),
})

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return trimmed
  if (trimmed.endsWith('/v1')) return trimmed
  if (/\/v\d+$/.test(trimmed)) return trimmed
  return `${trimmed}/v1`
}

function stripCodeFence(content: string): string {
  const trimmed = content.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return (fenced?.[1] || trimmed).trim()
}

function flattenFeatures(node: MindMapNode | null | undefined, path: string[] = [], acc: FeaturePoint[] = []): FeaturePoint[] {
  if (!node) return acc
  const nextPath = [...path, String(node.data?.text || '').trim() || '未命名功能']
  if (path.length > 0) {
    acc.push({
      path: nextPath.join(' / '),
      text: nextPath[nextPath.length - 1] || '未命名功能',
      note: node.data?.note,
      tags: Array.isArray(node.data?.tag) ? node.data.tag : undefined,
    })
  }
  for (const child of node.children || []) {
    flattenFeatures(child, nextPath, acc)
  }
  return acc
}

function makeCaseId(index: number): string {
  return `TC-${String(index + 1).padStart(3, '0')}`
}

function normalizeCases(
  cases: Array<z.infer<typeof testCaseSchema>>,
  features: FeaturePoint[],
  exploration?: PageExplorationResult | null,
): TestCase[] {
  const lite = normalizeCasesGeneric(
    cases.map((item) => ({ ...item, priority: item.priority })),
    features as FeaturePointLite[],
    exploration
      ? {
          notes: exploration.notes,
          targetUrl: exploration.targetUrl,
          visitedUrls: exploration.visitedUrls,
        }
      : null,
  )
  return lite.map((item, index) => {
    const matched = features.find((feature) => feature.text === item.feature)
    const featurePath = item.featurePath || matched?.path || item.feature
    return {
      id: item.id || makeCaseId(index),
      feature: item.feature,
      featurePath,
      title: item.title,
      priority: (item.priority as TestCasePriority) || 'P1',
      type: item.type || '功能',
      preconditions: item.preconditions || '',
      steps: item.steps,
      expected: item.expected,
      ...(item.note ? { note: item.note } : {}),
    }
  })
}

function fallbackCases(title: string, features: FeaturePoint[], exploration?: PageExplorationResult | null): GenerateTestCasesResult {
  const pageHint = exploration?.targetUrl || exploration?.visitedUrls?.[0]
  const cases: TestCase[] = features.flatMap((feature, index) => {
    const baseId = makeCaseId(index * 2)
    const baseIdAlt = makeCaseId(index * 2 + 1)
    const priority = (feature.tags || []).find((tag) => /^P[0-3]$/i.test(tag))?.toUpperCase() as TestCasePriority | undefined
    const main: TestCase = {
      id: baseId,
      feature: feature.text,
      featurePath: feature.path,
      title: `${feature.text} - 正常流程`,
      priority: priority || 'P1',
      type: '功能',
      preconditions: feature.note || (pageHint ? `系统可用；可访问 ${pageHint}` : '系统可用，用户已具备相应权限'),
      steps: buildConcreteSteps(feature, { pageHint, exploration, kind: 'main' }),
      expected: `「${feature.text}」按预期完成，界面反馈正确，数据一致`,
      ...(feature.note ? { note: feature.note } : {}),
    }
    const negative: TestCase = {
      id: baseIdAlt,
      feature: feature.text,
      featurePath: feature.path,
      title: `${feature.text} - 异常/边界`,
      priority: priority || 'P2',
      type: '异常',
      preconditions: feature.note || '系统可用',
      steps: buildConcreteSteps(feature, { pageHint, exploration, kind: 'negative' }),
      expected: '系统给出明确错误提示，不产生脏数据，不崩溃',
    }
    return [main, negative]
  })

  return {
    title: `${title}测试用例`,
    summary: `基于 ${features.length} 个功能点自动生成基础测试用例（模型不可用时的降级结果）`,
    cases,
    caseCount: cases.length,
    groundedInPage: Boolean(exploration),
    ...(exploration
      ? {
          explorationNotes: exploration.notes.slice(0, 4000),
          visitedUrls: exploration.visitedUrls,
        }
      : {}),
  }
}

const JSON_OUTPUT_CONSTRAINT = `

---

## 输出格式（强制约束，覆盖以上任何文本/模板格式要求）

最终必须只输出一段合法 JSON（不要 markdown 代码块，不要任何额外解释文字）。

JSON 结构必须是：
{
  "title": "测试用例集标题",
  "summary": "一句话说明覆盖范围",
  "cases": [
    {
      "id": "TC-001",
      "feature": "删除用户",
      "featurePath": "用户管理 / 删除用户",
      "title": "删除用户 - 正常流程",
      "priority": "P0",
      "type": "功能",
      "preconditions": "已登录后台；用户列表中至少有 1 条可删除用户",
      "steps": [
        "选择左侧菜单「用户管理」",
        "在用户列表中勾选一条目标用户",
        "点击右上角「删除」按钮",
        "在确认弹窗中点击「确定」",
        "查看列表中该用户是否已删除，并确认成功提示"
      ],
      "expected": "目标用户从列表消失，页面出现删除成功提示，无报错",
      "note": "步骤必须精确到菜单、对象、按钮与确认动作"
    }
  ]
}

约束：
- steps 必须是“可照着点页面”的原子操作序列，每一步只做一件事。
- 可点击元素用「」标注，菜单层级用 -- 连接。
- 严禁空泛步骤（如“相关入口”、“主流程”、“相应操作”）。
- 每条主流程用例至少 4 步；异常/边界至少 3 步。
- 不要写 CSS selector、XPath、Playwright 代码；这是给人执行/审阅的业务步骤。
- expected 要可验证，不要只写“功能正常”。
- priority 优先参考功能点 tags；没有则按业务重要性判断。
- 总数建议控制在 __CASE_COUNT__ 条左右，不要滥造。
- feature / featurePath 必须能对应到输入功能点。
__GROUNDING_RULES__`

function buildGroundingRules(exploration: PageExplorationResult | null): string {
  return exploration
    ? `
- 用例 steps 必须基于探索笔记中真实出现的页面路径、按钮/链接文案、表单字段与反馈。
- 禁止编造页面上不存在的入口、菜单、路由、按钮文案。
- 功能点是覆盖范围：优先为探索到的相关路径写可执行步骤；若某功能点在页面未找到入口，steps 写“尝试定位/确认缺失”，并在 note 标明“页面未找到对应入口”，不要虚构成功路径。
- expected 尽量对应探索中观察到的真实反馈文案/状态；未知时写可验证的业务结果。
- preconditions 应反映真实前提（是否需登录、是否需特定数据、是否从某 URL 进入）。`
    : `
- 每个功能点至少 1 条主流程用例；关键功能补充 1 条异常/边界用例。
- 用例要具体、可执行，避免空泛描述。`
}

function buildJsonUserPrompt(input: {
  title: string
  summary?: string
  features: FeaturePoint[]
  exploration?: PageExplorationResult | null
}): string {
  const featureJson = JSON.stringify(input.features.slice(0, 80), null, 2)
  const exploration = input.exploration
  const verifiedPaths = extractVerifiedPaths(exploration?.notes)
  const verifiedPathBlock = verifiedPaths.length
    ? `已从探索笔记提取的可执行路径（生成 steps 时优先复用/微调）：
${verifiedPaths
  .slice(0, 8)
  .map((path, index) => `路径${index + 1}:\n${path.map((step, stepIndex) => `  ${stepIndex + 1}. ${step}`).join('\n')}`)
  .join('\n')}`
    : ''

  const explorationBlock = exploration
    ? `
【真实页面探索笔记】（最高优先级事实来源）
目标 URL：${exploration.targetUrl || exploration.visitedUrls[0] || '未知'}
访问过的 URL：${exploration.visitedUrls.join(' | ') || '未记录'}
探索步数：${exploration.stepCount}

${exploration.notes.slice(0, 12000)}

${verifiedPathBlock}

工具观察摘要（节选）：
${exploration.toolSummaries.slice(-40).map((item) => `- ${item}`).join('\n') || '- 无'}
`
    : ''

  return `需求标题：${input.title || '未命名需求'}
需求摘要：${input.summary || '无'}
${explorationBlock}
功能点列表 JSON：
${featureJson}`
}

function createAbortError(message = '已取消生成') {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true
  if (!error || typeof error !== 'object') return false
  const name = String((error as { name?: string }).name || '')
  const message = String((error as { message?: string }).message || '')
  return (
    name === 'AbortError' ||
    name === 'APIUserAbortError' ||
    /aborted|abort|cancel/i.test(message)
  )
}

function createClient(llm: LlmSettings) {
  return new OpenAI({
    apiKey: llm.apiKey,
    baseURL: normalizeBaseUrl(llm.baseUrl),
    defaultHeaders: {
      'User-Agent': 'browser-automated-testing/0.1',
      'X-Stainless-Lang': null,
      'X-Stainless-Package-Version': null,
      'X-Stainless-OS': null,
      'X-Stainless-Arch': null,
      'X-Stainless-Runtime': null,
      'X-Stainless-Runtime-Version': null,
      'X-Stainless-Retry-Count': null,
    },
  })
}

function assertLlmReady(llm: LlmSettings) {
  if (!llm.apiKey?.trim()) throw new Error('请先配置 API Key')
  if (!llm.baseUrl?.trim()) throw new Error('请先配置 Base URL')
  if (!llm.model?.trim()) throw new Error('请先配置模型名称')
}

function parseTestCaseResult(
  raw: string,
  title: string,
  features: FeaturePoint[],
  exploration?: PageExplorationResult | null,
): GenerateTestCasesResult {
  if (!raw.trim()) throw new Error('模型未返回测试用例')

  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(raw))
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('模型返回非 JSON')
    parsed = JSON.parse(match[0])
  }

  const validated = responseSchema.safeParse(parsed)
  if (!validated.success) throw new Error('模型返回结构不完整')

  const cases = normalizeCases(validated.data.cases, features, exploration)
  const grounded = Boolean(exploration)
  return {
    title: validated.data.title.trim() || `${title}测试用例`,
    summary:
      validated.data.summary.trim() ||
      (grounded
        ? `基于真实页面探索覆盖 ${features.length} 个功能点，共 ${cases.length} 条用例`
        : `覆盖 ${features.length} 个功能点，共 ${cases.length} 条用例`),
    cases,
    caseCount: cases.length,
    groundedInPage: grounded,
    ...(exploration
      ? {
          explorationNotes: exploration.notes.slice(0, 4000),
          visitedUrls: exploration.visitedUrls,
        }
      : {}),
  }
}

async function composeTestCaseSystemPrompt(
  features: FeaturePoint[],
  exploration: PageExplorationResult | null,
): Promise<{ systemPrompt: string; skills: CategorySkillMeta[] }> {
  const testCaseSkills = await loadSelectedCategorySkills('test-case')
  const skills: CategorySkillMeta[] = [...testCaseSkills]

  if (exploration) {
    const controlChromeSkills = await loadSelectedCategorySkills('control-chrome')
    skills.push(...controlChromeSkills)
  }

  const skillBody = composeCategorySystemPrompt(skills)
  const caseCount = features.length
  const groundingRules = buildGroundingRules(exploration)
  const constraint = JSON_OUTPUT_CONSTRAINT.replace(/__CASE_COUNT__/g, String(Math.min(Math.max(8, caseCount), 40)))
    .replace(/__GROUNDING_RULES__/g, groundingRules)

  const systemPrompt = skillBody ? `${skillBody}${constraint}` : constraint.trim()
  return { systemPrompt, skills }
}

export async function generateTestCasesFromFeatures(input: {
  llm: LlmSettings
  title?: string
  summary?: string
  root?: MindMapNode | null
  features?: FeaturePoint[]
  session?: SessionConfig
}): Promise<GenerateTestCasesResult> {
  return streamGenerateTestCasesFromFeatures({
    ...input,
    onEvent: () => undefined,
  })
}

export async function streamGenerateTestCasesFromFeatures(input: {
  llm: LlmSettings
  title?: string
  summary?: string
  root?: MindMapNode | null
  features?: FeaturePoint[]
  session?: SessionConfig
  signal?: AbortSignal
  onEvent?: (event: TestCaseStreamEvent) => void
}): Promise<GenerateTestCasesResult> {
  const { llm, signal } = input
  const emit = input.onEvent || (() => undefined)
  assertLlmReady(llm)
  if (signal?.aborted) throw createAbortError()

  const features =
    input.features && input.features.length
      ? input.features
      : flattenFeatures(input.root || null)

  if (!features.length) throw new Error('请先生成或导入功能点')

  const title = input.title?.trim() || '需求功能点'
  const summary = input.summary?.trim() || ''
  const client = createClient(llm)

  let exploration: PageExplorationResult | null = null

  if (shouldExploreWithBrowser(input.session)) {
    emit({
      type: 'status',
      data: {
        message: input.session?.targetUrl?.trim()
          ? `已指定目标 URL，将先通过 control-chrome 深度探索页面：${input.session.targetUrl}`
          : '将先附着当前浏览器标签，通过 control-chrome 深度探索页面…',
      },
    })
    try {
      exploration = await explorePageForTestCases({
        llm,
        title,
        summary,
        features,
        session: input.session,
        signal,
        onEvent: (event) => {
          if (event.type === 'status' || event.type === 'delta' || event.type === 'tool_start' || event.type === 'tool_result') {
            emit(event)
          } else if (event.type === 'error') {
            emit({ type: 'status', data: { message: `页面探索警告：${event.data.message}` } })
          }
        },
      })
      emit({
        type: 'status',
        data: {
          message: `页面探索完成（${exploration.stepCount} 步，访问 ${exploration.visitedUrls.length || 1} 个 URL），开始基于页面事实生成测试用例…`,
        },
      })
      emit({
        type: 'delta',
        data: {
          content: `\n\n---\n【阶段切换】页面探索结束，开始生成测试用例 JSON…\n---\n\n`,
        },
      })
    } catch (error) {
      if (isAbortError(error, signal)) throw createAbortError()
      const reason = error instanceof Error ? error.message : String(error)
      emit({
        type: 'status',
        data: { message: `页面探索失败，将回退为仅基于功能点生成：${reason}` },
      })
      exploration = null
    }
  } else {
    emit({ type: 'status', data: { message: `未指定目标页面，正在根据 ${features.length} 个功能点生成测试用例...` } })
  }

  const { systemPrompt, skills } = await composeTestCaseSystemPrompt(features, exploration)
  emit({ type: 'skills', data: { skills } })

  try {
    const stream = await client.chat.completions.create(
      {
        model: llm.model,
        temperature: 0.2,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: buildJsonUserPrompt({ title, summary, features, exploration }) },
        ],
      },
      { signal },
    )

    let raw = ''
    for await (const chunk of stream) {
      if (signal?.aborted) throw createAbortError()
      const delta = chunk.choices?.[0]?.delta?.content
      if (!delta) continue
      raw += delta
      emit({ type: 'delta', data: { content: delta } })
    }

    if (signal?.aborted) throw createAbortError()

    emit({ type: 'status', data: { message: '模型输出完成，正在解析测试用例...' } })
    const result = parseTestCaseResult(raw, title, features, exploration)
    emit({ type: 'result', data: result })
    emit({ type: 'done', data: {} })
    return result
  } catch (error) {
    if (isAbortError(error, signal)) {
      throw createAbortError()
    }
    const fallback = fallbackCases(title, features, exploration)
    const reason = error instanceof Error ? error.message : String(error)
    const result = {
      ...fallback,
      summary: `${fallback.summary}；原因：${reason}`,
    }
    emit({ type: 'status', data: { message: `模型结果不稳定，已使用降级用例：${reason}` } })
    emit({ type: 'result', data: result })
    emit({ type: 'done', data: {} })
    return result
  }
}
