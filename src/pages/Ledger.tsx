import { useMemo, useState } from 'react'
import { useCategories, useTransactions } from '../api/hooks'
import type { Tx } from '../api/types'
import { Money } from '../components/Money'
import { Page } from '../components/Page'
import { QuickAdd } from '../components/QuickAdd'
import { TxList } from '../components/TxList'
import { Icon } from '../components/Icon'
import { DataError } from '../components/DataError'
import { addDays, monthKey, monthStart, round2, todayISO } from '../lib/dates'

type RangeKey = 'month' | 'last' | 'all'

export function Ledger() {
  const txs = useTransactions()
  const categories = useCategories()
  const [q, setQ] = useState('')
  const [catId, setCatId] = useState<number | 'all'>('all')
  const [type, setType] = useState<'all' | 'expense' | 'refund'>('all')
  const [range, setRange] = useState<RangeKey>('month')
  const [editing, setEditing] = useState<Tx | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const filtered = useMemo(() => {
    const now = monthKey(todayISO())
    const last = monthKey(addDays(monthStart(now), -1))
    const keyword = q.trim().toLowerCase()
    return (txs.data ?? []).filter((t) => {
      if (range === 'month' && monthKey(t.occurredAt) !== now) return false
      if (range === 'last' && monthKey(t.occurredAt) !== last) return false
      if (type !== 'all' && t.type !== type) return false
      if (catId !== 'all' && t.categoryId !== catId) return false
      if (keyword) {
        const hay = `${t.merchant ?? ''} ${t.note ?? ''}`.toLowerCase()
        if (!hay.includes(keyword)) return false
      }
      return true
    })
  }, [txs.data, q, catId, type, range])

  const totals = useMemo(() => {
    let expense = 0
    let refund = 0
    for (const t of filtered) {
      if (t.type === 'refund') refund += t.amount
      else expense += t.amount
    }
    return { expense: round2(expense), refund: round2(refund) }
  }, [filtered])

  const chip = (active: boolean) =>
    `shrink-0 rounded-full border px-3 py-1.5 text-xs ${
      active ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-stone-200 text-stone-500'
    }`

  if (txs.error || categories.error) return <Page><DataError error={txs.error ?? categories.error}
    onRetry={() => { void txs.refetch(); void categories.refetch() }} /></Page>
  if (txs.isLoading || categories.isLoading) return <Page><p role="status" className="py-20 text-center text-stone-500">正在加载账本…</p></Page>

  return (
    <Page>
      <header className="mb-3 flex items-baseline justify-between">
        <div><h1>账本</h1><p className="mt-1.5 text-xs text-stone-500">支出与退款，清楚留存</p></div>
        <span className="text-xs text-stone-500">{filtered.length} 笔记录</span>
      </header>

      <section className="glass-card mb-4 grid grid-cols-2 gap-4 p-4">
        <div><p className="text-xs text-stone-500">筛选支出</p><Money value={totals.expense} className="mt-1 block text-lg font-semibold tabular-nums" /></div>
        <div className="border-l border-stone-200 pl-4"><p className="text-xs text-stone-500">筛选退款</p><Money value={totals.refund} className="mt-1 block text-lg font-semibold tabular-nums text-stone-800" /></div>
      </section>

      <input
        className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 outline-none focus:border-brand-500"
        placeholder="搜索商家 / 备注"
        aria-label="搜索商家或备注"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {(
          [
            ['month', '本月'],
            ['last', '上月'],
            ['all', '全部'],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" className={chip(range === value)} onClick={() => setRange(value)}>
            {label}
          </button>
        ))}
        <span className="mx-1 w-px shrink-0 bg-stone-200" />
        {(
          [
            ['all', '全部'],
            ['expense', '支出'],
            ['refund', '退款'],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" className={chip(type === value)} onClick={() => setType(value)}>
            {label}
          </button>
        ))}
        <span className="mx-1 w-px shrink-0 bg-stone-200" />
        <button type="button" className={chip(catId === 'all')} onClick={() => setCatId('all')}>
          全部分类
        </button>
        {(categories.data ?? []).map((c) => (
          <button key={c.id} type="button" className={chip(catId === c.id)} onClick={() => setCatId(c.id)}>
            <span className="category-icon">{c.icon}</span> {c.name}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <TxList
          txs={filtered}
          categories={categories.data ?? []}
          emptyText="没有符合条件的记录"
          onSelect={(tx) => {
            setEditing(tx)
            setAddOpen(true)
          }}
        />
      </div>

      <button
        type="button"
        onClick={() => {
          setEditing(null)
          setAddOpen(true)
        }}
        className="fab"
        aria-label="记一笔"
      >
        <Icon name="plus" />
      </button>

      <QuickAdd
        open={addOpen}
        editing={editing}
        onClose={() => {
          setAddOpen(false)
          setEditing(null)
        }}
      />
    </Page>
  )
}
