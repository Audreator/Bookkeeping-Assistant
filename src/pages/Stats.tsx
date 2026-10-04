import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useCategories, useTransactions } from '../api/hooks'
import { Money } from '../components/Money'
import { Page } from '../components/Page'
import { DataError } from '../components/DataError'
import { addDays, daysInMonthKey, formatMoney, monthKey, monthStart, todayISO } from '../lib/dates'
import { dailyTotals, monthlyByCategory, monthTotal, topMerchants } from '../lib/stats'

export function Stats() {
  const txs = useTransactions()
  const categories = useCategories()
  const [month, setMonth] = useState(monthKey(todayISO()))

  const list = useMemo(() => txs.data ?? [], [txs.data])
  const byCat = useMemo(() => monthlyByCategory(list, month), [list, month])
  const daily = useMemo(() => dailyTotals(list, month), [list, month])
  const top = useMemo(() => topMerchants(list, month), [list, month])
  const total = useMemo(() => monthTotal(list, month), [list, month])
  const prevMonth = monthKey(addDays(monthStart(month), -1))
  const prevTotal = useMemo(() => monthTotal(list, prevMonth), [list, prevMonth])

  const catMap = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c])),
    [categories.data],
  )

  const pieData = byCat
    .filter((x) => x.total > 0)
    .map((x, index) => {
      const cat = x.categoryId != null ? catMap.get(x.categoryId) : undefined
      return {
        name: cat?.name ?? '未分类',
        value: x.total,
        color: cat?.color || ['#6d97cf', '#83b69e', '#d5a075', '#bd92ac', '#a798c5', '#85b5c7'][index % 6],
      }
    })

  const barData = useMemo(() => {
    const days = daysInMonthKey(month)
    return Array.from({ length: days }, (_, i) => {
      const date = `${month}-${String(i + 1).padStart(2, '0')}`
      const hit = daily.find((d) => d.date === date)
      return { day: i + 1, total: hit?.total ?? 0 }
    })
  }, [daily, month])

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const canNext = month < monthKey(todayISO())
  const diff = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null

  if (txs.error || categories.error) return <Page><DataError error={txs.error ?? categories.error}
    onRetry={() => { void txs.refetch(); void categories.refetch() }} /></Page>
  if (txs.isLoading || categories.isLoading) return <Page><p role="status" className="py-20 text-center text-stone-500">正在加载统计…</p></Page>

  return (
    <Page>
      <header className="mb-4 flex items-center justify-between">
        <button type="button" aria-label="上个月" onClick={() => shiftMonth(-1)} className="min-w-11 rounded-full bg-white/60 px-2 text-stone-500">
          ‹
        </button>
        <h1 className="text-lg font-semibold">
          {month.slice(0, 4)} 年 {Number(month.slice(5))} 月
        </h1>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          disabled={!canNext}
          aria-label="下个月"
          className="min-w-11 rounded-full bg-white/60 px-2 text-stone-500 disabled:opacity-30"
        >
          ›
        </button>
      </header>

      <section className="grid grid-cols-2 gap-3">
        <div className="glass-card p-4">
          <div className="text-xs text-stone-400">本月支出</div>
          <div className="mt-1 text-xl font-semibold">
            <Money value={total} />
          </div>
          {diff != null && (
            <div className={`mt-0.5 text-xs ${diff > 0 ? 'text-red-500' : 'text-stone-600'}`}>
              较上月 {diff > 0 ? '+' : ''}
              {diff.toFixed(1)}%
            </div>
          )}
        </div>
        <div className="glass-card p-4">
          <div className="text-xs text-stone-400">上月支出</div>
          <div className="mt-1 text-xl font-semibold">
            <Money value={prevTotal} />
          </div>
        </div>
      </section>

      <section className="glass-card mt-4 p-4">
        <h2 className="mb-2 text-sm font-medium text-stone-600">分类占比</h2>
        {pieData.length === 0 ? (
          <p className="py-10 text-center text-sm text-stone-400">本月暂无支出</p>
        ) : (
          <div className="flex items-center">
            <div className="h-44 w-44 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} isAnimationActive={false}>
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => `¥${formatMoney(Number(v))}`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="ml-2 flex-1 space-y-1 text-xs">
              {pieData.slice(0, 6).map((entry) => (
                <li key={entry.name} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 truncate text-stone-600">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                    {entry.name}
                  </span>
                  <Money value={entry.value} className="text-stone-500" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="glass-card mt-4 p-4">
        <h2 className="mb-2 text-sm font-medium text-stone-600">每日支出</h2>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData}>
              <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={4} />
              <YAxis tick={{ fontSize: 10 }} width={40} />
              <Tooltip formatter={(v) => `¥${formatMoney(Number(v))}`} labelFormatter={(l) => `${l} 日`} />
              <Bar dataKey="total" name="净支出" fill="#0885fa" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {top.length > 0 && (
        <section className="glass-card mt-4 p-4">
          <h2 className="mb-2 text-sm font-medium text-stone-600">支出最多的商家</h2>
          <ul className="space-y-2 text-sm">
            {top.map((m, i) => (
              <li key={m.merchant} className="flex items-center justify-between">
                <span className="truncate">
                  <span className="mr-2 inline-block w-4 text-center text-xs text-stone-400">
                    {i + 1}
                  </span>
                  {m.merchant}
                </span>
                <Money value={m.total} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </Page>
  )
}
