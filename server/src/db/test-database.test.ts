// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { requireTestDatabaseUrl } from './test-database.ts'

describe('测试数据库隔离保护', () => {
  const production = 'mysql://user:pass@localhost:3306/jizhang'
  it('必须显式配置测试库，禁止回退生产库', () => {
    expect(() => requireTestDatabaseUrl(undefined, production)).toThrow('TEST_DATABASE_URL')
  })
  it('拒绝与生产相同或未标记为测试的数据库', () => {
    expect(() => requireTestDatabaseUrl(production, production)).toThrow()
    expect(() => requireTestDatabaseUrl('mysql://u:p@localhost/accounts', production)).toThrow()
  })
  it('仅允许独立的 _test 数据库', () => {
    const test = 'mysql://user:pass@localhost:3306/jizhang_test'
    expect(requireTestDatabaseUrl(test, production)).toBe(test)
  })
})
