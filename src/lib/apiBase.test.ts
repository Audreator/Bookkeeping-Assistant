import { describe, expect, it } from 'vitest'
import { resolveApiPrefix } from './apiBase'

describe('API 部署前缀', () => {
  it('显式前缀优先于当前页面目录，并去掉结尾斜线', () => {
    expect(resolveApiPrefix('/gateway/', './', 'https://example.com/budget/#/login')).toBe('/gateway')
  })

  it.each([
    ['https://example.com/budget/#/login', '/budget'],
    ['https://example.com/budget/index.html#/settings', '/budget'],
    ['https://example.com/budget/?from=home#/login', '/budget'],
    ['https://example.com/team/ledger/#/', '/team/ledger'],
    ['http://localhost:8794/#/login', ''],
  ])('未配置时跟随页面目录：%s', (pageUrl, prefix) => {
    expect(resolveApiPrefix(undefined, './', pageUrl)).toBe(prefix)
  })

  it('空配置仍跟随部署目录', () => {
    expect(resolveApiPrefix('', './', 'https://example.com/budget/#/login')).toBe('/budget')
  })

  it('支持 Vite 的绝对 base', () => {
    expect(resolveApiPrefix(undefined, '/budget/', 'https://example.com/#/login')).toBe('/budget')
  })

  it('可用斜线显式指定根 API', () => {
    expect(resolveApiPrefix('/', './', 'https://example.com/budget/#/login')).toBe('')
  })
})
