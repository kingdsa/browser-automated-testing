import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MessageList from '../chat/MessageList.vue'
import type { ChatMessageItem } from '@/types/chat'

const baseMessages: ChatMessageItem[] = [
  {
    id: 'u1',
    role: 'user',
    content: '请测试首页',
    createdAt: 1,
  },
  {
    id: 'a1',
    role: 'assistant',
    content: '先打开页面\n\n# 测试报告\n结论通过',
    streaming: false,
    createdAt: 2,
    segments: [
      {
        id: 's1',
        kind: 'analysis',
        content: '先打开页面，检查布局。',
        streaming: false,
      },
      {
        id: 's2',
        kind: 'report',
        content: '# 测试报告\n结论通过',
        streaming: false,
      },
    ],
    tools: [
      {
        id: 't1',
        name: 'open_url',
        summary: '已打开页面',
        ok: true,
        status: 'done',
      },
    ],
  },
]

describe('MessageList', () => {
  it('renders analysis, tools and final report as separate collapsible blocks', async () => {
    const wrapper = mount(MessageList, {
      props: { messages: baseMessages },
      attachTo: document.body,
    })

    const titles = wrapper.findAll('.role').map((node) => node.text())
    expect(titles).toContain('你')
    expect(titles).toContain('AI 分析过程')
    expect(titles).toContain('工具调用')
    expect(titles).toContain('最终 Markdown 报告')
    expect(wrapper.text()).toContain('先打开页面，检查布局。')
    expect(wrapper.text()).toContain('open_url')
    expect(wrapper.text()).toContain('测试报告')

    const analysisToggle = wrapper.findAll('.meta').find((node) => node.text().includes('AI 分析过程'))
    expect(analysisToggle?.attributes('aria-expanded')).toBe('true')

    await analysisToggle?.trigger('click')
    expect(analysisToggle?.attributes('aria-expanded')).toBe('false')
    expect(wrapper.findAll('.message.analysis.collapsed').length).toBe(1)
    expect(wrapper.text()).not.toContain('先打开页面，检查布局。')
    // Tools remain visible after collapsing analysis.
    expect(wrapper.text()).toContain('open_url')
    expect(wrapper.text()).toContain('测试报告')

    await analysisToggle?.trigger('click')
    expect(wrapper.text()).toContain('先打开页面，检查布局。')
    expect(wrapper.text()).toContain('open_url')

    wrapper.unmount()
  })
})
