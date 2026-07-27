import OpenAI from 'openai'
import { v4 as uuidv4 } from 'uuid'
import { config } from '../config.js'
import { BrowserSession } from '../browser/session.js'
import { browserToolDefinitions, executeBrowserTool } from '../browser/tools.js'
import { buildSystemPrompt, loadSkills } from '../skills/loader.js'
import type {
  ChatMessage,
  LlmSettings,
  SessionConfig,
  StreamEvent,
  ToolCall,
} from '../types/index.js'

export interface RunAgentInput {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  llm: LlmSettings
  session?: SessionConfig
  onEvent: (event: StreamEvent) => void
  signal?: AbortSignal
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return trimmed
  // OpenAI SDK appends /chat/completions; many gateways expect /v1
  if (trimmed.endsWith('/v1')) return trimmed
  if (/\/v\d+$/.test(trimmed)) return trimmed
  return `${trimmed}/v1`
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

export async function runAgent(input: RunAgentInput): Promise<void> {
  const { messages, llm, session: sessionConfig, onEvent, signal } = input
  const sessionId = uuidv4()
  const configuredMaxSteps = sessionConfig?.maxSteps ?? config.defaultMaxSteps
  const unlimited = !configuredMaxSteps || configuredMaxSteps <= 0
  const maxSteps = unlimited ? Number.POSITIVE_INFINITY : configuredMaxSteps
  const targetUrl = sessionConfig?.targetUrl

  onEvent({ type: 'session', data: { sessionId, targetUrl: targetUrl || null } })

  if (!llm.apiKey?.trim()) {
    onEvent({ type: 'error', data: { message: '请先配置 API Key' } })
    onEvent({ type: 'done', data: { sessionId } })
    return
  }
  if (!llm.baseUrl?.trim()) {
    onEvent({ type: 'error', data: { message: '请先配置 Base URL' } })
    onEvent({ type: 'done', data: { sessionId } })
    return
  }
  if (!llm.model?.trim()) {
    onEvent({ type: 'error', data: { message: '请先配置模型名称' } })
    onEvent({ type: 'done', data: { sessionId } })
    return
  }

  const skills = await loadSkills()
  const systemPrompt = buildSystemPrompt(skills, targetUrl)

  const history: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
  ]

  // Some gateways WAF-block OpenAI SDK fingerprint headers (User-Agent / x-stainless-*).
  // Override them so OpenAI-compatible relays accept the request.
  const client = new OpenAI({
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

  let browserMode = sessionConfig?.browserMode ?? 'auto'
  const waitForLogin = Boolean(sessionConfig?.waitForLogin)
  const requestedHeadless = sessionConfig?.headless ?? config.defaultHeadless
  const hasRemoteCdp = Boolean(sessionConfig?.cdpEndpoint?.trim())
  // Attach / manual login prefer a real window; CDP attach does not need local GUI.
  let headless = waitForLogin || browserMode === 'attach' ? false : requestedHeadless

  // Servers without an X/Wayland display cannot launch headed Chromium.
  // Force headless for local launch; allow manual login only via remote CDP.
  if (!headless && !config.canUseHeadedBrowser) {
    if (waitForLogin && !hasRemoteCdp) {
      onEvent({
        type: 'error',
        data: {
          message:
            '当前服务器没有图形界面（缺少 DISPLAY/WAYLAND_DISPLAY），本地无法弹出登录窗口。' +
            '若仍要用“等待手动登录”，请在本机/有界面机器启动带远程调试的 Chromium，' +
            '把 cdpEndpoint 填成该地址（例如 http://你的电脑IP:9222），然后在那台机器上登录。' +
            '也可改用 xvfb + VNC 暴露服务器浏览器，或关闭 waitForLogin 走无头模式。',
        },
      })
      onEvent({ type: 'done', data: { sessionId } })
      return
    }
    if (browserMode === 'attach' && !hasRemoteCdp) {
      onEvent({
        type: 'error',
        data: {
          message:
            '当前服务器没有图形界面，且未配置 cdpEndpoint，无法附着本地浏览器标签。' +
            '请填写可访问的远程 CDP 地址，或改用 browserMode=launch + headless=true。',
        },
      })
      onEvent({ type: 'done', data: { sessionId } })
      return
    }
    if (waitForLogin && hasRemoteCdp) {
      // Manual login happens on the remote headed browser; server only attaches via CDP.
      browserMode = 'attach'
      headless = true
      onEvent({
        type: 'status',
        data: {
          message:
            '无图形界面：将通过远程 CDP 附着浏览器并等待你在那台机器上手动登录。',
        },
      })
    } else if (browserMode !== 'attach') {
      // auto/launch headed request: force headless so Playwright can start.
      headless = true
      onEvent({
        type: 'status',
        data: {
          message: '检测到无图形界面环境，已自动切换为无头模式启动 Chromium。',
        },
      })
    }
  }

  const browser = new BrowserSession({
    headless,
    mode: browserMode,
    cdpEndpoint: sessionConfig?.cdpEndpoint,
    attachUrlIncludes: sessionConfig?.attachUrlIncludes || targetUrl,
    waitForLogin,
    loginWaitSeconds: sessionConfig?.loginWaitSeconds,
  })

  try {
    if (browserMode === 'attach' || browserMode === 'auto') {
      onEvent({
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
      onEvent({ type: 'status', data: { message: `正在准备目标页: ${targetUrl}` } })
      const opened = await browser.openUrl(targetUrl)
      onEvent({
        type: 'tool_result',
        data: {
          name: 'open_url',
          result: opened,
        },
      })
      history.push({
        role: 'system',
        content: `系统已准备目标页。结果: ${opened.summary}`,
      })
    } else if (browserMode === 'attach' || browserMode === 'auto') {
      // Attach to whatever tab is already open even without explicit URL.
      await browser.ensurePage()
      const info = browser.getAttachmentInfo()
      if (info) {
        onEvent({
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
      onEvent({ type: 'status', data: { message: '等待你在浏览器中手动登录…' } })
      const loginResult = await browser.waitForManualLogin({
        onProgress: (message) => onEvent({ type: 'status', data: { message } }),
      })
      onEvent({
        type: 'tool_result',
        data: {
          name: 'wait_for_login',
          result: loginResult,
        },
      })
      history.push({
        role: 'system',
        content: `手动登录等待结果: ${loginResult.summary}`,
      })
      if (!loginResult.ok && browserMode === 'attach') {
        // Continue anyway; agent can still inspect whatever page is visible.
        onEvent({ type: 'status', data: { message: '登录等待超时，将基于当前可见页面继续检测' } })
      }
    } else {
      // Avoid the model treating every login screen as a hard stop for credentials.
      history.push({
        role: 'system',
        content: [
          '登录策略提示：本次未启用“等待手动登录”。',
          '若当前页面是登录页，且用户目标/用例是测试登录页或登录功能本身，请直接测试该页的 UI、校验、交互、错误提示与相关接口。',
          '不要停下来要求用户输入账号密码，也不要空等用户登录。',
          '只有用户消息或测试用例附件已提供可用账号密码，且用例要求登录成功时，才填写真实凭据。',
          '若缺少账号密码，将“登录成功”路径标为阻塞，并继续完成不依赖真实凭据的检查。',
        ].join(''),
      })
    }

    const attachment = browser.getAttachmentInfo()
    if (attachment) {
      onEvent({
        type: 'session',
        data: {
          sessionId,
          targetUrl: targetUrl || attachment.url || null,
          browserMode: attachment.mode,
          attachedUrl: attachment.url,
          reusedExistingTab: attachment.reusedExistingTab,
          cdpEndpoint: attachment.endpoint || sessionConfig?.cdpEndpoint || null,
        },
      })
    }

    let finishedNaturally = false
    for (let step = 1; step <= maxSteps; step++) {
      if (signal?.aborted) {
        onEvent({ type: 'status', data: { message: '用户已停止本次测试' } })
        break
      }

      const stepLabel = unlimited ? `${step}` : `${step}/${configuredMaxSteps}`
      onEvent({ type: 'status', data: { message: `Agent 思考中（第 ${stepLabel} 步）...` } })

      const stream = await client.chat.completions.create({
        model: llm.model,
        messages: toOpenAiMessages(history),
        tools: browserToolDefinitions,
        tool_choice: 'auto',
        stream: true,
        temperature: 0.2,
      })

      let assistantText = ''
      const toolCallMap = new Map<number, ToolCall>()

      for await (const chunk of stream) {
        if (signal?.aborted) break
        const choice = chunk.choices?.[0]
        if (!choice) continue

        const delta = choice.delta
        if (delta?.content) {
          assistantText += delta.content
          onEvent({ type: 'delta', data: { content: delta.content } })
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
        onEvent({ type: 'status', data: { message: '测试完成，已生成结论' } })
        break
      }

      for (const call of toolCalls) {
        if (signal?.aborted) break

        onEvent({
          type: 'tool_start',
          data: {
            id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          },
        })

        const result = await executeBrowserTool(browser, call.function.name, call.function.arguments)

        onEvent({
          type: 'tool_result',
          data: {
            id: call.id,
            name: call.function.name,
            result: {
              ok: result.ok,
              summary: result.summary,
              data: result.data,
              screenshotPath:
                result.data && typeof result.data === 'object' && result.data !== null && 'path' in result.data
                  ? (result.data as { path?: string }).path
                  : undefined,
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
      onEvent({
        type: 'status',
        data: { message: `已达到最大步数 ${configuredMaxSteps}，测试停止` },
      })
    }
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error)
    const anyErr = error as { status?: number; error?: { message?: string }; message?: string }
    if (anyErr?.status) {
      message = `LLM 请求失败 (HTTP ${anyErr.status}): ${anyErr?.error?.message || anyErr.message || message}`
    }
    if (message.includes('403')) {
      message +=
        '。请检查中转站是否拦截当前 IP/Referer/User-Agent，以及 Base URL、API Key、模型名是否正确。若中转站对 OpenAI SDK 指纹敏感，服务端已自动改写请求头；仍失败时请换模型或联系中转站。'
    }
    onEvent({ type: 'error', data: { message } })
  } finally {
    await browser.close()
    onEvent({ type: 'done', data: { sessionId } })
  }
}
