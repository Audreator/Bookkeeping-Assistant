import { useMemo, useState } from 'react'
import {
  useCategories,
  useCreateEvent,
  useDayOverrideMutations,
  useEvents,
  useTransactions,
} from '../api/hooks'
import type { BudgetEventDTO, Tx } from '../api/types'
import { Money } from '../components/Money'
import { Page } from '../components/Page'
import { QuickAdd } from '../components/QuickAdd'
import { TxList } from '../components/TxList'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { DataError } from '../components/DataError'
import { calendarOffset, formatCN, round2, todayISO } from '../lib/dates'
import { useBudgetState } from '../state/useBudgetState'

export function Planner() {
  const { state, loading, today, overrides, error, retry } = useBudgetState()
  const events = useEvents()
  const txs = useTransactions()
  const categories = useCategories()
  const createEvent = useCreateEvent()
  const { save: saveOverride, remove: removeOverride } = useDayOverrideMutations()

  const [selected, setSelected] = useState(today)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTx, setEditingTx] = useState<Tx | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const lastEvent = useMemo(() => {
    const list = events.data ?? []
    return list.length > 0 ? list[list.length - 1] : null
  }, [events.data])

  if (error || categories.error) return <Page><DataError error={error ?? categories.error} onRetry={() => { retry(); void categories.refetch() }} /></Page>
  if (loading || categories.isLoading) {
    return (
      <Page>
        <p className="py-20 text-center text-stone-400">加载中…</p>
      </Page>
    )
  }
  if (!state || !lastEvent) return <Page><DataError error={new Error('未找到初始预算，请检查服务初始化设置')} onRetry={retry} /></Page>

  const weekStartsOn = lastEvent.weekStartsOn
  const offset = calendarOffset(state.periodStart, weekStartsOn)
  const weekHeaders = weekStartsOn === 1 ? ['一', '二', '三', '四', '五', '六', '日'] : ['日', '一', '二', '三', '四', '五', '六']
  const selectedTxs = (txs.data ?? []).filter((t) => t.occurredAt === selected)
  const selectedOverride = overrides.find((o) => o.date === selected)

  const setDayBudget = async () => {
    const text = window.prompt(
      `设置 ${selected} 当天的预算金额（其他天自动重算）：`,
      selectedOverride ? String(selectedOverride.amount) : '',
    )
    if (text == null) return
    const amount = Number(text)
    if (!Number.isFinite(amount) || amount <= 0) {
      window.alert('请输入正确的金额')
      return
    }
    try {
      await saveOverride.mutateAsync({ date: selected, amount })
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '保存失败')
    }
  }

  const clearDayBudget = async () => {
    if (!selectedOverride) return
    if (!window.confirm('取消这天的单独预算？')) return
    try {
      await removeOverride.mutateAsync(selectedOverride.id)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '取消失败')
    }
  }

  const switchMode = async () => {
    await createEvent.mutateAsync({
      at: today,
      mode: state.mode === 'month' ? 'week' : 'month',
      monthBudget: lastEvent.monthBudget,
      weekBudgetOverride: lastEvent.weekBudgetOverride,
      cycleStartDay: lastEvent.cycleStartDay,
      weekStartsOn: lastEvent.weekStartsOn,
      note: '切换预算模式',
    })
  }

  const history = [...(events.data ?? [])].reverse()

  return (
    <Page>
      <header className="mb-4 flex items-center justify-between">
        <div><h1>规划</h1><p className="mt-1.5 text-xs text-stone-500">为每一天，留好余量</p></div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void switchMode()}
            className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600"
          >
            切到{state.mode === 'month' ? '周' : '月'}预算
          </button>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="rounded-full bg-brand-700 px-3 py-1.5 text-xs font-medium text-white"
          >
            改预算
          </button>
        </div>
      </header>

      <section className="glass-card p-4">
        <div className="mb-4 space-y-1 text-sm">
          <span className="font-medium">
            {state.mode === 'month' ? '月度' : '周度'}期间
          </span>
          <span className="block text-xs text-stone-500">
            {state.periodStart} ~ {state.periodEnd} · 预算 <Money value={state.periodBudget} />
          </span>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-xs text-stone-400">
          {weekHeaders.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {Array.from({ length: offset }).map((_, i) => (
            <span key={`blank-${i}`} />
          ))}
          {state.days.map((day) => {
            const dayNum = Number(day.date.slice(8, 10))
            const isToday = day.date === today
            const isSelected = day.date === selected
            return (
              <button
                key={day.date}
                type="button"
                aria-pressed={isSelected}
                aria-label={`${day.date}，可花 ${round2(day.available)} 元${day.isOverride ? '，单独预算' : ''}`}
                onClick={() => setSelected(day.date)}
                className={`calendar-day rounded-xl p-1 text-center ${
                  isSelected
                    ? 'bg-brand-700 text-white'
                    : isToday
                      ? 'bg-brand-50 text-brand-700'
                      : 'bg-stone-50 text-stone-600'
                }`}
              >
                <span className="block text-xs opacity-80">{dayNum}</span>
                <span
                  className={`mt-0.5 block text-[11px] font-medium ${
                    day.available < 0 && !isSelected ? 'text-red-500' : ''
                  }`}
                >
                  {day.isOverride ? '★' : ''}
                  {Math.round(day.available)}
                </span>
                {day.spent !== 0 && (
                  <span
                    className={`mx-auto mt-0.5 block h-1 w-1 rounded-full ${
                      isSelected ? 'bg-white' : 'bg-stone-500'
                    }`}
                  />
                )}
              </button>
            )
          })}
        </div>
      </section>

      <section className="mt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
          <h2 className="text-sm font-medium text-stone-600">
            {formatCN(selected)} 的交易
          </h2>
          {selectedOverride ? (
            <span className="flex items-center gap-3 text-xs">
              <span className="font-medium text-brand-700">
                当天预算 <Money value={selectedOverride.amount} />
              </span>
              <button type="button" className="text-stone-500" onClick={() => void setDayBudget()}>
                修改
              </button>
              <button type="button" className="text-stone-400" onClick={() => void clearDayBudget()}>
                取消固定
              </button>
            </span>
          ) : (
            <button type="button" className="text-xs text-brand-700" onClick={() => void setDayBudget()}>
              单独设当天预算
            </button>
          )}
        </div>
        {selectedOverride && !state.overridesFeasible && (
          <p className="mb-2 text-xs text-stone-600">
            当前总预算不足：其他天已被压到负数，建议调整总预算或修改这天的单独预算
          </p>
        )}
        <TxList
          txs={selectedTxs}
          categories={categories.data ?? []}
          emptyText="这一天没有记录"
          onSelect={(tx) => {
            setEditingTx(tx)
            setAddOpen(true)
          }}
        />
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium text-stone-600">预算调整记录</h2>
        <ul className="glass-card divide-y divide-stone-100 overflow-hidden">
          {history.map((e) => (
            <li key={e.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>
                <span className="mr-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                  {e.mode === 'month' ? '月' : '周'}
                </span>
                {e.note || '调整预算'}
                <span className="ml-2 text-xs text-stone-400">{e.at}</span>
              </span>
              <Money value={e.mode === 'month' ? e.monthBudget : (e.weekBudgetOverride ?? 0)} />
            </li>
          ))}
        </ul>
      </section>

      <button
        type="button"
        onClick={() => {
          setEditingTx(null)
          setAddOpen(true)
        }}
        className="fab"
        aria-label="记一笔"
      >
        <Icon name="plus" />
      </button>

      {dialogOpen && (
        <BudgetDialog
          onClose={() => setDialogOpen(false)}
          onSubmit={async (input) => {
            await createEvent.mutateAsync(input)
            setDialogOpen(false)
          }}
          defaults={{
            monthBudget: lastEvent.monthBudget,
            weekBudgetOverride: lastEvent.weekBudgetOverride,
            cycleStartDay: lastEvent.cycleStartDay,
            mode: lastEvent.mode,
            weekStartsOn: lastEvent.weekStartsOn,
          }}
        />
      )}

      <QuickAdd
        open={addOpen}
        editing={editingTx}
        defaultDate={selected}
        onClose={() => {
          setAddOpen(false)
          setEditingTx(null)
        }}
      />
    </Page>
  )
}

function BudgetDialog({
  defaults,
  onSubmit,
  onClose,
}: {
  defaults: {
    monthBudget: number
    weekBudgetOverride: number | null
    cycleStartDay: number
    mode: 'month' | 'week'
    weekStartsOn: 1 | 7
  }
  onSubmit: (input: Omit<BudgetEventDTO, 'id' | 'createdAt'>) => Promise<void>
  onClose: () => void
}) {
  const [monthBudget, setMonthBudget] = useState(String(defaults.monthBudget))
  const [weekOverride, setWeekOverride] = useState(
    defaults.weekBudgetOverride != null ? String(defaults.weekBudgetOverride) : '',
  )
  const [cycleStartDay, setCycleStartDay] = useState(String(defaults.cycleStartDay))
  const [mode, setMode] = useState(defaults.mode)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const value = Number(monthBudget)
    if (!Number.isFinite(value) || value <= 0) return
    const overrideText = weekOverride.trim()
    if (overrideText !== '') {
      const overrideValue = Number(overrideText)
      if (!Number.isFinite(overrideValue) || overrideValue <= 0) {
        window.alert('周预算手改值必须为正数，或留空自动折算')
        return
      }
    }
    setBusy(true)
    try {
      await onSubmit({
        at: todayISO(),
        mode,
        monthBudget: round2(value),
        weekBudgetOverride: overrideText === '' ? null : round2(Number(overrideText)),
        cycleStartDay: Number(cycleStartDay),
        weekStartsOn: defaults.weekStartsOn,
        note: note.trim() || '调整预算',
      })
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const inputClass =
    'w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 outline-none focus:border-brand-500'

  return (
    <Modal label="调整预算" onClose={() => { if (!busy) onClose() }}>
        <h2 className="mb-3 font-medium">调整预算</h2>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-stone-500">月预算（元）</span>
            <input className={inputClass} type="number" inputMode="decimal" value={monthBudget} onChange={(e) => setMonthBudget(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-stone-500">周预算手改值（可选，留空自动折算）</span>
            <input className={inputClass} type="number" inputMode="decimal" placeholder="自动" value={weekOverride} onChange={(e) => setWeekOverride(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-stone-500">周期起始日</span>
            <select className={inputClass} value={cycleStartDay} onChange={(e) => setCycleStartDay(e.target.value)}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  每月 {d} 号
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-stone-500">模式</span>
            <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as 'month' | 'week')}>
              <option value="month">月预算</option>
              <option value="week">周预算</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-stone-500">备注</span>
            <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：发奖金，提高预算" />
          </label>
        </div>
        <div className="mt-4 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-stone-200 py-2.5 text-stone-600">
            取消
          </button>
          <button type="button" onClick={() => void submit()} disabled={busy} className="flex-1 rounded-xl bg-brand-700 py-2.5 font-medium text-white disabled:opacity-50">
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
    </Modal>
  )
}
