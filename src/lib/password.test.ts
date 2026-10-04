import { describe, expect, it } from 'vitest'
import { prehashPassword } from './password'

describe('prehashPassword', () => {
  it('确定性：同一密码结果一致', () => {
    expect(prehashPassword('my-password-123')).toBe(prehashPassword('my-password-123'))
  })

  it('不同密码结果不同', () => {
    expect(prehashPassword('a-password-1')).not.toBe(prehashPassword('a-password-2'))
  })

  it('输出固定 64 位十六进制（bcrypt 72 字节限制内）', () => {
    const hash = prehashPassword('任意密码')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('带域分隔，避免与其他哈希系统撞车', () => {
    expect(prehashPassword('secret123')).not.toBe(
      // 裸 sha256('secret123') 的值（已知）
      'fcf730b6d95236ecd3c9fc2d92d7b6b2bb061514961aec041d6c7a7192f592e4',
    )
  })
})
