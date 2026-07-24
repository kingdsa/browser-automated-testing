import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page, type Request, type ConsoleMessage } from 'playwright'
import { config } from '../config.js'
import type { ToolResult } from '../types/index.js'

export interface NetworkLogItem {
  id: string
  method: string
  url: string
  resourceType: string
  status?: number
  ok?: boolean
  failure?: string
  startedAt: number
  finishedAt?: number
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  postData?: string
}

export interface ConsoleLogItem {
  type: string
  text: string
  location?: string
  timestamp: number
}

/** launch: 新开浏览器；attach: 附着已打开标签；auto: 先自动找标签，找不到再新开 */
export type BrowserMode = 'auto' | 'launch' | 'attach'

export interface BrowserSessionOptions {
  headless?: boolean
  mode?: BrowserMode
  /** Optional fixed CDP endpoint. Empty = auto-scan common ports. */
  cdpEndpoint?: string
  /** Prefer attaching to an already-open tab whose URL contains this value */
  attachUrlIncludes?: string
  /** After open/attach, wait for user to finish manual login */
  waitForLogin?: boolean
  /** Max seconds to wait for login readiness */
  loginWaitSeconds?: number
  /** When true (default in attach), never close the user's browser process */
  keepBrowserOpen?: boolean
}

export interface CdpTabInfo {
  endpoint: string
  url: string
  title: string
  index: number
  browser?: string
}

export interface DiscoveredCdpEndpoint {
  endpoint: string
  browser: string
  webSocketDebuggerUrl?: string
}

const DEFAULT_CDP_PORTS = [9222, 9223, 9224, 9225, 9229, 9333, 9221]

export class BrowserSession {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private networkLogs: NetworkLogItem[] = []
  private consoleLogs: ConsoleLogItem[] = []
  private requestMap = new Map<Request, string>()
  private seq = 0
  private headless: boolean
  private mode: BrowserMode
  private cdpEndpoint?: string
  private attachUrlIncludes?: string
  private waitForLogin: boolean
  private loginWaitSeconds: number
  private keepBrowserOpen: boolean
  private connectedViaCdp = false
  private attachedInfo: {
    url: string
    title: string
    reusedExistingTab: boolean
    mode: BrowserMode
    endpoint?: string
  } | null = null

  constructor(options?: BrowserSessionOptions) {
    this.headless = options?.headless ?? false
    this.mode = options?.mode ?? 'auto'
    this.cdpEndpoint = options?.cdpEndpoint?.trim().replace(/\/$/, '') || undefined
    this.attachUrlIncludes = options?.attachUrlIncludes?.trim() || undefined
    this.waitForLogin = options?.waitForLogin ?? false
    this.loginWaitSeconds = options?.loginWaitSeconds ?? 180
    this.keepBrowserOpen = options?.keepBrowserOpen ?? this.mode === 'attach'
  }

  getAttachmentInfo() {
    return this.attachedInfo
  }

  getMode() {
    return this.mode
  }

  async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page

    await fs.mkdir(config.screenshotDir, { recursive: true })

    if (this.mode === 'attach') {
      return this.connectCdpAndPickPage()
    }

    if (this.mode === 'auto') {
      try {
        return await this.connectCdpAndPickPage()
      } catch {
        // Fall back to launching a fresh browser. This keeps zero-config UX working
        // even when the user did not start a remote-debugging browser.
      }
    }

    return this.launchFreshPage()
  }

  private async launchFreshPage(): Promise<Page> {
    this.browser = await chromium.launch({
      headless: this.headless,
      args: ['--disable-blink-features=AutomationControlled'],
    })

    this.context = await this.browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    })

    this.page = await this.context.newPage()
    this.attachListeners(this.page)
    this.attachedInfo = {
      url: this.page.url(),
      title: await this.page.title().catch(() => ''),
      reusedExistingTab: false,
      mode: 'launch',
    }
    return this.page
  }

  private async connectCdpAndPickPage(): Promise<Page> {
    const endpoints = this.cdpEndpoint
      ? [{ endpoint: this.cdpEndpoint, browser: 'custom' }]
      : await BrowserSession.discoverCdpEndpoints()

    if (!endpoints.length) {
      throw new Error(
        '未发现可附着的浏览器标签。请任选其一：\n' +
          '1) 用远程调试方式打开 Chromium 内核浏览器（Chrome / Edge / 360 / Arc 等），并先登录目标站；\n' +
          '2) 改用“新开浏览器 + 等待手动登录”。\n' +
          '一键示例（Chrome）：\n' +
          '/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --user-data-dir="$HOME/chrome-bat-profile"',
      )
    }

    let lastError: unknown
    for (const item of endpoints) {
      try {
        return await this.connectToEndpointAndPickPage(item.endpoint)
      } catch (error) {
        lastError = error
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError)
    throw new Error(`已发现调试端口但附着失败: ${message}`)
  }

  private async connectToEndpointAndPickPage(endpoint: string): Promise<Page> {
    this.browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 })
    this.connectedViaCdp = true
    this.keepBrowserOpen = true

    const contexts = this.browser.contexts()
    this.context = contexts[0] ?? (await this.browser.newContext({ ignoreHTTPSErrors: true }))

    const pages = this.context.pages().filter((page) => !page.isClosed())
    const needle = (this.attachUrlIncludes || '').toLowerCase()

    let page: Page | undefined
    let reusedExistingTab = false

    if (needle) {
      page = pages.find((p) => p.url().toLowerCase().includes(needle))
      if (page) reusedExistingTab = true
    }

    if (!page) {
      page =
        pages.find((p) => {
          const url = p.url()
          return url && !url.startsWith('about:') && !url.startsWith('chrome://') && !url.startsWith('edge://')
        }) || pages[0]
      if (page) reusedExistingTab = true
    }

    if (!page) {
      page = await this.context.newPage()
      reusedExistingTab = false
    }

    this.page = page
    this.attachListeners(this.page)
    await this.page.bringToFront().catch(() => undefined)

    this.attachedInfo = {
      url: this.page.url(),
      title: await this.page.title().catch(() => ''),
      reusedExistingTab,
      mode: 'attach',
      endpoint,
    }
    return this.page
  }

  static async discoverCdpEndpoints(ports: number[] = DEFAULT_CDP_PORTS): Promise<DiscoveredCdpEndpoint[]> {
    const found: DiscoveredCdpEndpoint[] = []

    await Promise.all(
      ports.map(async (port) => {
        const endpoint = `http://127.0.0.1:${port}`
        try {
          const response = await fetch(`${endpoint}/json/version`, {
            signal: AbortSignal.timeout(700),
          })
          if (!response.ok) return
          const data = (await response.json()) as {
            Browser?: string
            webSocketDebuggerUrl?: string
          }
          found.push({
            endpoint,
            browser: data.Browser || `port-${port}`,
            webSocketDebuggerUrl: data.webSocketDebuggerUrl,
          })
        } catch {
          // port closed
        }
      }),
    )

    return found.sort((a, b) => a.endpoint.localeCompare(b.endpoint))
  }

  static async listCdpTabs(cdpEndpoint?: string): Promise<CdpTabInfo[]> {
    const endpoints = cdpEndpoint?.trim()
      ? [{ endpoint: cdpEndpoint.trim().replace(/\/$/, ''), browser: 'custom' }]
      : await BrowserSession.discoverCdpEndpoints()

    const tabs: CdpTabInfo[] = []
    let index = 0

    for (const item of endpoints) {
      try {
        const browser = await chromium.connectOverCDP(item.endpoint, { timeout: 4000 })
        try {
          for (const context of browser.contexts()) {
            for (const page of context.pages()) {
              if (page.isClosed()) continue
              const url = page.url()
              if (!url || url.startsWith('chrome://') || url.startsWith('edge://')) continue
              tabs.push({
                endpoint: item.endpoint,
                browser: item.browser,
                index: index++,
                url,
                title: await page.title().catch(() => ''),
              })
            }
          }
        } finally {
          await browser.close().catch(() => undefined)
        }
      } catch {
        // ignore this endpoint
      }
    }

    return tabs
  }

  /**
   * Wait until the current page looks logged-in / ready for testing.
   * Used when the site needs auth and the user logs in manually in the headed window.
   */
  async waitForManualLogin(options?: {
    timeoutMs?: number
    onProgress?: (message: string) => void
  }): Promise<ToolResult> {
    const page = await this.ensurePage()
    const timeoutMs = options?.timeoutMs ?? this.loginWaitSeconds * 1000
    const started = Date.now()
    options?.onProgress?.(
      `请在浏览器窗口中完成登录（最多 ${Math.round(timeoutMs / 1000)}s）。登录成功并看到业务内容后会自动继续。`,
    )

    while (Date.now() - started < timeoutMs) {
      const state = await page
        .evaluate(() => {
          const url = location.href
          const title = document.title || ''
          const hasPassword = Boolean(document.querySelector('input[type="password"]'))
          const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim()
          const loginHints = /login|signin|sign-in|passport|sso|auth|登录|登陆|账号|密码/i
          const looksLikeLogin =
            hasPassword || loginHints.test(url) || loginHints.test(title) || loginHints.test(bodyText.slice(0, 300))
          return {
            url,
            title,
            hasPassword,
            looksLikeLogin,
            bodyLength: bodyText.length,
          }
        })
        .catch(() => null)

      if (state && !state.looksLikeLogin && state.bodyLength > 40) {
        this.attachedInfo = {
          url: state.url,
          title: state.title,
          reusedExistingTab: this.connectedViaCdp,
          mode: this.connectedViaCdp ? 'attach' : 'launch',
          endpoint: this.attachedInfo?.endpoint,
        }
        return {
          ok: true,
          summary: `检测到页面已可测（疑似已登录）: ${state.title || state.url}`,
          data: state,
        }
      }

      const elapsed = Math.round((Date.now() - started) / 1000)
      if (elapsed > 0 && elapsed % 10 === 0) {
        options?.onProgress?.(`仍在等待手动登录… 已等待 ${elapsed}s`)
      }
      await page.waitForTimeout(1500)
    }

    return {
      ok: false,
      summary: `等待手动登录超时（${Math.round(timeoutMs / 1000)}s）。可重试，或先附着已登录标签页。`,
      data: {
        url: page.url(),
        title: await page.title().catch(() => ''),
      },
    }
  }

  shouldWaitForLogin() {
    return this.waitForLogin
  }

  private attachListeners(page: Page) {
    page.on('request', (request) => {
      const id = `req_${++this.seq}`
      this.requestMap.set(request, id)
      const item: NetworkLogItem = {
        id,
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
        startedAt: Date.now(),
        requestHeaders: request.headers(),
        postData: request.postData() ?? undefined,
      }
      this.networkLogs.push(item)
      if (this.networkLogs.length > 300) this.networkLogs.shift()
    })

    page.on('response', async (response) => {
      const request = response.request()
      const id = this.requestMap.get(request)
      const item = id
        ? this.networkLogs.find((log) => log.id === id)
        : this.networkLogs.find((log) => log.url === request.url() && log.status == null)

      if (!item) return
      item.status = response.status()
      item.ok = response.ok()
      item.finishedAt = Date.now()
      item.responseHeaders = response.headers()
    })

    page.on('requestfailed', (request) => {
      const id = this.requestMap.get(request)
      const item = id
        ? this.networkLogs.find((log) => log.id === id)
        : this.networkLogs.find((log) => log.url === request.url() && log.failure == null)

      if (!item) return
      item.failure = request.failure()?.errorText || 'request failed'
      item.finishedAt = Date.now()
      item.ok = false
    })

    page.on('console', (msg: ConsoleMessage) => {
      this.consoleLogs.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location()?.url,
        timestamp: Date.now(),
      })
      if (this.consoleLogs.length > 200) this.consoleLogs.shift()
    })

    page.on('pageerror', (error) => {
      this.consoleLogs.push({
        type: 'pageerror',
        text: error.message,
        timestamp: Date.now(),
      })
      if (this.consoleLogs.length > 200) this.consoleLogs.shift()
    })
  }

  async openUrl(url: string): Promise<ToolResult> {
    const page = await this.ensurePage()
    const target = url.trim()
    if (!target) {
      return {
        ok: false,
        summary: 'open_url 缺少 url',
      }
    }

    // In CDP attach mode, if the existing tab already matches the target, keep the live state.
    const current = page.url()
    if (
      this.connectedViaCdp &&
      current &&
      !current.startsWith('about:') &&
      (current === target ||
        current.startsWith(target) ||
        target.startsWith(current) ||
        (this.attachUrlIncludes && current.toLowerCase().includes(this.attachUrlIncludes.toLowerCase())))
    ) {
      await page.waitForTimeout(300)
      return {
        ok: true,
        summary: `已附着现有标签页（未重新导航）: ${current}`,
        data: {
          url: current,
          title: await page.title(),
          status: null,
          attachedExisting: true,
          reusedExistingTab: true,
        },
      }
    }

    const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(800)
    this.attachedInfo = {
      url: page.url(),
      title: await page.title().catch(() => ''),
      reusedExistingTab: this.connectedViaCdp,
      mode: this.connectedViaCdp ? 'attach' : 'launch',
      endpoint: this.attachedInfo?.endpoint,
    }
    return {
      ok: true,
      summary: `已打开 ${page.url()}，HTTP ${response?.status() ?? 'n/a'}`,
      data: {
        url: page.url(),
        title: await page.title(),
        status: response?.status() ?? null,
        attachedExisting: false,
        reusedExistingTab: this.connectedViaCdp,
      },
    }
  }

  async navigate(url: string): Promise<ToolResult> {
    return this.openUrl(url)
  }

  async getSnapshot(): Promise<ToolResult> {
    const page = await this.ensurePage()
    const data = await page.evaluate(() => {
      const isVisible = (el: Element) => {
        const style = window.getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        return (
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          style.opacity !== '0' &&
          rect.width > 0 &&
          rect.height > 0
        )
      }

      const interactiveSelector =
        'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [onclick], [contenteditable="true"]'

      const interactive = Array.from(document.querySelectorAll(interactiveSelector))
        .filter(isVisible)
        .slice(0, 80)
        .map((el, index) => {
          const htmlEl = el as HTMLElement
          const tag = htmlEl.tagName.toLowerCase()
          const text = (htmlEl.innerText || htmlEl.getAttribute('aria-label') || htmlEl.getAttribute('placeholder') || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80)
          const rect = htmlEl.getBoundingClientRect()
          return {
            index,
            tag,
            role: htmlEl.getAttribute('role'),
            type: htmlEl.getAttribute('type'),
            id: htmlEl.id || undefined,
            name: htmlEl.getAttribute('name') || undefined,
            testId: htmlEl.getAttribute('data-testid') || undefined,
            href: htmlEl.getAttribute('href') || undefined,
            text,
            selectorHint: htmlEl.id
              ? `#${htmlEl.id}`
              : htmlEl.getAttribute('data-testid')
                ? `[data-testid="${htmlEl.getAttribute('data-testid')}"]`
                : text
                  ? `${tag}:has-text("${text.slice(0, 30).replace(/"/g, '\\"')}")`
                  : tag,
            box: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
          }
        })

      const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
        .filter(isVisible)
        .slice(0, 20)
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
        }))

      const issues: string[] = []
      if (!document.title?.trim()) issues.push('页面缺少 title')
      if (!document.querySelector('h1,h2')) issues.push('页面缺少主标题（h1/h2）')
      const overflowCandidates = Array.from(document.querySelectorAll('body *'))
        .filter(isVisible)
        .slice(0, 400)
        .filter((el) => {
          const rect = el.getBoundingClientRect()
          return rect.right > window.innerWidth + 2 || rect.left < -2
        })
        .slice(0, 5)
        .map((el) => {
          const htmlEl = el as HTMLElement
          return `${htmlEl.tagName.toLowerCase()}${htmlEl.className ? '.' + String(htmlEl.className).split(' ')[0] : ''}`
        })
      if (overflowCandidates.length) {
        issues.push(`疑似横向溢出元素: ${overflowCandidates.join(', ')}`)
      }

      return {
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        headings,
        interactive,
        issues,
        bodyTextSample: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1200),
      }
    })

    return {
      ok: true,
      summary: `页面快照：${data.title || data.url}，可交互元素 ${data.interactive.length} 个`,
      data,
    }
  }

  async click(selector: string): Promise<ToolResult> {
    const page = await this.ensurePage()
    await page.locator(selector).first().click({ timeout: 15000 })
    await page.waitForTimeout(500)
    return {
      ok: true,
      summary: `已点击 ${selector}`,
      data: { selector, url: page.url() },
    }
  }

  async type(selector: string, text: string, pressEnter = false): Promise<ToolResult> {
    const page = await this.ensurePage()
    const locator = page.locator(selector).first()
    await locator.click({ timeout: 15000 })
    await locator.fill(text, { timeout: 15000 })
    if (pressEnter) await locator.press('Enter')
    await page.waitForTimeout(400)
    return {
      ok: true,
      summary: `已在 ${selector} 输入文本${pressEnter ? ' 并回车' : ''}`,
      data: { selector, textLength: text.length },
    }
  }

  async press(key: string): Promise<ToolResult> {
    const page = await this.ensurePage()
    await page.keyboard.press(key)
    await page.waitForTimeout(200)
    return { ok: true, summary: `已按下 ${key}` }
  }

  async scroll(direction: 'up' | 'down' | 'top' | 'bottom' = 'down'): Promise<ToolResult> {
    const page = await this.ensurePage()
    await page.evaluate((dir) => {
      if (dir === 'top') window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
      else if (dir === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' as ScrollBehavior })
      else window.scrollBy({ top: dir === 'down' ? 700 : -700, behavior: 'instant' as ScrollBehavior })
    }, direction)
    await page.waitForTimeout(300)
    return { ok: true, summary: `已滚动 ${direction}` }
  }

  async wait(ms = 1000, selector?: string): Promise<ToolResult> {
    const page = await this.ensurePage()
    if (selector) {
      await page.locator(selector).first().waitFor({ timeout: Math.max(ms, 1000) })
      return { ok: true, summary: `已等待元素出现: ${selector}` }
    }
    await page.waitForTimeout(ms)
    return { ok: true, summary: `已等待 ${ms}ms` }
  }

  async evaluate(script: string): Promise<ToolResult> {
    const page = await this.ensurePage()
    const result = await page.evaluate((code) => {
      // eslint-disable-next-line no-new-func
      const fn = new Function(code)
      return fn()
    }, script)

    return {
      ok: true,
      summary: '已执行页面脚本',
      data: { result },
    }
  }

  async screenshot(fullPage = false): Promise<ToolResult> {
    const page = await this.ensurePage()
    const fileName = `shot_${Date.now()}.png`
    const filePath = path.join(config.screenshotDir, fileName)
    const buffer = await page.screenshot({ path: filePath, fullPage, type: 'png' })
    return {
      ok: true,
      summary: `已截图 ${fileName}`,
      data: {
        path: `/screenshots/${fileName}`,
        url: page.url(),
        fullPage,
      },
      screenshotBase64: buffer.toString('base64'),
    }
  }

  getNetworkLogs(options?: { onlyFailed?: boolean; limit?: number }): ToolResult {
    const limit = options?.limit ?? 40
    let logs = [...this.networkLogs]
    if (options?.onlyFailed) {
      logs = logs.filter((log) => log.ok === false || (log.status != null && log.status >= 400) || !!log.failure)
    }
    const sliced = logs.slice(-limit)
    return {
      ok: true,
      summary: `网络日志 ${sliced.length} 条${options?.onlyFailed ? '（仅失败）' : ''}`,
      data: {
        total: this.networkLogs.length,
        items: sliced.map((log) => ({
          id: log.id,
          method: log.method,
          url: log.url,
          resourceType: log.resourceType,
          status: log.status,
          ok: log.ok,
          failure: log.failure,
          durationMs: log.finishedAt && log.startedAt ? log.finishedAt - log.startedAt : undefined,
        })),
      },
    }
  }

  getConsoleLogs(options?: { limit?: number; onlyErrors?: boolean }): ToolResult {
    const limit = options?.limit ?? 40
    let logs = [...this.consoleLogs]
    if (options?.onlyErrors) {
      logs = logs.filter((log) => ['error', 'warning', 'pageerror'].includes(log.type))
    }
    const sliced = logs.slice(-limit)
    return {
      ok: true,
      summary: `控制台日志 ${sliced.length} 条`,
      data: { total: this.consoleLogs.length, items: sliced },
    }
  }

  async getPageInfo(): Promise<ToolResult> {
    const page = await this.ensurePage()
    return {
      ok: true,
      summary: `当前页: ${page.url()}`,
      data: {
        url: page.url(),
        title: await page.title(),
        viewport: page.viewportSize(),
      },
    }
  }

  async close(): Promise<void> {
    // CDP attach: never close the user's Chrome window/process by default.
    // Playwright's browser.close() on a CDP connection disconnects the client;
    // avoid context.close() which can close tabs in some Chrome versions.
    if (this.connectedViaCdp || this.keepBrowserOpen) {
      try {
        await this.browser?.close()
      } catch {
        // ignore disconnect errors
      }
      this.page = null
      this.context = null
      this.browser = null
      return
    }

    try {
      await this.context?.close()
    } catch {
      // ignore
    }
    try {
      await this.browser?.close()
    } catch {
      // ignore
    }
    this.page = null
    this.context = null
    this.browser = null
  }
}
