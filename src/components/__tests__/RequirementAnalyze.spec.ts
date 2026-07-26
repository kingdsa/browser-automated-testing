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

import { streamAnalyzeRequirementDocument } from '../../../server/src/requirements/analyze'

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

  it('streams visible analysis before keeping the final JSON in result deltas', async () => {
    createCompletion
      .mockReturnValueOnce(
        completionStream([
          { reasoning_content: '正在识别核心流程。' },
          { content: '## 功能模块\n- 登录与权限' },
        ]),
      )
      .mockReturnValueOnce(
        completionStream([
          { content: '{"title":"账号系统","summary":"覆盖登录流程","root":' },
          {
            content:
              '{"data":{"text":"账号系统"},"children":[{"data":{"text":"登录"},"children":[]}]}}',
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
    const firstReasoning = types.indexOf('reasoning')
    const firstDelta = types.indexOf('delta')
    const resultEvent = types.indexOf('result')

    expect(createCompletion).toHaveBeenCalledTimes(2)
    expect(firstReasoning).toBeGreaterThan(-1)
    expect(firstDelta).toBeGreaterThan(firstReasoning)
    expect(resultEvent).toBeGreaterThan(firstDelta)
    expect(result.title).toBe('账号系统')
    expect(result.featureCount).toBe(1)

    const jsonOutput = events
      .filter((event) => event.type === 'delta')
      .map((event) => String((event.data as { content: string }).content))
      .join('')
    expect(() => JSON.parse(jsonOutput)).not.toThrow()
    expect(jsonOutput).not.toContain('正在识别核心流程')
  })
})
