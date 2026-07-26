import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { MindMapNode } from '@/types/requirements'

const mindMapMock = vi.hoisted(() => ({
  data: null as unknown,
  options: null as Record<string, unknown> | null,
  handlers: new Map<string, (...args: unknown[]) => void>(),
  setData: vi.fn<(data: unknown) => void>(),
  updateData: vi.fn<(data: unknown) => void>(),
}))

vi.mock('simple-mind-map', () => ({
  default: class MockMindMap {
    view = {
      fit: vi.fn<() => void>(),
    }

    constructor(options: Record<string, unknown>) {
      let nextUid = 0
      const addNodeIds = (node: MindMapNode): unknown => ({
        data: { ...node.data, uid: `node-${nextUid++}`, isActive: false },
        children: (node.children || []).map(addNodeIds),
      })

      mindMapMock.options = options
      mindMapMock.data = {
        ...(addNodeIds(options.data as MindMapNode) as Record<string, unknown>),
        smmVersion: 'test',
      }
    }

    on(event: string, callback: (...args: unknown[]) => void) {
      mindMapMock.handlers.set(event, callback)
    }

    off() {}

    setData(data: unknown) {
      mindMapMock.setData(data)
    }

    updateData(data: unknown) {
      mindMapMock.updateData(data)
      mindMapMock.data = data
      mindMapMock.handlers.get('node_tree_render_start')?.()
    }

    setMode() {}

    getData() {
      return mindMapMock.data
    }

    resize() {}

    render(callback?: () => void) {
      callback?.()
    }

    destroy() {}
  },
}))

import FeatureMindMap from '../requirements/FeatureMindMap.vue'

interface NoteTooltipController {
  show: (content: unknown, left: number, top: number) => Promise<void>
  hide: () => void
}

const initialMap: MindMapNode = {
  data: { text: '账号系统', expand: true },
  children: [
    {
      data: { text: '登录', note: '校验账号和密码', expand: true },
      children: [],
    },
  ],
}

describe('FeatureMindMap', () => {
  let wrapper: VueWrapper | null = null

  beforeEach(() => {
    mindMapMock.data = null
    mindMapMock.options = null
    mindMapMock.handlers.clear()
    mindMapMock.setData.mockClear()
    mindMapMock.updateData.mockClear()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.unstubAllGlobals()
  })

  it('updates streaming snapshots without clearing the canvas', async () => {
    wrapper = mount(FeatureMindMap, {
      props: { modelValue: initialMap, readonly: true },
    })
    await vi.waitFor(() => expect(wrapper?.emitted('ready')).toHaveLength(1))

    await wrapper.setProps({
      modelValue: {
        ...initialMap,
        children: [
          ...(initialMap.children || []),
          { data: { text: '退出', expand: true }, children: [] },
        ],
      },
    })

    expect(mindMapMock.setData).not.toHaveBeenCalled()
    expect(mindMapMock.updateData).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        data: expect.objectContaining({ uid: 'node-0' }),
        children: [
          expect.objectContaining({ data: expect.objectContaining({ uid: 'node-1' }) }),
          expect.objectContaining({
            data: expect.not.objectContaining({ uid: expect.anything() }),
          }),
        ],
      }),
    )
  })

  it('uses a custom note tooltip and hides it when rendering starts', async () => {
    wrapper = mount(FeatureMindMap, {
      props: { modelValue: initialMap, readonly: true },
    })
    await vi.waitFor(() => expect(wrapper?.emitted('ready')).toHaveLength(1))

    const tooltipController = mindMapMock.options?.customNoteContentShow as NoteTooltipController
    await tooltipController.show('校验账号和密码', 120, 160)
    await nextTick()

    const tooltip = document.body.querySelector<HTMLElement>('.mindmap-note-tooltip')
    expect(tooltip?.textContent?.trim()).toBe('校验账号和密码')
    expect(tooltip?.style.display).not.toBe('none')

    mindMapMock.handlers.get('node_tree_render_start')?.()
    await nextTick()

    expect(tooltip?.style.display).toBe('none')
  })
})
