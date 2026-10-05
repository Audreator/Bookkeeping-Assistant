import type { Category, Tx } from '../api/types'
import { formatCN, round2 } from '../lib/dates'
import { Money } from './Money'
import { sortTransactions } from '../lib/transactions'

export function TxList({
  txs,
  categories,
  onSelect,
  emptyText = '还没有记录',
}: {
  txs: Tx[]
  categories: Category[]
  onSelect?: (tx: Tx) => void
  emptyText?: string
}) {
  if (txs.length === 0) {
    return <div className="glass-card empty-state px-5 py-10 text-center"><span className="mb-2 block text-xl text-stone-500" aria-hidden="true">◇</span><p className="text-sm text-stone-500">{emptyText}</p></div>
  }

  const byDate = new Map<string, Tx[]>()
  for (const tx of sortTransactions(txs)) {
    const list = byDate.get(tx.occurredAt)
    if (list) list.push(tx)
    else byDate.set(tx.occurredAt, [tx])
  }
  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a))
  const catMap = new Map(categories.map((c) => [c.id, c]))

  return (
    <div className="space-y-4">
      {dates.map((date) => {
        const list = byDate.get(date) as Tx[]
        const dayTotal = round2(
          list.reduce((sum, t) => sum + (t.type === 'refund' ? -t.amount : t.amount), 0),
        )
        return (
          <section key={date}>
            <header className="mb-2 flex items-center justify-between px-1 text-xs text-stone-500">
              <span>{date.slice(0, 4)} 年 {formatCN(date)}</span>
              <span>
                合计 <Money value={dayTotal} />
              </span>
            </header>
            <div className="glass-card divide-y divide-stone-100 overflow-hidden">
              {list.map((tx) => {
                const cat = tx.categoryId != null ? catMap.get(tx.categoryId) : undefined
                return (
                  <button
                    key={tx.id}
                    type="button"
                    onClick={() => onSelect?.(tx)}
                    className="tx-row flex w-full items-center gap-3 px-4 py-3.5 text-left"
                  >
                    <span
                      className="category-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-stone-100 text-lg"
                    >
                      {cat?.icon ?? '💰'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {tx.merchant?.trim() || '商家未记录'}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-stone-500">
                        {cat?.name ?? '未分类'}
                        {tx.note ? ` · ${tx.note}` : ''}
                        {tx.status === 'pending' ? ' · 待确认' : ''}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 text-[10px] text-stone-500">
                        {tx.occurredTime ? <time className="tabular-nums" dateTime={`${tx.occurredAt}T${tx.occurredTime}`}>{tx.occurredTime}</time> : <span>时间未记录</span>}
                        <span aria-hidden="true">·</span>
                        <span>{{ manual: '手动', ocr: '快捷指令', import: '账单导入', 'bank-email': '银行邮件' }[tx.source]}</span>
                      </span>
                      {Boolean(tx.fixedAllocations?.length) && <span className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-brand-700">
                        <span className="rounded-md bg-brand-50 px-1.5 py-0.5">固定{tx.type === 'refund' ? '退款' : '支出'}</span>
                        <span>已分摊 ¥{round2(tx.fixedAllocations!.reduce((sum, a) => sum + a.amount, 0)).toFixed(2)} · 日常 ¥{round2(tx.amount - tx.fixedAllocations!.reduce((sum, a) => sum + a.amount, 0)).toFixed(2)}</span>
                      </span>}
                    </span>
                    <Money
                      value={tx.type === 'refund' ? tx.amount : -tx.amount}
                      signed
                      className="shrink-0 text-sm font-semibold tabular-nums text-stone-800"
                    />
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
