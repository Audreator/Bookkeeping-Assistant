import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { Tx } from '../api/types'
import { TxList } from './TxList'

afterEach(cleanup)

it('极小金额支出与退款冲减后合计不出现 NaN', () => {
  const base: Tx = { id: 1, type: 'expense', amount: 0.01, categoryId: null,
    merchant: null, note: null, occurredAt: '2026-10-05', occurredTime: '01:13:00',
    source: 'ocr', refundOfId: null, status: 'confirmed', createdAt: 'x' }
  render(<TxList categories={[]} txs={[
    { ...base, id: 4, type: 'refund', amount: 0.02, occurredTime: '01:35:33' },
    { ...base, id: 3, type: 'refund', amount: 0.01, occurredTime: '01:17:00' },
    { ...base, id: 2, amount: 0.02, occurredTime: '01:14:36' },
    base,
  ]} />)
  expect(screen.queryByText(/NaN/)).toBeNull()
  expect(screen.getByText('¥0.00')).toBeTruthy()
})

it('展示秒级交易时刻，并明确旧记录未知时间', () => {
  const base: Tx = { id: 1, type: 'expense', amount: 1, categoryId: null,
    merchant: '便利店', note: null, occurredAt: '2026-10-04', source: 'manual',
    refundOfId: null, status: 'confirmed', createdAt: 'x' }
  render(<TxList categories={[]} txs={[base, { ...base, id: 2, occurredTime: '12:30:41' }]} />)
  expect(screen.getByText('12:30:41').getAttribute('datetime')).toBe('2026-10-04T12:30:41')
  expect(screen.getByText('时间未记录')).toBeTruthy()
})

it.each([
  { note: '午餐补记', categoryId: 1, details: '餐饮 · 午餐补记' },
  { note: null, categoryId: 1, details: '餐饮' },
  { note: '截图金额已确认', categoryId: null, details: '未分类 · 截图金额已确认' },
])('商家缺失时明确标示未记录，备注和分类只用于副标题（$details）', ({ note, categoryId, details }) => {
  const tx: Tx = { id: 1, type: 'expense', amount: 10, categoryId, merchant: null,
    note, occurredAt: '2026-10-04', source: 'manual', refundOfId: null,
    status: 'confirmed', createdAt: 'x' }
  render(<TxList categories={[{ id: 1, name: '餐饮', icon: '🍜', color: '#eeaa66', sort: 1, type: 'expense' }]} txs={[tx]} />)
  expect(screen.getByText('商家未记录')).toBeTruthy()
  expect(screen.getByText(details)).toBeTruthy()
})
