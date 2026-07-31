import { describe, expect, it } from 'vitest'
import {
  StreamingMindMapParser,
  type MindMapProgressSnapshot,
} from '../../../server/src/requirements/streamMindMap'

describe('StreamingMindMapParser', () => {
  it('emits safe snapshots as nodes become complete across arbitrary chunks', () => {
    const snapshots: MindMapProgressSnapshot[] = []
    const parser = new StreamingMindMapParser((snapshot) => snapshots.push(snapshot))

    const chunks = [
      '```json\n{"title":"账号系统","summary":"覆盖登录和安全",',
      '"root":{"data":{"te',
      'xt":"账号系统"},"children":[',
      '{"data":{"text":"登录","note":"校验账号密码"},"children":[]},',
      '{"data":{"text":"退出"},"children":[]}',
      ']}}\n```',
    ]

    for (const chunk of chunks) parser.write(chunk)

    expect(snapshots.length).toBeGreaterThanOrEqual(3)
    expect(snapshots[0]).toMatchObject({
      title: '账号系统',
      summary: '覆盖登录和安全',
      featureCount: 0,
      root: { data: { text: '账号系统' }, children: [] },
    })
    expect(snapshots.some((snapshot) => snapshot.featureCount === 1)).toBe(true)
    expect(snapshots[snapshots.length - 1]).toMatchObject({
      featureCount: 2,
      root: {
        children: [{ data: { text: '登录', note: '校验账号密码' } }, { data: { text: '退出' } }],
      },
    })
  })

  it('does not expose a node until its text value is complete', () => {
    const snapshots: MindMapProgressSnapshot[] = []
    const parser = new StreamingMindMapParser((snapshot) => snapshots.push(snapshot))

    parser.write('{"root":{"data":{"text":"未完')
    expect(snapshots).toHaveLength(0)

    parser.write('成前不会出现"},"children":[]}}')
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.root.data.text).toBe('未完成前不会出现')
  })

  it('ignores prose braces before the actual JSON document', () => {
    const snapshots: MindMapProgressSnapshot[] = []
    const parser = new StreamingMindMapParser((snapshot) => snapshots.push(snapshot))

    parser.write('推理示例 {not-json}，最终结果如下：\n')
    parser.write('{"root":{"data":{"text":"真实需求"},"children":[]},')
    parser.write('"title":"真实需求","summary":"摘要","complete":true}')

    expect(snapshots.length).toBeGreaterThan(0)
    expect(snapshots[snapshots.length - 1]?.title).toBe('真实需求')
  })
})
