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

export class BrowserSession {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private networkLogs: NetworkLogItem[] = []
  private consoleLogs: ConsoleLogItem[] = []
  private requestMap = new Map<Request, string>()
  private seq = 0
  private headless: boolean

  constructor(options?: { headless?: boolean }) {
    this.headless = options?.headless ?? false
  }

  async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page

    await fs.mkdir(config.screenshotDir, { recursive: true })

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
    return this.page
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
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(800)
    return {
      ok: true,
      summary: `已打开 ${page.url()}，HTTP ${response?.status() ?? 'n/a'}`,
      data: {
        url: page.url(),
        title: await page.title(),
        status: response?.status() ?? null,
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
