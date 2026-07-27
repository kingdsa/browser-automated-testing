import { describe, expect, it } from 'vitest'
import type { ChatMessageItem } from '@/types/chat'
import { getLastAssistantMarkdown } from '../report'

describe('getLastAssistantMarkdown', () => {
  it('saves only final report segments and ignores analysis', () => {
    const messages: ChatMessageItem[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: '过程分析\n\n# 报告\n通过',
        streaming: false,
        createdAt: 1,
        segments: [
          { id: 's1', kind: 'analysis', content: '过程分析', streaming: false },
          { id: 's2', kind: 'report', content: '# 报告\n通过', streaming: false },
        ],
      },
    ]

    expect(getLastAssistantMarkdown(messages)).toBe('# 报告\n通过')
  })

  it('does not fall back to analysis when report segment is missing', () => {
    const messages: ChatMessageItem[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: '只有过程',
        streaming: false,
        createdAt: 1,
        segments: [{ id: 's1', kind: 'analysis', content: '只有过程', streaming: false }],
      },
    ]

    expect(getLastAssistantMarkdown(messages)).toBeNull()
  })

  it('keeps legacy content fallback when segments are absent', () => {
    const messages: ChatMessageItem[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: '# 旧版整段输出',
        streaming: false,
        createdAt: 1,
      },
    ]

    expect(getLastAssistantMarkdown(messages)).toBe('# 旧版整段输出')
  })
})
