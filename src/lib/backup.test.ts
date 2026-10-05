import { describe, expect, it } from 'vitest'
import { buildBackup, decryptBackup, encryptBackup, mapBackupAllocations } from './backup'

const SAMPLE = buildBackup({
  categories: [{ id: 1, name: '餐饮' }],
  transactions: [{ id: 1, merchant: '某某便利店', amount: 12.34 }],
  events: [{ id: 1, at: '2026-10-01' }],
  bills: [],
  payments: [],
  settings: { reserveEnabled: true },
})

describe('backup', () => {
  it('固定分摊恢复映射交易与账单 ID，先恢复支出再恢复退款', () => {
    const data = { ...SAMPLE.data,
      transactions: [{ id: 1, type: 'expense' }, { id: 2, type: 'refund' }],
      allocations: [
        { transactionId: 2, billId: 7, periodKey: '2026-10-01', amount: 50 },
        { transactionId: 1, billId: 7, periodKey: '2026-10-01', amount: 800 },
        { transactionId: 1, billId: 8, periodKey: '2026-10-05', amount: 25.5 },
      ],
    }
    expect(mapBackupAllocations(data, new Map([[1, 101], [2, 102]]), new Map([[7, 207], [8, 208]])))
      .toEqual([
        { transactionId: 101, allocations: [
          { billId: 207, periodKey: '2026-10-01', amount: 800 },
          { billId: 208, periodKey: '2026-10-05', amount: 25.5 },
        ] },
        { transactionId: 102, allocations: [{ billId: 207, periodKey: '2026-10-01', amount: 50 }] },
      ])
  })

  it('旧备份无固定分摊字段时兼容恢复', () => {
    expect(mapBackupAllocations(SAMPLE.data, new Map(), new Map())).toEqual([])
  })

  it('分摊引用不存在的交易或账单时明确失败，不静默丢失关联', () => {
    const data = { ...SAMPLE.data,
      allocations: [{ transactionId: 1, billId: 7, periodKey: '2026-10-01', amount: 800 }],
    }
    expect(() => mapBackupAllocations(data, new Map([[1, 101]]), new Map()))
      .toThrow('固定支出分摊关联缺失')
  })
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
