import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createCompletion } = vi.hoisted(() => ({
  createCompletion: vi.fn<() => unknown>(),
}))

vi.mock('openai', () => ({
  default: class OpenAI {
    chat = {
      completions: {
        create: createCompletion,
      },
    }
  },
}))

import {
  streamAnalyzeRequirementDocument,
  streamGenerateMindMap,
} from '../../../server/src/requirements/analyze'
import { config } from '../../../server/src/config'

const INPUT_RECEIPT = '[[INPUT_DOCUMENT_BEGIN]]\n[[INPUT_DOCUMENT_END]]'

function completionStream(
  deltas: Array<Record<string, unknown>>,
  finishReason: 'stop' | 'length' = 'stop',
) {
  return (async function* () {
    for (const delta of deltas) {
      yield { choices: [{ delta }] }
    }
    yield { choices: [{ delta: {}, finish_reason: finishReason }] }
  })()
}

function ndjson(...records: Array<Record<string, unknown>>): string {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
}

describe('streamAnalyzeRequirementDocument', () => {
  beforeEach(() => {
    createCompletion.mockReset()
    config.requirementsGenerationMaxDurationMs = 60_000
    config.requirementsNoProgressLimit = 3
    config.requirementsRetryBaseDelayMs = 0
  })

  it('streams reasoning only and returns the accumulated reasoning summary', async () => {
    createCompletion.mockReturnValueOnce(
      completionStream([
        { reasoning_content: '正在识别核心流程。' },
        {
          content: `${INPUT_RECEIPT}\n## 功能模块\n- 登录与权限\n\n[[REQUIREMENT_ANALYSIS_COMPLETE]]`,
        },
      ]),
    )

    const events: Array<{ type: string; data: unknown }> = []
    const result = await streamAnalyzeRequirementDocument({
      llm: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
      content: '用户可以使用账号和密码登录。',
      fileName: 'account.md',
      onEvent: (event) => events.push(event),
    })

    const types = events.map((event) => event.type)

    expect(createCompletion).toHaveBeenCalledTimes(1)
    expect(types).toContain('reasoning')
    expect(types).not.toContain('delta')
    expect(types).not.toContain('mindmap')
    expect(types).toContain('result')
    expect(types).toContain('done')

    const resultEvent = events.find((event) => event.type === 'result')
    const resultSummary = (resultEvent?.data as { reasoningSummary?: string } | undefined)
      ?.reasoningSummary
    expect(resultSummary).toContain('登录与权限')
    expect(resultSummary).not.toContain('REQUIREMENT_ANALYSIS_COMPLETE')
    expect(resultSummary).not.toContain('INPUT_DOCUMENT_BEGIN')
    expect(result.reasoningSummary).toContain('登录与权限')
  })

  it('continues an analysis that ends because of the output limit', async () => {
    const firstPass = `[[INPUT_DOCUMENT_BEGIN]]\n${'前半段分析'.repeat(1000)}`
    createCompletion
      .mockReturnValueOnce(completionStream([{ content: firstPass }], 'length'))
      .mockReturnValueOnce(
        completionStream([
          {
            content: '后半段分析\n[[INPUT_DOCUMENT_END]]\n[[REQUIREMENT_ANALYSIS_COMPLETE]]',
          },
        ]),
      )

    const events: Array<{ type: string; data: unknown }> = []
    const result = await streamAnalyzeRequirementDocument({
      llm: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
      content: '完整需求文档',
      onEvent: (event) => events.push(event),
    })

    expect(createCompletion).toHaveBeenCalledTimes(2)
    expect(result.reasoningSummary).toContain('前半段分析')
    expect(result.reasoningSummary).toContain('后半段分析')
    const requests = createCompletion.mock.calls as unknown as Array<
      [{ messages?: Array<{ role: string; content: string }> }]
    >
    expect(
      requests[1]?.[0].messages?.find((message) => message.role === 'assistant')?.content,
    ).toBe(firstPass)
    expect(
      events.some((event) =>
        String((event.data as { message?: string }).message).includes('模型/网关单次输出上限'),
      ),
    ).toBe(true)
  })

  it('keeps continuing beyond the previous two-continuation limit', async () => {
    createCompletion
      .mockReturnValueOnce(
        completionStream([{ content: '[[INPUT_DOCUMENT_BEGIN]]\n第一段分析\n' }], 'length'),
      )
      .mockReturnValueOnce(completionStream([{ content: '第二段分析\n' }], 'length'))
      .mockReturnValueOnce(completionStream([{ content: '第三段分析\n' }], 'length'))
      .mockReturnValueOnce(
        completionStream([
          {
            content: '第四段分析\n[[INPUT_DOCUMENT_END]]\n[[REQUIREMENT_ANALYSIS_COMPLETE]]',
          },
        ]),
      )

    const result = await streamAnalyzeRequirementDocument({
      llm: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
      content: '需要多次续写的完整需求文档',
      onEvent: () => undefined,
    })

    expect(createCompletion).toHaveBeenCalledTimes(4)
    expect(result.reasoningSummary).toContain('第四段分析')
  })

  it('stops when repeated completions make no effective progress', async () => {
    config.requirementsNoProgressLimit = 2
    const repeated = `重复但未完成的分析内容${'。'.repeat(80)}`
    createCompletion.mockImplementation(() => completionStream([{ content: repeated }], 'length'))

    await expect(
      streamAnalyzeRequirementDocument({
        llm: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
        content: '需求文档',
        onEvent: () => undefined,
      }),
    ).rejects.toThrow('没有新增有效内容')
    expect(createCompletion).toHaveBeenCalledTimes(3)
  })

  it('removes a premature completion marker before restoring missing coverage', async () => {
    createCompletion
      .mockReturnValueOnce(
        completionStream([
          {
            content: '[[INPUT_DOCUMENT_BEGIN]]\n主体分析\n[[REQUIREMENT_ANALYSIS_COMPLETE]]',
          },
        ]),
      )
      .mockReturnValueOnce(
        completionStream([
          {
            content: '补充结论\n[[INPUT_DOCUMENT_END]]\n[[REQUIREMENT_ANALYSIS_COMPLETE]]',
          },
        ]),
      )

    const result = await streamAnalyzeRequirementDocument({
      llm: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
      content: '完整需求文档',
      onEvent: () => undefined,
    })

    expect(createCompletion).toHaveBeenCalledTimes(2)
    expect(result.reasoningSummary).toContain('主体分析')
    expect(result.reasoningSummary).toContain('补充结论')
    expect(result.reasoningSummary).not.toContain('REQUIREMENT_ANALYSIS_COMPLETE')
  })

  it('sends an oversized requirement in one unrestricted request', async () => {
    const source = `文档开头\n${'需求功能模块业务规则异常边界权限状态\n'.repeat(1500)}文档结尾`
    const implementation = (request: { messages?: Array<{ content?: unknown }> }) => {
      const messages = request.messages || []
      const userPrompt = String(messages[messages.length - 1]?.content || '')
      expect(userPrompt).toContain(source)
      return completionStream([
        {
          content: `${INPUT_RECEIPT}\n## 完整分析\n- 所有功能\n[[REQUIREMENT_ANALYSIS_COMPLETE]]`,
        },
      ])
    }
    createCompletion.mockImplementation(implementation as unknown as () => unknown)

    const events: Array<{ type: string; data: unknown }> = []
    const result = await streamAnalyzeRequirementDocument({
      llm: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
      content: source,
      fileName: 'large.md',
      onEvent: (event) => events.push(event),
    })

    expect(createCompletion).toHaveBeenCalledTimes(1)
    expect(result.reasoningSummary).toContain('所有功能')
    expect(
      events.some((event) =>
        /上下文预检|连续分段|覆盖校验/.test(String((event.data as { message?: string }).message)),
      ),
    ).toBe(false)
    const requests = createCompletion.mock.calls as unknown as Array<
      [{ max_tokens?: number; max_completion_tokens?: number }]
    >
    expect(
      requests.every(
        ([request]) => request.max_tokens == null && request.max_completion_tokens == null,
      ),
    ).toBe(true)
  })
})

describe('streamGenerateMindMap', () => {
  beforeEach(() => {
    createCompletion.mockReset()
    config.requirementsGenerationMaxDurationMs = 60_000
    config.requirementsNoProgressLimit = 3
    config.requirementsRetryBaseDelayMs = 0
  })

  it('streams delta + progressive mindmap snapshots and returns the final result', async () => {
    createCompletion.mockReturnValueOnce(
      completionStream([
        {
          content: ndjson(
            { type: 'meta', title: '账号系统', summary: '覆盖登录流程', root: '账号系统' },
            { type: 'node', path: ['账号管理', '登录'] },
            { type: 'node', path: ['账号管理', '退出'] },
            { type: 'complete', recordCount: 2 },
          ),
        },
        {
          content:
            '{"data":{"text":"账号系统"},"children":[{"data":{"text":"登录"},"children":[]}]},"title":"账号系统","summary":"覆盖登录流程","complete":true}',
        },
      ]),
    )

    const events: Array<{ type: string; data: unknown }> = []
    const result = await streamGenerateMindMap({
      llm: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
      content: '用户可以使用账号和密码登录。',
      fileName: 'account.md',
      reasoning: '## 功能模块\n- 登录与权限',
      onEvent: (event) => events.push(event),
    })

    const types = events.map((event) => event.type)
    const firstDelta = types.indexOf('delta')
    const firstMindMap = types.indexOf('mindmap')
    const resultEvent = types.indexOf('result')

    expect(createCompletion).toHaveBeenCalledTimes(1)
    expect(firstDelta).toBeGreaterThan(-1)
    expect(firstMindMap).toBeGreaterThan(-1)
    expect(firstMindMap).toBeLessThan(firstDelta)
    expect(resultEvent).toBeGreaterThan(firstDelta)
    expect(result.title).toBe('账号系统')
    expect(result.featureCount).toBe(3)

    const jsonOutput = events
      .filter((event) => event.type === 'delta')
      .map((event) => String((event.data as { content: string }).content))
      .join('')
    expect(() => JSON.parse(jsonOutput)).not.toThrow()

    const mapSnapshots = events
      .filter((event) => event.type === 'mindmap')
      .map((event) => event.data as { featureCount: number })
    expect(mapSnapshots[mapSnapshots.length - 1]?.featureCount).toBe(3)
  })

  it('keeps the complete analysis when it is longer than the old 8000-character limit', async () => {
    const longTail = '尾部功能点：审计导出与异常恢复'
    createCompletion.mockReturnValueOnce(
      completionStream([
        {
          content: `${INPUT_RECEIPT}\n前置分析\n${'中间内容'.repeat(2200)}\n${longTail}\n[[REQUIREMENT_ANALYSIS_COMPLETE]]`,
        },
      ]),
    )
    createCompletion.mockReturnValueOnce(
      completionStream([
        {
          content:
            '{"root":{"data":{"text":"系统"},"children":[{"data":{"text":"审计导出"},"children":[]}]},"title":"系统","summary":"摘要","complete":true}',
        },
      ]),
    )

    await streamAnalyzeRequirementDocument({
      llm: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
      content: '需求原文',
      onEvent: () => undefined,
    })
    await streamGenerateMindMap({
      llm: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
      content: '需求原文',
      reasoning: `前置分析\n${'中间内容'.repeat(2200)}\n${longTail}`,
      onEvent: () => undefined,
    })

    const calls = createCompletion.mock.calls as unknown as Array<
      [{ messages?: Array<{ role: string; content: string }> }]
    >
    const request = calls[1]?.[0]
    expect(request?.messages?.[1]?.content).toContain(longTail)
  })

  it('falls back immediately when a stopped response has no valid records', async () => {
    createCompletion
      .mockReturnValueOnce(
        completionStream([{ content: '{"root":{"data":{"text":"错误结果"},"children":[]}' }]),
      )
      .mockReturnValueOnce(
        completionStream([
          {
            content:
              '{"root":{"data":{"text":"账号系统"},"children":[{"data":{"text":"登录"},"children":[]}]},"title":"账号系统","summary":"覆盖登录流程","complete":true}',
          },
        ]),
      )

    const events: Array<{ type: string; data: unknown }> = []
    const result = await streamGenerateMindMap({
      llm: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
      content: '用户可以登录。',
      onEvent: (event) => events.push(event),
    })

    expect(createCompletion).toHaveBeenCalledTimes(1)
    expect(events.some((event) => event.type === 'reset')).toBe(false)
    expect(result.featureCount).toBeGreaterThan(0)
  })

  it('finalizes confirmed records when the model stops without a complete record', async () => {
    createCompletion.mockReturnValueOnce(
      completionStream([
        {
          content: ndjson(
            { type: 'meta', title: '账号系统', summary: '账号能力', root: '账号系统' },
            { type: 'node', path: ['账号管理', '登录'] },
          ),
        },
      ]),
    )

    const result = await streamGenerateMindMap({
      llm: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
      content: '账号需求',
      onEvent: () => undefined,
    })

    expect(createCompletion).toHaveBeenCalledTimes(1)
    expect(result.title).toBe('账号系统')
    expect(result.featureCount).toBe(2)

    const requests = createCompletion.mock.calls as unknown as Array<
      [{ messages?: Array<{ role: string; content: string }> }]
    >
    const request = requests[0]?.[0]
    const systemPrompt = request?.messages?.find((message) => message.role === 'system')?.content
    expect(systemPrompt).toContain('禁止输出测试方法')
    expect(systemPrompt).toContain('等价类划分')
    expect(systemPrompt).not.toContain('最多输出')
  })

  it('discards a cut-off NDJSON line and continues from confirmed records', async () => {
    createCompletion
      .mockReturnValueOnce(
        completionStream(
          [
            {
              content: ndjson(
                { type: 'meta', title: '账号系统', summary: '账号能力', root: '账号系统' },
                { type: 'node', path: ['登录'] },
              ),
            },
            {
              content:
                '{"root":{"data":{"text":"账号系统"},"children":[{"data":{"text":"登录"},"children":[]}',
            },
          ],
          'length',
        ),
      )
      .mockReturnValueOnce(
        completionStream([
          {
            content: ndjson({ type: 'node', path: ['退出'] }, { type: 'complete', recordCount: 2 }),
          },
          {
            content:
              ',{"data":{"text":"退出"},"children":[]}]},"title":"账号系统","summary":"账号能力","complete":true}',
          },
        ]),
      )

    const events: Array<{ type: string; data: unknown }> = []
    const result = await streamGenerateMindMap({
      llm: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
      content: '账号需求',
      onEvent: (event) => events.push(event),
    })

    expect(createCompletion).toHaveBeenCalledTimes(2)
    expect(result.featureCount).toBe(2)
    expect(events.some((event) => event.type === 'reset')).toBe(false)
    expect(
      events.some((event) =>
        String((event.data as { message?: string }).message).includes('模型/网关单次输出上限'),
      ),
    ).toBe(true)

    const calls = createCompletion.mock.calls as unknown as Array<[{ response_format?: unknown }]>
    expect(calls[0]?.[0].response_format).toBeUndefined()
    expect(calls[1]?.[0].response_format).toBeUndefined()
  })

  it('keeps continuing while length-limited passes add valid records', async () => {
    createCompletion
      .mockReturnValueOnce(
        completionStream(
          [
            {
              content: ndjson(
                { type: 'meta', title: '账号系统', summary: '账号能力', root: '账号系统' },
                { type: 'node', path: ['登录'] },
              ),
            },
          ],
          'length',
        ),
      )
      .mockReturnValueOnce(
        completionStream([{ content: ndjson({ type: 'node', path: ['退出'] }) }], 'length'),
      )
      .mockReturnValueOnce(
        completionStream([{ content: ndjson({ type: 'node', path: ['找回密码'] }) }], 'length'),
      )
      .mockReturnValueOnce(
        completionStream([{ content: ndjson({ type: 'complete', recordCount: 3 }) }]),
      )

    const result = await streamGenerateMindMap({
      llm: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
      content: '账号需求',
      onEvent: () => undefined,
    })

    expect(createCompletion).toHaveBeenCalledTimes(4)
    expect(result.featureCount).toBe(3)
  })

  it('finalizes confirmed records when repeated output stops making progress', async () => {
    const metaAndNode = ndjson(
      { type: 'meta', title: '账号系统', summary: '账号能力', root: '账号系统' },
      { type: 'node', path: ['登录'] },
    )
    const repeated = ndjson({ type: 'node', path: ['登录'] })
    createCompletion
      .mockReturnValueOnce(completionStream([{ content: metaAndNode }], 'length'))
      .mockReturnValueOnce(completionStream([{ content: repeated }], 'length'))
      .mockReturnValueOnce(completionStream([{ content: repeated }], 'length'))

    const events: Array<{ type: string; data: unknown }> = []
    const result = await streamGenerateMindMap({
      llm: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
      content: '账号需求',
      onEvent: (event) => events.push(event),
    })

    expect(createCompletion).toHaveBeenCalledTimes(2)
    expect(events.some((event) => event.type === 'reset')).toBe(false)
    expect(result.title).toBe('账号系统')
    expect(result.featureCount).toBe(1)
  })

  it('retries transient model errors and still respects cancellation', async () => {
    const transientError = Object.assign(new Error('rate limit'), { status: 429 })
    createCompletion.mockRejectedValueOnce(transientError).mockReturnValueOnce(
      completionStream([
        {
          content:
            '{"root":{"data":{"text":"账号系统"},"children":[]},"title":"账号系统","summary":"账号能力","complete":true}',
        },
      ]),
    )

    const events: Array<{ type: string; data: unknown }> = []
    const result = await streamGenerateMindMap({
      llm: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
      content: '账号需求',
      onEvent: (event) => events.push(event),
    })

    expect(createCompletion).toHaveBeenCalledTimes(2)
    expect(result.title).toBe('账号系统')
    expect(
      events.some((event) =>
        String((event.data as { message?: string }).message).includes('自动重试'),
      ),
    ).toBe(true)

    createCompletion.mockReset()
    createCompletion.mockRejectedValue(transientError)
    const controller = new AbortController()
    await expect(
      streamGenerateMindMap({
        llm: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
        content: '账号需求',
        signal: controller.signal,
        onEvent: (event) => {
          if (
            event.type === 'status' &&
            String((event.data as { message?: string }).message).includes('自动重试')
          ) {
            controller.abort()
          }
        },
      }),
    ).rejects.toThrow('已取消生成')
  })

  it('falls back to a deterministic tree when the total run time expires', async () => {
    config.requirementsGenerationMaxDurationMs = 20
    const implementation = (_request: unknown, options?: { signal?: AbortSignal }) =>
      (async function* () {
        yield await new Promise<never>((_resolve, reject) => {
          const signal = options?.signal
          if (signal?.aborted) {
            reject(signal.reason)
            return
          }
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      })()
    createCompletion.mockImplementation(implementation as unknown as () => unknown)

    const result = await streamGenerateMindMap({
      llm: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
      content: '账号需求',
      onEvent: () => undefined,
    })
    expect(result.featureCount).toBeGreaterThan(0)
  })

  it('reports reasoning-model progress before JSON content starts', async () => {
    createCompletion.mockReturnValueOnce(
      completionStream([
        { reasoning_content: '正在检查模块覆盖。' },
        {
          content:
            '{"root":{"data":{"text":"账号系统"},"children":[]},"title":"账号系统","summary":"账号能力","complete":true}',
        },
      ]),
    )

    const events: Array<{ type: string; data: unknown }> = []
    await streamGenerateMindMap({
      llm: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
      content: '账号需求',
      onEvent: (event) => events.push(event),
    })

    const reasoningStatus = events.findIndex(
      (event) =>
        event.type === 'status' &&
        String((event.data as { message?: string }).message).includes('梳理功能点层级'),
    )
    expect(reasoningStatus).toBeGreaterThan(-1)
    expect(reasoningStatus).toBeLessThan(events.findIndex((event) => event.type === 'delta'))
  })

  it('sends an oversized complete analysis to the model without compression', async () => {
    const reasoning = `分析开头\n${'功能模块业务规则异常边界权限状态与依赖\n'.repeat(1600)}分析结尾`
    const implementation = (request: { messages?: Array<{ content?: unknown }> }) => {
      const messages = request.messages || []
      const userPrompt = String(messages[messages.length - 1]?.content || '')
      expect(userPrompt).toContain(reasoning)
      return completionStream([
        {
          content:
            '{"root":{"data":{"text":"长需求"},"children":[{"data":{"text":"完整功能"},"children":[]}]},"title":"长需求","summary":"完整摘要","complete":true}',
        },
      ])
    }
    createCompletion.mockImplementation(implementation as unknown as () => unknown)

    const events: Array<{ type: string; data: unknown }> = []
    const result = await streamGenerateMindMap({
      llm: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
      content: '原始需求',
      reasoning,
      onEvent: (event) => events.push(event),
    })

    expect(createCompletion).toHaveBeenCalledTimes(1)
    expect(result.title).toBe('长需求')
    expect(
      events.some((event) =>
        /上下文预检|压缩|覆盖校验/.test(String((event.data as { message?: string }).message)),
      ),
    ).toBe(false)
  })

  it('sends an oversized raw document to the model in one request', async () => {
    const source = `原文开头\n${'超长需求原文，没有阶段一分析结果。'.repeat(3000)}\n原文结尾`
    const implementation = (request: { messages?: Array<{ content?: unknown }> }) => {
      const messages = request.messages || []
      expect(String(messages[messages.length - 1]?.content || '')).toContain(source)
      return completionStream([
        {
          content: ndjson(
            { type: 'meta', title: '超长需求', summary: '完整摘要', root: '超长需求' },
            { type: 'node', path: ['完整功能'] },
            { type: 'complete', recordCount: 1 },
          ),
        },
      ])
    }
    createCompletion.mockImplementation(implementation as unknown as () => unknown)

    const result = await streamGenerateMindMap({
      llm: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
      content: source,
      onEvent: () => undefined,
    })
    expect(result.featureCount).toBeGreaterThan(0)
    expect(createCompletion).toHaveBeenCalledTimes(1)
  })
})
