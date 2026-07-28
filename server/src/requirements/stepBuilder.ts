/**
 * 纯函数：测试用例步骤的规范化与精确化。
 *
 * 这里不引入 openai / playwright 等重依赖，方便单测。
 */

export type TestCasePriority = 'P0' | 'P1' | 'P2' | 'P3'

export interface FeaturePoint {
  path: string
  text: string
  note?: string
  tags?: string[]
}

export interface PageExplorationLite {
  notes?: string
  targetUrl?: string
  visitedUrls?: string[]
}

export interface TestCaseLite {
  id?: string
  feature: string
  featurePath?: string
  title: string
  priority?: TestCasePriority
  type?: string
  preconditions?: string
  steps: string[]
  expected: string
  note?: string
}

const VAGUE_STEP_PATTERNS = [
  /相关入口/,
  /相关页面/,
  /相关功能/,
  /相关操作/,
  /主流程操作/,
  /完成主流程/,
  /按照(?:页面实际路径|需求)完成/,
  /定位与「[^」]+」相关/,
  /执行与功能点相关的操作/,
  /进行相应操作/,
  /完成对应操作/,
  /按要求操作/,
  /进入.*入口$/,
  /完成.*操作$/,
  /检查.*结果$/,
]

export function isVagueStep(step: string): boolean {
  const text = step.trim()
  if (!text) return true
  return VAGUE_STEP_PATTERNS.some((pattern) => pattern.test(text))
}

export function splitCompoundStep(step: string): string[] {
  const text = step.trim()
  if (!text) return []
  // Keep short atomic steps as-is; only split clearly compound sequences.
  if (text.length < 18) return [text]
  const parts = text
    .split(/\s*(?:->|->|➜|=>|；|;|，然后|然后|接着|再|并点击|并选择)\s*/)
    .map((part) => part.replace(/^[、.。\d\s]+/, '').trim())
    .filter(Boolean)
  return parts.length > 1 ? parts : [text]
}

export function normalizeStepList(steps: string[]): string[] {
  const normalized = steps
    .flatMap((step) => splitCompoundStep(String(step)))
    .map((step) => step.replace(/^\d+[.)、\s]+/, '').trim())
    .filter(Boolean)
    .map((step) => step.slice(0, 300))

  const deduped: string[] = []
  for (const step of normalized) {
    if (!deduped.length || deduped[deduped.length - 1] !== step) deduped.push(step)
  }
  return deduped.slice(0, 24)
}

export function extractVerifiedPaths(notes?: string): string[][] {
  if (!notes?.trim()) return []
  const lines = notes.split(/\r?\n/)
  const paths: string[][] = []
  let current: string[] = []

  const flush = () => {
    if (current.length >= 2) paths.push(current)
    current = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^#{1,3}\s*已验证路径/.test(line) || (/^#{1,3}\s+/.test(line) && /已验证路径|关键路径|操作路径/.test(line))) {
      flush()
      continue
    }
    if (/^#{1,3}\s+/.test(line) && current.length) {
      flush()
      continue
    }

    const pathHeader = line.match(/^(?:[-*]\s*)?(?:路径\s*\d+|Path\s*\d+)[:：]\s*(.+)$/i)
    if (pathHeader) {
      flush()
      const rawTitle = pathHeader[1].trim()
      // "路径 1：删除用户" is a label; "路径 1：选择菜单 -> 点击删除" is an inline sequence.
      const looksLikeAction =
        /(?:->|->|➜|=>|；|;)/.test(rawTitle) ||
        /^(?:点击|选择|勾选|选中|打开|进入|填写|输入|切换|确认|查看|观察|校验|在)/.test(rawTitle)
      if (looksLikeAction) {
        const inline = normalizeStepList([rawTitle])
        if (inline.length >= 2) paths.push(inline)
        else if (inline.length === 1) current = inline
      } else {
        current = []
      }
      continue
    }

    const stepMatch = line.match(/^(?:[-*]\s*)?(?:\d+[.)、]|步骤\s*\d+[:：])\s*(.+)$/)
    if (stepMatch) {
      current.push(...normalizeStepList([stepMatch[1]]))
      continue
    }

    if (current.length && /^(?:点击|选择|勾选|选中|打开|进入|填写|输入|切换|确认|查看|观察|校验|在)/.test(line)) {
      current.push(...normalizeStepList([line.replace(/^[-*]\s*/, '')]))
    }
  }
  flush()
  return paths.slice(0, 20)
}

export function pickPathForFeature(feature: FeaturePoint, paths: string[][]): string[] | null {
  if (!paths.length) return null
  const tokens = [feature.text, ...feature.path.split(/\s*\/\s*/)]
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)

  let best: string[] | null = null
  let bestScore = 0
  for (const path of paths) {
    const joined = path.join(' ')
    const score = tokens.reduce((sum, token) => (joined.includes(token) ? sum + token.length : sum), 0)
    if (score > bestScore) {
      best = path
      bestScore = score
    }
  }
  return bestScore > 0 ? best : paths[0] || null
}

export function buildConcreteSteps(
  feature: FeaturePoint,
  options?: {
    pageHint?: string
    exploration?: PageExplorationLite | null
    kind?: 'main' | 'negative'
  },
): string[] {
  const kind = options?.kind || 'main'
  const pageHint = options?.pageHint
  const verified = extractVerifiedPaths(options?.exploration?.notes)
  const matchedPath = pickPathForFeature(feature, verified)

  if (matchedPath?.length) {
    if (kind === 'main') {
      const tail = matchedPath[matchedPath.length - 1] || ''
      const hasAssert = /^(?:查看|观察|校验|检查|验证|确认结果)/.test(tail)
      return hasAssert ? matchedPath : [...matchedPath, `查看「${feature.text}」对应的页面反馈与结果是否正确`]
    }
    return [
      ...matchedPath.slice(0, Math.max(matchedPath.length - 1, 1)),
      '输入非法、缺失或边界数据，或执行会触发校验的异常操作',
      '查看错误提示文案、表单高亮与系统状态，确认无脏数据',
    ]
  }

  if (kind === 'negative') {
    return [
      pageHint ? `打开目标页面 ${pageHint}` : '打开目标业务页面',
      `在导航/菜单中进入「${feature.text}」所在模块`,
      `打开「${feature.text}」对应的列表、表单或操作面板`,
      '输入非法、缺失或边界数据，或执行异常操作',
      '查看错误提示、禁用态或拦截反馈，确认系统不崩溃且无脏数据',
    ]
  }

  return [
    pageHint ? `打开目标页面 ${pageHint}` : '打开目标业务页面',
    `在左侧/顶部导航中选择「${feature.text}」所在菜单`,
    `在页面中选中一条与「${feature.text}」相关的数据，或进入其详情/编辑视图`,
    `点击页面中与「${feature.text}」对应的主操作按钮（如新增/编辑/删除/提交/保存）`,
    '若出现确认弹窗，点击「确定」或「确认」',
    `查看列表、详情或提示信息，确认「${feature.text}」结果符合预期`,
  ]
}

/**
 * 把模型返回的用例列表规范化：
 * - 拆分复合步骤、去掉步骤序号前缀；
 * - 识别“相关入口/主流程”等空泛步骤，用精确浏览器操作路径替换；
 * - 探索笔记中有「已验证路径」时优先复用。
 */
export function normalizeCases(
  cases: TestCaseLite[],
  features: FeaturePoint[],
  exploration?: PageExplorationLite | null,
): TestCaseLite[] {
  const featureByText = new Map(features.map((item) => [item.text, item]))
  const verifiedPaths = extractVerifiedPaths(exploration?.notes)

  return cases.map((item, index) => {
    const matched = featureByText.get(item.feature)
    const featurePath = item.featurePath?.trim() || matched?.path || item.feature
    let steps = normalizeStepList(item.steps)
    const vagueRatio = steps.length ? steps.filter(isVagueStep).length / steps.length : 1
    const tooFewSteps = steps.length < 3

    if (!steps.length || vagueRatio >= 0.4 || tooFewSteps) {
      const feature: FeaturePoint = matched || {
        path: featurePath,
        text: item.feature.trim() || featurePath,
        note: item.note,
      }
      const kind = /异常|边界|校验|失败|非法/.test(`${item.type || ''}${item.title || ''}`) ? 'negative' : 'main'
      const rebuilt = buildConcreteSteps(feature, {
        pageHint: exploration?.targetUrl || exploration?.visitedUrls?.[0],
        exploration,
        kind,
      })
      // Prefer model steps that are already concrete; only replace vague ones.
      if (!steps.length || vagueRatio >= 0.5) {
        steps = rebuilt
      } else {
        steps = steps.flatMap((step, stepIndex) => {
          if (!isVagueStep(step)) return [step]
          return rebuilt[Math.min(stepIndex, rebuilt.length - 1)] ? [rebuilt[Math.min(stepIndex, rebuilt.length - 1)]] : []
        })
        if (steps.length < 3) steps = rebuilt
      }
    }

    // If exploration has a better matched path and current steps are still thin, enrich from it.
    if (exploration && matched && steps.length < 4) {
      const path = pickPathForFeature(matched, verifiedPaths)
      if (path && path.length > steps.length) steps = normalizeStepList(path)
    }

    return {
      id: item.id?.trim() || `TC-${String(index + 1).padStart(3, '0')}`,
      feature: item.feature.trim(),
      featurePath,
      title: item.title.trim().slice(0, 120),
      priority: item.priority || 'P1',
      type: (item.type || '功能').trim().slice(0, 20) || '功能',
      preconditions: (item.preconditions || '').trim().slice(0, 500),
      steps: steps.length
        ? steps
        : buildConcreteSteps({ path: featurePath, text: item.feature.trim() || featurePath }),
      expected: item.expected.trim().slice(0, 500),
      ...(item.note?.trim() ? { note: item.note.trim().slice(0, 500) } : {}),
    }
  })
}
