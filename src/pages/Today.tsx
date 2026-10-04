import { useState } from 'react'
import { useCategories, useTransactions } from '../api/hooks'
import type { Tx } from '../api/types'
import { Money } from '../components/Money'
import { Page } from '../components/Page'
import { ProgressRing } from '../components/ProgressRing'
import { QuickAdd } from '../components/QuickAdd'
import { TxList } from '../components/TxList'
import { Icon } from '../components/Icon'
import { DataError } from '../components/DataError'
import { formatCN, formatMoney } from '../lib/dates'
import { useBudgetState } from '../state/useBudgetState'

export function Today() {
  const { state, loading, today, error, retry } = useBudgetState()
  const txs = useTransactions()
  const categories = useCategories()
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<Tx | null>(null)

  if (error || categories.error) return <Page><DataError error={error ?? categories.error} onRetry={() => { retry(); void categories.refetch() }} /></Page>

  if (loading || categories.isLoading) {
    return (
      <Page>
        <p className="py-20 text-center text-stone-400">加载中…</p>
      </Page>
    )
  }
  if (!state) return <Page><DataError error={new Error('未找到初始预算，请检查服务初始化设置')} onRetry={retry} /></Page>

  // 固定支出已从当期总预算中预先扣除并重算每日额度，首页不展示固定支出明细。
  const displayValue = state.availableToday
  const overspent = displayValue < 0
  const mainLabel = overspent ? '今日超支' : '今日可花'
  const progress = state.periodBudget > 0 ? state.spentInPeriod / state.periodBudget : 0
  const spentToday = state.days.find((d) => d.date === today)?.spent ?? 0
  const recent = txs.data ?? []

  return (
    <Page>
      <header className="mb-4 flex items-baseline justify-between">
        <div><h1>今天</h1><p className="mt-1.5 text-xs text-stone-500">每一笔，都心中有数</p></div>
        <span className="rounded-full border border-white/80 bg-white/60 px-3 py-2 text-xs text-stone-500">{formatCN(today)}</span>
      </header>

      <section className="glass-card hero-card">
        <div className="text-xs text-stone-400">{mainLabel}</div>
        <div
          className={`hero-amount mt-1 font-semibold tabular-nums ${overspent ? 'text-red-500' : 'text-stone-900'}`}
        >
          {overspent ? `¥${formatMoney(Math.abs(displayValue))}` : <Money value={displayValue} />}
        </div>

        <div className="mt-5 flex items-center gap-5">
          <ProgressRing progress={progress} size={100} stroke={7}>
            <span className="text-xs text-stone-400">本期已花</span>
            <span className="text-lg font-medium">
              {Math.round(progress * 100)}%
            </span>
          </ProgressRing>
          <div className="min-w-0 flex-1"><div className="text-xs text-stone-500">{state.mode === 'month' ? '本月' : '本周'}预算进度</div><p className="mt-1 text-sm font-medium"><Money value={state.spentInPeriod} /> <span className="font-normal text-stone-500">已使用</span></p><p className="mt-1 text-[11px] text-stone-500">{state.periodStart.slice(5)} 至 {state.periodEnd.slice(5)}</p></div>
        </div>

        <div className="hero-metrics grid w-full grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-xs text-stone-400">今日已花</div>
            <div className="mt-0.5 text-sm font-medium">
              <Money value={spentToday} />
            </div>
          </div>
          <div>
            <div className="text-xs text-stone-400">本期剩余</div>
            <div className="mt-0.5 text-sm font-medium">
              <Money value={state.remainingInPeriod} />
            </div>
          </div>
          <div>
            <div className="text-xs text-stone-400">{state.mode === 'month' ? '本月预算' : '本周预算'}</div>
            <div className="mt-0.5 text-sm font-medium">
              <Money value={state.periodBudget} />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-stone-600">最近交易</h2>
          <a href="#/ledger" className="text-xs text-brand-700">
            查看全部 ›
          </a>
        </div>
        <TxList
          txs={recent}
          categories={categories.data ?? []}
          onSelect={(tx) => {
            setEditing(tx)
            setAddOpen(true)
          }}
        />
      </section>

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
