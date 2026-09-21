import { afterEach, describe, expect, it, vi } from 'vitest'
import { JevClient, resolveJevSettings } from '../client.js'
import { assessAgentStep, verifyTestSteps, JEV_POLICY } from '../decisions.js'

function answerPayload(answers: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ model: 'jev-test', answers, usage: {} }),
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('resolveJevSettings', () => {
  it('is disabled without an api key and falls back to defaults', () => {
    const settings = resolveJevSettings({ apiKey: '' })
    expect(settings.baseUrl).toContain('api.typesafe.ai')
    expect(settings.model).toBe('jev-latest')
  })

  it('respects an explicit enabled=false', () => {
    const settings = resolveJevSettings({ enabled: false, apiKey: 'ts-x' })
    expect(settings.enabled).toBe(false)
  })
})

describe('JevClient', () => {
  it('does not call the API when inactive', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const client = new JevClient(resolveJevSettings({ apiKey: '' }))
    const answers = await client.ask({ a: 1 }, { q: { type: 'noul', instructions: 'x?' } })
    expect(answers).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts to the normalized systemone endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(answerPayload({ q: { type: 'noul', noul: 0.9 } }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new JevClient(resolveJevSettings({ apiKey: 'ts-key', baseUrl: 'https://api.typesafe.ai' }))
    const answers = await client.ask({ state: 'x' }, { q: { type: 'noul', instructions: 'x?' } })

    expect(answers?.q).toMatchObject({ type: 'noul', noul: 0.9 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.typesafe.ai/v1/systemone')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ts-key')
  })

  it('degrades to null and reports a note when the API keeps failing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      headers: { get: () => null },
      text: async () => 'bad request',
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const notes: string[] = []
    const client = new JevClient(resolveJevSettings({ apiKey: 'ts-key' }), {
      maxRetries: 0,
      onNote: (message) => notes.push(message),
    })

    const answers = await client.ask({ state: 'x' }, { q: { type: 'noul', instructions: 'x?' } })
    expect(answers).toBeNull()
    expect(notes[0]).toContain('Jev 不可用')
  })
})

describe('assessAgentStep', () => {
  it('only fast-paths read-only tools above the confidence threshold', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      answerPayload({
        next_step: {
          type: 'choice',
          choice: 'get_console_logs',
          confidence: JEV_POLICY.fastPathConfidence + 0.05,
          probabilities: {},
        },
        enough_evidence: { type: 'noul', noul: 0.2 },
        defect_evidence: { type: 'noul', noul: 0.9 },
        severity: { type: 'score', score: 2, confidence: 0.9, legend: {}, probabilities: {} },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = new JevClient(resolveJevSettings({ apiKey: 'ts-key' }))
    const assessment = await assessAgentStep(client, {
      goal: '测试登录页',
      recentToolSummaries: ['get_page_snapshot: ok'],
    })

    expect(assessment?.nextTool?.name).toBe('get_console_logs')
    expect(assessment?.defectEvidence).toBe(true)
    expect(assessment?.severity).toBe(2)
  })

  it('escalates to the LLM when Jev confidence is low or the tool is mutating', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      answerPayload({
        next_step: { type: 'choice', choice: 'click', confidence: 0.99, probabilities: {} },
        enough_evidence: { type: 'noul', noul: 0.1 },
        defect_evidence: { type: 'noul', noul: 0.1 },
        severity: { type: 'score', score: 0, confidence: 0.5, legend: {}, probabilities: {} },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = new JevClient(resolveJevSettings({ apiKey: 'ts-key' }))
    const assessment = await assessAgentStep(client, { goal: 'x', recentToolSummaries: [] })
    expect(assessment?.nextTool).toBeNull()
  })
})

describe('verifyTestSteps', () => {
  it('flags steps below the concrete threshold', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      answerPayload({
        step_0: { type: 'noul', noul: 0.95 },
        step_1: { type: 'noul', noul: 0.1 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = new JevClient(resolveJevSettings({ apiKey: 'ts-key' }))
    const result = await verifyTestSteps(client, ['点击右上角「删除」按钮', '完成主流程'])
    expect(result?.vagueSteps).toEqual(['完成主流程'])
  })
})