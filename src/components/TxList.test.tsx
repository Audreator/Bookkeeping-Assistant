import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { Tx } from '../api/types'
import { TxList } from './TxList'

afterEach(cleanup)
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
