import { describe, it, expect } from 'vitest'
import {
  buildConcreteSteps,
  extractVerifiedPaths,
  isVagueStep,
  normalizeCases,
  normalizeStepList,
  pickPathForFeature,
} from '../stepBuilder.js'

describe('isVagueStep', () => {
  it('flags "相关入口/主流程" style wording', () => {
    expect(isVagueStep('进入「删除用户」相关入口')).toBe(true)
    expect(isVagueStep('按照页面实际路径完成主流程')).toBe(true)
    expect(isVagueStep('执行与功能点相关的操作')).toBe(true)
    expect(isVagueStep('')).toBe(true)
  })

  it('keeps concrete browser-action steps', () => {
    expect(isVagueStep('选择左侧菜单「用户管理」')).toBe(false)
    expect(isVagueStep('点击右上角「删除」按钮')).toBe(false)
    expect(isVagueStep('在确认弹窗中点击「确定」')).toBe(false)
  })
})

describe('normalizeStepList', () => {
  it('strips numeric prefixes and dedupes', () => {
    expect(normalizeStepList(['1. 打开页面', '2. 打开页面', '3. 点击删除'])).toEqual([
      '打开页面',
      '点击删除',
    ])
  })

  it('splits compound arrow steps', () => {
    expect(normalizeStepList(['打开页面 -> 点击删除 -> 确认'])).toEqual([
      '打开页面',
      '点击删除',
      '确认',
    ])
  })
})

describe('extractVerifiedPaths', () => {
  it('parses numbered atomic steps under a labeled path', () => {
    const notes = [
      '### 已验证路径',
      '- 路径 1：删除用户',
      '  1. 选择左侧菜单「用户管理」',
      '  2. 在用户列表勾选一条记录',
      '  3. 点击右上角「删除」',
      '  4. 在确认弹窗点击「确定」',
      '  5. 查看列表该用户是否消失',
      '### 与功能点对应关系',
      '- 删除用户：找到入口',
    ].join('\n')

    const paths = extractVerifiedPaths(notes)
    expect(paths).toHaveLength(1)
    expect(paths[0]).not.toContain('删除用户') // title is a label, not a step
    expect(paths[0][0]).toBe('选择左侧菜单「用户管理」')
    expect(paths[0]).toContain('点击右上角「删除」')
    expect(paths[0]).toContain('在确认弹窗点击「确定」')
  })

  it('parses inline arrow path', () => {
    const notes = '- 路径 1：选择菜单「订单」 -> 点击「导出」 -> 查看下载'
    const paths = extractVerifiedPaths(notes)
    expect(paths[0]).toEqual(['选择菜单「订单」', '点击「导出」', '查看下载'])
  })
})

describe('pickPathForFeature', () => {
  it('matches the path whose steps mention the feature token', () => {
    const paths = [
      ['选择菜单「商品」', '点击「上架」'],
      ['选择菜单「用户管理」', '点击「删除」'],
    ]
    const feature = { path: '用户管理 / 删除用户', text: '删除用户' }
    const picked = pickPathForFeature(feature, paths)
    expect(picked).toEqual(paths[1])
  })
})

describe('buildConcreteSteps', () => {
  const feature = { path: '用户管理 / 删除用户', text: '删除用户' }

  it('reuses verified path from exploration notes for main flow', () => {
    const notes = [
      '### 已验证路径',
      '- 路径 1：删除用户',
      '  1. 选择左侧菜单「用户管理」',
      '  2. 勾选一条用户',
      '  3. 点击右上角「删除」',
      '  4. 在确认弹窗点击「确定」',
    ].join('\n')
    const steps = buildConcreteSteps(feature, { exploration: { notes } })
    expect(steps[0]).toBe('选择左侧菜单「用户管理」')
    expect(steps).toContain('点击右上角「删除」')
    expect(steps).toContain('在确认弹窗点击「确定」')
    // appends a view-result assertion when path lacks one
    expect(steps[steps.length - 1]).toMatch(/查看/)
  })

  it('falls back to generic menu->object->button->confirm flow without exploration', () => {
    const steps = buildConcreteSteps(feature)
    expect(steps.join(' ')).toMatch(/菜单|按钮|确认弹窗|查看/)
    expect(steps.some((step) => /相关入口/.test(step))).toBe(false)
  })
})

describe('normalizeCases', () => {
  const features = [{ path: '用户管理 / 删除用户', text: '删除用户' }]

  it('replaces vague steps with concrete browser actions', () => {
    const cases = normalizeCases(
      [
        {
          feature: '删除用户',
          title: '删除用户 - 正常',
          type: '功能',
          steps: ['进入「删除用户」相关入口', '完成主流程操作', '检查页面反馈与数据结果'],
          expected: '删除成功',
        },
      ],
      features,
    )
    const steps = cases[0].steps
    expect(steps.some((step) => /相关入口|主流程/.test(step))).toBe(false)
    expect(steps.length).toBeGreaterThanOrEqual(3)
    expect(steps.some((step) => /菜单|点击|确认/.test(step))).toBe(true)
  })

  it('keeps already-concrete steps intact', () => {
    const concrete = [
      '选择左侧菜单「用户管理」',
      '勾选一条用户',
      '点击右上角「删除」',
      '在确认弹窗点击「确定」',
      '查看列表该用户是否消失',
    ]
    const cases = normalizeCases(
      [
        {
          feature: '删除用户',
          title: '删除用户 - 正常',
          type: '功能',
          steps: concrete,
          expected: '删除成功',
        },
      ],
      features,
    )
    expect(cases[0].steps).toEqual(concrete)
  })

  it('enriches from verified path when model steps are too few', () => {
    const notes = [
      '### 已验证路径',
      '- 路径 1：删除用户',
      '  1. 选择左侧菜单「用户管理」',
      '  2. 勾选一条用户',
      '  3. 点击右上角「删除」',
      '  4. 在确认弹窗点击「确定」',
      '  5. 查看列表该用户是否消失',
    ].join('\n')
    const cases = normalizeCases(
      [
        {
          feature: '删除用户',
          title: '删除用户 - 正常',
          type: '功能',
          steps: ['打开页面'],
          expected: '删除成功',
        },
      ],
      features,
      { notes },
    )
    expect(cases[0].steps).toContain('选择左侧菜单「用户管理」')
    expect(cases[0].steps).toContain('在确认弹窗点击「确定」')
  })
})
