import { describe, expect, it } from 'vitest'
import { buildBackup, decryptBackup, encryptBackup } from './backup'

const SAMPLE = buildBackup({
  categories: [{ id: 1, name: '餐饮' }],
  transactions: [{ id: 1, merchant: '某某便利店', amount: 12.34 }],
  events: [{ id: 1, at: '2026-10-01' }],
  bills: [],
  payments: [],
  settings: { reserveEnabled: true },
})

describe('backup', () => {
  it('buildBackup 生成版本化结构', () => {
    expect(SAMPLE.version).toBe(1)
    expect(SAMPLE.data.transactions).toHaveLength(1)
    expect(typeof SAMPLE.exportedAt).toBe('string')
  })

  it('加密导出后可用同一口令解密还原', async () => {
    const blob = await encryptBackup(SAMPLE, 'my-pass-123')
    const restored = await decryptBackup(blob, 'my-pass-123')
    expect(restored).toEqual(SAMPLE)
  })

  it('错误口令解密失败', async () => {
    const blob = await encryptBackup(SAMPLE, 'correct')
    await expect(decryptBackup(blob, 'wrong')).rejects.toThrow('口令错误或文件损坏')
  })

  it('密文中不含明文商家名', async () => {
    const blob = await encryptBackup(SAMPLE, 'my-pass-123')
    const text = await blob.text()
    expect(text.includes('某某便利店')).toBe(false)
    expect(text.includes('12.34')).toBe(false)
  })
})
