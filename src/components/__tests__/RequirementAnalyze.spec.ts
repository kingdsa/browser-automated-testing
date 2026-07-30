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

import { streamAnalyzeRequirementDocument, streamGenerateMindMap } from '../../../server/src/requirements/analyze'

function completionStream(deltas: Array<Record<string, unknown>>) {
  return (async function* () {
    for (const delta of deltas) {
      yield { choices: [{ delta }] }
    }
  })()
}

describe('streamAnalyzeRequirementDocument', () => {
  beforeEach(() => {
    createCompletion.mockReset()
  })

  it('streams reasoning only and returns the accumulated reasoning summary', async () => {
    createCompletion.mockReturnValueOnce(
      completionStream([
        { reasoning_content: '正在识别核心流程。' },
        { content: '## 功能模块\n- 登录与权限' },
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
    expect((resultEvent?.data as { reasoningSummary: string }).reasoningSummary).toContain(
      '登录与权限',
    )
    expect(result.reasoningSummary).toContain('登录与权限')
  })
})

describe('streamGenerateMindMap', () => {
  beforeEach(() => {
    createCompletion.mockReset()
  })

  it('streams delta + progressive mindmap snapshots and returns the final result', async () => {
    createCompletion.mockReturnValueOnce(
      completionStream([
        { content: '{"title":"账号系统","summary":"覆盖登录流程","root":' },
        {
          content:
            '{"data":{"text":"账号系统"},"children":[{"data":{"text":"登录"},"children":[]}]}}',
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
    expect(firstMindMap).toBeGreaterThan(firstDelta)
    expect(resultEvent).toBeGreaterThan(firstMindMap)
    expect(result.title).toBe('账号系统')
    expect(result.featureCount).toBe(1)

    const jsonOutput = events
      .filter((event) => event.type === 'delta')
      .map((event) => String((event.data as { content: string }).content))
      .join('')
    expect(() => JSON.parse(jsonOutput)).not.toThrow()

    const mapSnapshots = events
      .filter((event) => event.type === 'mindmap')
      .map((event) => event.data as { featureCount: number })
    expect(mapSnapshots[mapSnapshots.length - 1]?.featureCount).toBe(1)
  })
})
