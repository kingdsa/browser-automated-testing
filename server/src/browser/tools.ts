import type { ToolDefinition, ToolResult } from '../types/index.js'
import type { BrowserSession } from './session.js'

export const browserToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'open_url',
      description: '打开目标 URL（首次进入页面时使用）',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '完整 URL，例如 https://example.com' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: '在当前浏览器会话中跳转到指定 URL',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_page_snapshot',
      description: '获取当前页面结构快照：标题、标题层级、可交互元素、初步布局问题、正文摘要',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click',
      description: '点击页面元素。优先使用 snapshot 返回的 selectorHint',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS / Playwright 选择器' },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type_text',
      description: '在输入框中填写文本，可选回车',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          text: { type: 'string' },
          pressEnter: { type: 'boolean' },
        },
        required: ['selector', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'press_key',
      description: '按下键盘按键，例如 Enter、Escape、Tab',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scroll_page',
      description: '滚动页面，用于检查长页面布局与懒加载',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['up', 'down', 'top', 'bottom'],
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wait_for',
      description: '等待一段时间，或等待某个选择器出现',
      parameters: {
        type: 'object',
        properties: {
          ms: { type: 'number' },
          selector: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'take_screenshot',
      description: '截取当前页面截图，用于证据留存',
      parameters: {
        type: 'object',
        properties: {
          fullPage: { type: 'boolean' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_network_logs',
      description: '获取最近的网络请求日志，可筛选失败请求，用于接口检测',
      parameters: {
        type: 'object',
        properties: {
          onlyFailed: { type: 'boolean' },
          limit: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_console_logs',
      description: '获取浏览器控制台日志，可筛选错误',
      parameters: {
        type: 'object',
        properties: {
          onlyErrors: { type: 'boolean' },
          limit: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_page_info',
      description: '获取当前 URL、标题、视口信息',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'evaluate_js',
      description: '在页面上下文执行只读探测脚本并返回结果。禁止执行破坏性操作。',
      parameters: {
        type: 'object',
        properties: {
          script: {
            type: 'string',
            description: '函数体字符串，最终 return 结果，例如: return document.title',
          },
        },
        required: ['script'],
      },
    },
  },
]

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw?.trim()) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error(`工具参数不是合法 JSON: ${raw}`)
  }
}

export async function executeBrowserTool(
  session: BrowserSession,
  name: string,
  rawArgs: string,
): Promise<ToolResult> {
  const args = parseArgs(rawArgs)

  try {
    switch (name) {
      case 'open_url':
      case 'navigate':
        return await session.openUrl(String(args.url || ''))
      case 'get_page_snapshot':
        return await session.getSnapshot()
      case 'click':
        return await session.click(String(args.selector || ''))
      case 'type_text':
        return await session.type(
          String(args.selector || ''),
          String(args.text || ''),
          Boolean(args.pressEnter),
        )
      case 'press_key':
        return await session.press(String(args.key || ''))
      case 'scroll_page':
        return await session.scroll((args.direction as 'up' | 'down' | 'top' | 'bottom') || 'down')
      case 'wait_for':
        return await session.wait(
          typeof args.ms === 'number' ? args.ms : 1000,
          args.selector ? String(args.selector) : undefined,
        )
      case 'take_screenshot':
        return await session.screenshot(Boolean(args.fullPage))
      case 'get_network_logs':
        return session.getNetworkLogs({
          onlyFailed: Boolean(args.onlyFailed),
          limit: typeof args.limit === 'number' ? args.limit : 40,
        })
      case 'get_console_logs':
        return session.getConsoleLogs({
          onlyErrors: Boolean(args.onlyErrors),
          limit: typeof args.limit === 'number' ? args.limit : 40,
        })
      case 'get_page_info':
        return await session.getPageInfo()
      case 'evaluate_js':
        return await session.evaluate(String(args.script || 'return null'))
      default:
        return { ok: false, summary: `未知工具: ${name}` }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, summary: `工具执行失败: ${message}` }
  }
}
