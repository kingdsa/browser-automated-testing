import OpenAI from 'openai'
import { config } from '../config.js'
import { BrowserSession } from '../browser/session.js'
import { browserToolDefinitions, executeBrowserTool } from '../browser/tools.js'
import { loadSkills } from '../skills/loader.js'
import type {
  ChatMessage,
  LlmSettings,
  SessionConfig,
  ToolCall,
} from '../types/index.js'

interface FeaturePoint {
  path: string
  text: string
  note?: string
  tags?: string[]
}

export type ExploreStreamEvent =
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
  | { type: 'error'; data: { message: string } }

export interface PageExplorationResult {
  notes: string
  visitedUrls: string[]
  toolSummaries: string[]
  stepCount: number
  targetUrl?: string
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return trimmed
  if (trimmed.endsWith('/v1')) return trimmed
  if (/\/v\d+$/.test(trimmed)) return trimmed
  return `${trimmed}/v1`
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

function toOpenAiMessages(messages: ChatMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    if (msg.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: msg.tool_call_id || '',
        content: msg.content,
      }
    }
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      return {
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.tool_calls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: {
            name: call.function.name,
            arguments: call.function.arguments,
          },
        })),
      }
    }
    return {
      role: msg.role,
      content: msg.content,
    } as OpenAI.Chat.ChatCompletionMessageParam
  })
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

function buildExplorationSystemPrompt(targetUrl: string | undefined, skillMarkdown: string) {
  return [
    '你是资深测试探索员，负责在真实浏览器中深度探索页面，为后续测试用例生成提供“页面事实”。',
    '你通过 Playwright 工具控制浏览器，行为对齐 control-chrome skill。',
    '',
    '## 目标',
    '基于给定功能点清单，真实打开/附着目标页面，多轮探索核心路径，最终输出「页面探索笔记」。',
    '不要输出测试用例 JSON，不要输出 Markdown 测试报告。',
    '',
    '## 硬性约束',
    '1. 只能描述真实观察到的页面内容、入口、文案、交互与反馈；禁止编造不存在的按钮/菜单/路由。',
    '2. 功能点只是覆盖范围提示：优先探索与功能点相关的入口；找不到对应入口时明确写“未找到”。',
    '3. 步骤描述用业务语言（点击「xxx」、填写「yyy」），不要输出 CSS selector。',
    '4. 深度探索：不要只看首屏。应继续点击主导航、关键按钮、表单入口，覆盖多步路径。',
    '5. 默认不做支付、删除、提交订单等破坏性写操作；除非用户明确要求。',
    '6. 登录策略：',
    '   - 若系统已等待手动登录：基于登录后页面继续探索。',
    '   - 若目标本身是登录页：直接探索登录页 UI/校验/错误提示，不要空等账号。',
    '   - 若业务页停在登录页且无凭据：把依赖登录的路径标为阻塞，继续探索可见部分。',
    '',
    '## 推荐流程',
    '1. open_url / 使用系统已打开页面',
    '2. get_page_snapshot 了解结构与可交互元素',
    '3. 按功能点逐个尝试可达路径：click / type_text / scroll_page / wait_for',
    '4. 必要时 get_console_logs / get_network_logs / take_screenshot',
    '5. 信息足够后停止工具调用，输出完整探索笔记',
    '',
    '## 最终输出格式（纯文本）',
    '### 页面概况',
    '- 实际 URL / 标题 / 是否登录',
    '### 关键可交互入口',
    '- 按钮、链接、表单字段的可见文案',
    '### 已验证路径',
    '- 路径 1：步骤序列 + 页面反馈',
    '- 路径 2：...',
    '### 与功能点对应关系',
    '- 功能点 A：找到入口 / 未找到 / 阻塞原因',
    '### 校验与反馈',
    '- 成功/失败提示、空态、加载态等',
    '### 风险与阻塞',
    '- 登录、权限、环境问题',
    '',
    targetUrl ? `## 本次目标 URL\n${targetUrl}` : '## 本次目标 URL\n由当前已附着标签或用户消息指定',
    '',
    '## control-chrome 行为准则',
    skillMarkdown || '（无额外 skill 文本）',
  ].join('\n')
}

function buildExplorationUserPrompt(input: {
  title: string
  summary?: string
  features: FeaturePoint[]
  targetUrl?: string
}) {
  const featureLines = input.features
    .slice(0, 60)
    .map((item, index) => `${index + 1}. ${item.path}${item.note ? `（备注：${item.note}）` : ''}`)
    .join('\n')

  return [
    `需求标题：${input.title}`,
    `需求摘要：${input.summary || '无'}`,
    input.targetUrl ? `目标 URL：${input.targetUrl}` : '目标 URL：使用当前浏览器标签 / 系统已附着页面',
    '',
    '请围绕以下功能点做真实页面深度探索，并输出探索笔记：',
    featureLines || '（无功能点）',
    '',
    '注意：最终回复只写探索笔记，不要写测试用例。',
  ].join('\n')
}

function extractVisitedUrls(toolName: string, resultData: unknown, acc: Set<string>) {
  if (!resultData || typeof resultData !== 'object') return
  const data = resultData as Record<string, unknown>
  const candidates = [data.url, data.finalUrl, data.currentUrl, data.href]
  for (const value of candidates) {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) acc.add(value)
  }
  if (toolName === 'get_page_snapshot' && typeof data.title === 'string' && typeof data.url === 'string') {
    acc.add(data.url)
  }
}

/**
 * Deep page exploration for grounded test-case generation.
 * Uses the same browser stack / control-chrome skill as browser testing.
 */
export async function explorePageForTestCases(input: {
  llm: LlmSettings
  title?: string
  summary?: string
  features: FeaturePoint[]
  session?: SessionConfig
  signal?: AbortSignal
  onEvent?: (event: ExploreStreamEvent) => void
}): Promise<PageExplorationResult> {
  const { llm, features, session: sessionConfig, signal } = input
  const emit = input.onEvent || (() => undefined)
  const title = input.title?.trim() || '需求功能点'
  const summary = input.summary?.trim() || ''
  const targetUrl = sessionConfig?.targetUrl?.trim() || undefined

  if (signal?.aborted) throw createAbortError()

  const skills = await loadSkills()
  const controlChrome = skills.find((item) => item.name === 'control-chrome')
  const skillMarkdown = controlChrome?.content || skills.map((item) => item.content).join('\n\n')

  const configuredMaxSteps = sessionConfig?.maxSteps ?? config.defaultMaxSteps
  // Align with browser-test agent: 0 / unset means unlimited until the model finishes naturally.
  const unlimited = !configuredMaxSteps || configuredMaxSteps <= 0
  const maxSteps = unlimited ? Number.POSITIVE_INFINITY : configuredMaxSteps

  let browserMode = sessionConfig?.browserMode ?? 'auto'
  const waitForLogin = Boolean(sessionConfig?.waitForLogin)
  const requestedHeadless = sessionConfig?.headless ?? config.defaultHeadless
  const hasRemoteCdp = Boolean(sessionConfig?.cdpEndpoint?.trim())
  let headless = waitForLogin || browserMode === 'attach' ? false : requestedHeadless

  if (!headless && !config.canUseHeadedBrowser) {
    if (waitForLogin && !hasRemoteCdp) {
      throw new Error(
        '当前服务器没有图形界面，本地无法弹出登录窗口。请配置远程 cdpEndpoint，或关闭“等待手动登录”。',
      )
    }
    if (browserMode === 'attach' && !hasRemoteCdp) {
      throw new Error('当前服务器没有图形界面且未配置 cdpEndpoint，无法附着本地浏览器标签。')
    }
    if (waitForLogin && hasRemoteCdp) {
      browserMode = 'attach'
      headless = true
      emit({
        type: 'status',
        data: { message: '无图形界面：将通过远程 CDP 附着浏览器并等待手动登录。' },
      })
    } else if (browserMode !== 'attach') {
      headless = true
      emit({
        type: 'status',
        data: { message: '检测到无图形界面环境，已自动切换为无头模式启动 Chromium。' },
      })
    }
  }

  const client = createClient(llm)
  const browser = new BrowserSession({
    headless,
    mode: browserMode,
    cdpEndpoint: sessionConfig?.cdpEndpoint,
    attachUrlIncludes: sessionConfig?.attachUrlIncludes || targetUrl,
    waitForLogin,
    loginWaitSeconds: sessionConfig?.loginWaitSeconds,
  })

  const history: ChatMessage[] = [
    {
      role: 'system',
      content: buildExplorationSystemPrompt(targetUrl, skillMarkdown),
    },
    {
      role: 'user',
      content: buildExplorationUserPrompt({ title, summary, features, targetUrl }),
    },
  ]

  const visitedUrls = new Set<string>()
  const toolSummaries: string[] = []
  let stepCount = 0
  let finalNotes = ''

  try {
    emit({
      type: 'status',
      data: {
        message: targetUrl
          ? `正在用浏览器探索目标页以生成用例：${targetUrl}`
          : '正在附着当前浏览器标签并探索页面以生成用例…',
      },
    })

    if (browserMode === 'attach' || browserMode === 'auto') {
      emit({
        type: 'status',
        data: {
          message:
            browserMode === 'attach'
              ? '正在附着已打开的浏览器标签…'
              : '优先附着已打开标签；若未发现则新开浏览器…',
        },
      })
    }

    if (targetUrl) {
      const opened = await browser.openUrl(targetUrl)
      toolSummaries.push(`open_url: ${opened.summary}`)
      if (opened.data) extractVisitedUrls('open_url', opened.data, visitedUrls)
      emit({
        type: 'tool_result',
        data: {
          name: 'open_url',
          result: {
            ok: opened.ok,
            summary: opened.summary,
            data: opened.data,
            screenshotBase64: opened.screenshotBase64,
          },
        },
      })
      history.push({
        role: 'system',
        content: `系统已准备目标页。结果: ${opened.summary}`,
      })
    } else {
      await browser.ensurePage()
      const info = browser.getAttachmentInfo()
      if (info) {
        if (info.url) visitedUrls.add(info.url)
        emit({
          type: 'status',
          data: {
            message: info.reusedExistingTab
              ? `已附着标签: ${info.title || info.url}`
              : `已启动浏览器: ${info.url || 'about:blank'}`,
          },
        })
        history.push({
          role: 'system',
          content: `当前浏览器状态: mode=${info.mode}, reused=${info.reusedExistingTab}, url=${info.url}, title=${info.title}`,
        })
      }
    }

    if (sessionConfig?.waitForLogin || browser.shouldWaitForLogin()) {
      emit({ type: 'status', data: { message: '等待你在浏览器中手动登录…' } })
      const loginResult = await browser.waitForManualLogin({
        onProgress: (message) => emit({ type: 'status', data: { message } }),
      })
      toolSummaries.push(`wait_for_login: ${loginResult.summary}`)
      emit({
        type: 'tool_result',
        data: {
          name: 'wait_for_login',
          result: {
            ok: loginResult.ok,
            summary: loginResult.summary,
            data: loginResult.data,
          },
        },
      })
      history.push({
        role: 'system',
        content: `手动登录等待结果: ${loginResult.summary}`,
      })
      if (!loginResult.ok) {
        emit({ type: 'status', data: { message: '登录等待超时，将基于当前可见页面继续探索' } })
      }
    } else {
      history.push({
        role: 'system',
        content: [
          '登录策略提示：本次未启用“等待手动登录”。',
          '若当前是登录页且目标是探索登录功能，请直接观察登录页本身。',
          '不要停下来要求用户输入账号密码。',
          '缺少账号时，把依赖登录成功的路径标为阻塞，继续探索可见页面。',
        ].join(''),
      })
    }

    let finishedNaturally = false
    for (let step = 1; step <= maxSteps; step++) {
      if (signal?.aborted) throw createAbortError()
      stepCount = step
      const stepLabel = unlimited ? `${step}` : `${step}/${configuredMaxSteps}`
      emit({
        type: 'status',
        data: { message: `页面探索中（第 ${stepLabel} 步）…` },
      })

      const stream = await client.chat.completions.create(
        {
          model: llm.model,
          messages: toOpenAiMessages(history),
          tools: browserToolDefinitions,
          tool_choice: 'auto',
          stream: true,
          temperature: 0.2,
        },
        { signal },
      )

      let assistantText = ''
      const toolCallMap = new Map<number, ToolCall>()

      for await (const chunk of stream) {
        if (signal?.aborted) throw createAbortError()
        const choice = chunk.choices?.[0]
        if (!choice) continue
        const delta = choice.delta
        if (delta?.content) {
          assistantText += delta.content
          emit({ type: 'delta', data: { content: delta.content } })
        }
        if (delta?.tool_calls) {
          for (const part of delta.tool_calls) {
            const index = part.index ?? 0
            const existing = toolCallMap.get(index) || {
              id: part.id || `call_${index}_${Date.now()}`,
              type: 'function' as const,
              function: { name: '', arguments: '' },
            }
            if (part.id) existing.id = part.id
            if (part.function?.name) existing.function.name += part.function.name
            if (part.function?.arguments) existing.function.arguments += part.function.arguments
            toolCallMap.set(index, existing)
          }
        }
      }

      const toolCalls = [...toolCallMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, call]) => call)
        .filter((call) => call.function.name)

      history.push({
        role: 'assistant',
        content: assistantText,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      })

      if (!toolCalls.length) {
        finishedNaturally = true
        finalNotes = assistantText.trim()
        emit({ type: 'status', data: { message: '页面探索完成，正在整理探索笔记…' } })
        break
      }

      for (const call of toolCalls) {
        if (signal?.aborted) throw createAbortError()
        emit({
          type: 'tool_start',
          data: {
            id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          },
        })

        const result = await executeBrowserTool(browser, call.function.name, call.function.arguments)
        toolSummaries.push(`${call.function.name}: ${result.summary}`)
        if (result.data) extractVisitedUrls(call.function.name, result.data, visitedUrls)

        emit({
          type: 'tool_result',
          data: {
            id: call.id,
            name: call.function.name,
            result: {
              ok: result.ok,
              summary: result.summary,
              data: result.data,
              screenshotBase64: result.screenshotBase64,
            },
          },
        })

        history.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: result.ok,
            summary: result.summary,
            data: result.data,
          }),
        })
      }
    }

    if (!finishedNaturally && !signal?.aborted && !unlimited) {
      emit({
        type: 'status',
        data: { message: `已达到最大步数 ${configuredMaxSteps}，停止继续探索并汇总…` },
      })
    }

    if (!finalNotes) {
      // Force a closing summary only when the loop ended without a natural final answer.
      emit({
        type: 'status',
        data: {
          message: unlimited
            ? '探索循环结束，正在汇总已观察页面事实…'
            : '探索步数已用尽，正在汇总已观察页面事实…',
        },
      })
      history.push({
        role: 'user',
        content: '请停止继续操作，仅根据目前已观察结果输出完整「页面探索笔记」。不要再调用工具。',
      })
      const closing = await client.chat.completions.create(
        {
          model: llm.model,
          messages: toOpenAiMessages(history),
          stream: true,
          temperature: 0.2,
        },
        { signal },
      )
      let text = ''
      for await (const chunk of closing) {
        if (signal?.aborted) throw createAbortError()
        const delta = chunk.choices?.[0]?.delta?.content
        if (!delta) continue
        text += delta
        emit({ type: 'delta', data: { content: delta } })
      }
      finalNotes = text.trim()
    }

    if (!finalNotes) {
      finalNotes = [
        '### 页面概况',
        `- 目标 URL：${targetUrl || Array.from(visitedUrls)[0] || '未知'}`,
        '### 工具观察摘要',
        ...toolSummaries.slice(-30).map((item) => `- ${item}`),
        '### 说明',
        '- 模型未返回完整探索笔记，以上为工具执行摘要。',
      ].join('\n')
    }

    return {
      notes: finalNotes,
      visitedUrls: Array.from(visitedUrls),
      toolSummaries,
      stepCount,
      targetUrl,
    }
  } catch (error) {
    if (isAbortError(error, signal)) throw createAbortError()
    throw error
  } finally {
    await browser.close()
  }
}

export function shouldExploreWithBrowser(session?: SessionConfig | null): boolean {
  if (!session) return false
  const hasUrl = Boolean(session.targetUrl?.trim())
  const hasAttachHint = Boolean(session.attachUrlIncludes?.trim())
  // Explicit attach/auto without URL still allows using currently open tabs.
  if (session.browserMode === 'attach') return true
  if (hasUrl || hasAttachHint) return true
  return false
}
