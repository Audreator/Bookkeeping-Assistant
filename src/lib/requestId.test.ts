import { afterEach, expect, it, vi } from 'vitest'
import { makeRequestId } from './requestId'

afterEach(() => vi.unstubAllGlobals())
it('局域网 HTTP 没有 randomUUID/subtle 时仍使用随机字节生成请求 ID', () => {
  vi.stubGlobal('crypto', {
    getRandomValues: (bytes: Uint8Array) => {
      bytes.set(Array.from({ length: 16 }, (_, index) => index))
      return bytes
    },
  })
  expect(makeRequestId('csv')).toBe('csv-000102030405060708090a0b0c0d0e0f')
  expect(makeRequestId('manual')).toBe('manual-000102030405060708090a0b0c0d0e0f')
})
