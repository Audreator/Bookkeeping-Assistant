/** 集成测试会清空表，只允许显式配置独立的测试库。 */
export function requireTestDatabaseUrl(test: string | undefined, production: string): string {
  if (!test) throw new Error('集成测试必须配置独立的 TEST_DATABASE_URL，禁止使用生产库')
  const target = new URL(test)
  const live = new URL(production)
  if (!target.pathname.endsWith('_test') || (target.host === live.host && target.pathname === live.pathname)) {
    throw new Error('TEST_DATABASE_URL 必须指向独立的 _test 数据库')
  }
  return test
}
