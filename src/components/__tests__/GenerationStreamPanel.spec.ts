import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import GenerationStreamPanel from '../requirements/GenerationStreamPanel.vue'

describe('GenerationStreamPanel', () => {
  it('renders analysis and JSON output as separate messages', () => {
    const wrapper = mount(GenerationStreamPanel, {
      props: {
        title: 'AI 正在分析功能点',
        messages: [
          {
            id: 'reasoning',
            role: 'assistant',
            kind: 'reasoning',
            content: '## 需求目标\n识别可测试的业务流程。',
            streaming: false,
          },
          {
            id: 'result',
            role: 'assistant',
            kind: 'result',
            content: '{"title":"示例","root":{"data":{"text":"示例"}}}',
            streaming: true,
          },
        ],
        running: true,
      },
    })

    expect(wrapper.text()).toContain('AI 分析过程')
    expect(wrapper.text()).toContain('结构化 JSON')
    expect(wrapper.find('.markdown-body h2').text()).toBe('需求目标')
    expect(wrapper.find('.raw-output').text()).toContain('"title":"示例"')
  })

  it('expands and collapses each message independently', async () => {
    const wrapper = mount(GenerationStreamPanel, {
      props: {
        title: 'AI 正在分析功能点',
        messages: [
          {
            id: 'reasoning',
            role: 'assistant',
            kind: 'reasoning',
            content: '分析内容',
            streaming: false,
          },
          {
            id: 'result',
            role: 'assistant',
            kind: 'result',
            content: '{"ok":true}',
            streaming: false,
          },
        ],
        running: true,
      },
    })

    const messages = wrapper.findAll('.message')
    const toggles = wrapper.findAll('.meta')

    expect(toggles[0]?.attributes('aria-expanded')).toBe('true')
    expect(messages[0]?.find('.markdown-body').exists()).toBe(true)
    expect(messages[1]?.find('.raw-output').exists()).toBe(true)

    await toggles[0]?.trigger('click')

    expect(toggles[0]?.attributes('aria-expanded')).toBe('false')
    expect(messages[0]?.classes()).toContain('collapsed')
    expect(messages[0]?.find('.markdown-body').exists()).toBe(false)
    expect(messages[1]?.find('.raw-output').exists()).toBe(true)

    await toggles[0]?.trigger('click')

    expect(toggles[0]?.attributes('aria-expanded')).toBe('true')
    expect(messages[0]?.find('.markdown-body').text()).toContain('分析内容')
  })
})
