import { describe, expect, it } from 'vitest'
import { normalizeImportedTestCases } from '@/utils/testCases'

describe('normalizeImportedTestCases', () => {
  it('imports the JSON format exported by the requirements page', () => {
    const imported = normalizeImportedTestCases({
      title: '登录测试用例',
      summary: '覆盖账号登录',
      caseCount: 1,
      cases: [
        {
          id: 'TC-LOGIN-001',
          feature: '登录',
          featurePath: '账号 / 登录',
          title: '账号密码登录',
          priority: 'P0',
          type: '功能',
          preconditions: '已有可用账号',
          steps: ['打开登录页', '输入账号密码并提交'],
          expected: '登录成功',
          note: '主流程',
        },
      ],
    })

    expect(imported.title).toBe('登录测试用例')
    expect(imported.summary).toBe('覆盖账号登录')
    expect(imported.cases).toEqual([
      {
        id: 'TC-LOGIN-001',
        feature: '登录',
        featurePath: '账号 / 登录',
        title: '账号密码登录',
        priority: 'P0',
        type: '功能',
        preconditions: '已有可用账号',
        steps: ['打开登录页', '输入账号密码并提交'],
        expected: '登录成功',
        note: '主流程',
      },
    ])
  })

  it('accepts a bare array and fills editable defaults', () => {
    const imported = normalizeImportedTestCases([
      {
        feature: '搜索',
        priority: 'p2',
        steps: '1. 输入关键词\n2. 点击搜索',
      },
    ])

    expect(imported.title).toBe('导入的测试用例')
    expect(imported.cases[0]).toMatchObject({
      id: 'TC-001',
      feature: '搜索',
      featurePath: '搜索',
      title: '用例 1',
      priority: 'P2',
      type: '功能',
      steps: ['输入关键词', '点击搜索'],
      expected: '',
    })
  })

  it('rejects payloads without a non-empty cases array', () => {
    expect(() => normalizeImportedTestCases({ title: '无用例' })).toThrow('未找到 cases 用例数组')
    expect(() => normalizeImportedTestCases({ cases: [] })).toThrow('没有可导入的测试用例')
  })

  it('reports the index of invalid case entries', () => {
    expect(() => normalizeImportedTestCases({ cases: [{ title: '有效' }, null] })).toThrow(
      '第 2 条测试用例格式不正确',
    )
  })
})
