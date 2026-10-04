import { useState } from 'react'
import { useBillMutations, useCategories, useTransactions } from '../api/hooks'
import type { Tx } from '../api/types'
import { Money } from '../components/Money'
import { Page } from '../components/Page'
import { ProgressRing } from '../components/ProgressRing'
import { QuickAdd } from '../components/QuickAdd'
import { TxList } from '../components/TxList'
import { Icon } from '../components/Icon'
import { DataError } from '../components/DataError'
import { formatCN, formatMoney, toLocalTime } from '../lib/dates'
import { useBudgetState } from '../state/useBudgetState'

const currentLocalTime = () => toLocalTime(new Date())

export function Today() {
  const { state, reserve, reserveEnabled, loading, today, error, retry } = useBudgetState()
  const txs = useTransactions()
  const categories = useCategories()
  const { payBillWithTransaction } = useBillMutations()
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<Tx | null>(null)
  const [bookingId, setBookingId] = useState<number | null>(null)
  const [bookingError, setBookingError] = useState('')

  if (error || categories.error) return <Page><DataError error={error ?? categories.error} onRetry={() => { retry(); void categories.refetch() }} /></Page>

  if (loading || categories.isLoading) {
    return (
      <Page>
        <p className="py-20 text-center text-stone-400">加载中…</p>
      </Page>
    )
  }
  if (!state) return <Page><DataError error={new Error('未找到初始预算，请检查服务初始化设置')} onRetry={retry} /></Page>

  const reserved = reserveEnabled ? reserve.reserved : 0
  // 固定支出已从当期总预算中预先扣除并重算每日额度，此处直接用引擎结果。
  const displayValue = state.availableToday
  const overspent = displayValue < 0
  const mainLabel = overspent
    ? '今日超支'
    : reserveEnabled && reserved > 0
      ? '今日可花（固定支出已从本期预算扣除）'
      : '今日可花'
  const progress = state.periodBudget > 0 ? state.spentInPeriod / state.periodBudget : 0
  const spentToday = state.days.find((d) => d.date === today)?.spent ?? 0
  const recent = txs.data ?? []
  const dueBills = reserve.upcoming.filter((u) => !u.paid)

  const bookBill = async (billId: number, dueDate: string) => {
    if (bookingId !== null) return
    const bill = reserve.upcoming.find((u) => u.billId === billId)
    if (!bill) return
    setBookingId(billId)
    setBookingError('')
    try {
      await payBillWithTransaction.mutateAsync({
        billId,
        periodKey: dueDate,
        paidAt: today,
        occurredTime: currentLocalTime(),
      })
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : '固定支出记账失败，请检查账本后重试')
    } finally {
      setBookingId(null)
    }
  }

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
        {reserveEnabled && reserved > 0 && (
          <div className="mt-1 text-xs text-stone-500">
            已预留固定支出 ¥{formatMoney(reserved)}
          </div>
        )}

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

      {bookingError && <p role="alert" className="mt-3 rounded-2xl bg-red-50 p-3 text-sm text-red-500">{bookingError}</p>}

      {dueBills.length > 0 && (
        <section className="glass-card mt-4 p-4">
          <h2 className="mb-2 text-sm font-medium text-stone-600">固定支出提醒</h2>
          <ul className="divide-y divide-stone-100">
            {dueBills.map((u) => (
              <li key={`${u.billId}-${u.dueDate}`} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{u.name}</span>
                  <span className={`text-xs ${u.dueSoon ? 'text-stone-700' : 'text-stone-400'}`}>
                    {u.dueDate} 到期{u.dueSoon ? ' · 即将到期' : ''}
                  </span>
                </span>
                <Money value={u.amount} className="text-sm" />
                <button
                  type="button"
                  disabled={bookingId !== null}
                  onClick={() => void bookBill(u.billId, u.dueDate)}
                  className="rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 disabled:opacity-50"
                >
                  {bookingId === u.billId ? '记账中…' : '记一笔'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

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
