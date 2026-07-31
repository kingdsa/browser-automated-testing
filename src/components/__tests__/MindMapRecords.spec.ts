import { describe, expect, it } from 'vitest'
import {
  buildDeterministicMindMap,
  StreamingMindMapRecordParser,
} from '../../../server/src/requirements/mindMapRecords'

function line(record: Record<string, unknown>): string {
  return `${JSON.stringify(record)}\n`
}

describe('StreamingMindMapRecordParser', () => {
  it('keeps confirmed records and discards a truncated final line', () => {
    const snapshots: Array<{ featureCount: number }> = []
    const parser = new StreamingMindMapRecordParser('account.md', (snapshot) =>
      snapshots.push(snapshot),
    )

    parser.write(line({ type: 'meta', title: '账号系统', summary: '账号能力', root: '账号系统' }))
    parser.write(line({ type: 'node', path: ['账号管理', '登录'] }))
    parser.write('{"type":"node","path":["被截断')
    parser.finishPass()

    expect(parser.recordCount).toBe(1)
    expect(parser.complete).toBe(false)

    parser.write(line({ type: 'node', path: ['账号管理', '退出'] }))
    parser.write(line({ type: 'complete', recordCount: 2 }))
    parser.finishPass()

    expect(parser.complete).toBe(true)
    expect(parser.toResult()).toMatchObject({
      title: '账号系统',
      featureCount: 3,
      root: {
        children: [
          {
            data: { text: '账号管理' },
            children: [{ data: { text: '登录' } }, { data: { text: '退出' } }],
          },
        ],
      },
    })
    expect(snapshots.length).toBeGreaterThan(1)
  })

  it('deduplicates repeated paths and accepts a complete legacy JSON result', () => {
    const parser = new StreamingMindMapRecordParser('account.md', () => undefined)
    parser.write(line({ type: 'meta', title: '账号系统', summary: '账号能力', root: '账号系统' }))
    parser.write(line({ type: 'node', path: ['登录'] }))
    parser.write(line({ type: 'node', path: ['登录'] }))
    parser.finishPass()
    expect(parser.recordCount).toBe(1)

    const legacy = new StreamingMindMapRecordParser('legacy.md', () => undefined)
    legacy.write(
      JSON.stringify({
        root: { data: { text: '旧格式' }, children: [{ data: { text: '功能' }, children: [] }] },
        title: '旧格式',
        summary: '兼容结果',
        complete: true,
      }),
    )
    legacy.finishPass()
    expect(legacy.complete).toBe(true)
    expect(legacy.toResult().featureCount).toBe(1)
  })

})

describe('buildDeterministicMindMap', () => {
  it('builds a drawable hierarchy from markdown headings and bullets', () => {
    const result = buildDeterministicMindMap(
      'account.md',
      ['# 账号系统', '## 登录模块', '- 密码登录：校验账号密码', '  - 错误锁定', '- 退出登录'].join(
        '\n',
      ),
    )

    expect(result.title).toBe('账号系统')
    expect(result.featureCount).toBeGreaterThanOrEqual(4)
    expect(result.root.children?.[0]).toMatchObject({
      data: { text: '登录模块' },
    })
  })
})
