import { useEffect, useRef, useState } from 'react'
import { useBillsData, useFixedAllocationMutation } from '../api/hooks'
import type { Bill, FixedAllocationInput, Tx } from '../api/types'
import { daysInMonthKey, formatMoney, round2 } from '../lib/dates'
import { ModalToolbar } from './ModalToolbar'
import { Modal } from './Modal'

interface Draft extends FixedAllocationInput { key: number; value: string }
const dueDate = (bill: Bill, month: string) => `${month}-${String(Math.min(bill.dueDay, daysInMonthKey(month))).padStart(2, '0')}`

export function FixedAllocationDialog({ transaction, onClose }: { transaction: Tx; onClose: () => void }) {
  const data = useBillsData()
  const save = useFixedAllocationMutation()
  const [rows, setRows] = useState<Draft[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const initialized = useRef(false)
  const counter = useRef(0)
  useEffect(() => {
    if (!data.data || initialized.current) return
    initialized.current = true
    setRows((data.data.allocations ?? []).filter((row) => row.transactionId === transaction.id)
      .map((row) => ({ ...row, key: counter.current++, value: String(row.amount) })))
  }, [data.data, transaction.id])
  const totalCents = rows.reduce((sum, row) => sum + Math.round((Number(row.value) || 0) * 100), 0)
  const remainder = round2(transaction.amount - totalCents / 100)
  const ready = Boolean(data.data) && !data.isLoading && transaction.status === 'confirmed'
  const bills = data.data?.bills ?? []
  const inputClass = 'w-full min-w-0 rounded-xl border border-stone-200 bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-brand-500'
  const append = (bill: Bill) => {
    const existing = rows.filter((row) => row.billId === bill.id)
    let month = transaction.occurredAt.slice(0, 7)
    if (existing.length) {
      const last = [...existing].sort((a, b) => a.periodKey.localeCompare(b.periodKey)).at(-1)!.periodKey
      const [year, m] = last.split('-').map(Number)
      const next = new Date(year, m, 1)
      month = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
    }
    const amount = round2(Math.max(0, Math.min(bill.amount, remainder)))
    setRows((old) => [...old, { key: counter.current++, billId: bill.id, periodKey: dueDate(bill, month), amount, value: amount ? String(amount) : '' }])
    setError('')
  }
  const updateRow = (key: number, patch: Partial<Draft>) => { setRows((old) => old.map((row) => row.key === key ? { ...row, ...patch } : row)); setError('') }
  const submit = async () => {
    if (!ready || busy) return
    const allocations: FixedAllocationInput[] = []
    const seen = new Set<string>()
    for (const row of rows) {
      if (!/^\d+(?:\.\d{1,2})?$/.test(row.value) || Number(row.value) <= 0) {
        setError('每项分摊金额须大于 0，最多两位小数'); return
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.periodKey)) { setError('请选择每项固定支出的所属到期日'); return }
      const [year, month, day] = row.periodKey.split('-').map(Number)
      const date = new Date(year, month - 1, day)
      if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) { setError('所属到期日不是有效日期'); return }
      const identity = `${row.billId}:${row.periodKey}`
      if (seen.has(identity)) { setError('同一账单同一到期日请合并为一项'); return }
      seen.add(identity)
      allocations.push({ billId: row.billId, periodKey: row.periodKey, amount: round2(Number(row.value)) })
    }
    if (totalCents > Math.round(transaction.amount * 100)) { setError('分摊合计不能超过交易金额'); return }
    setBusy(true); setError('')
    try { await save.mutateAsync({ transactionId: transaction.id, allocations }); onClose() }
    catch (err) { setError(err instanceof Error ? err.message : '分摊保存失败，请重试') }
    finally { setBusy(false) }
  }
  return <Modal label={transaction.type === 'refund' ? '分摊固定退款' : '分摊到固定支出'} sheet onClose={() => { if (!busy) onClose() }}>
    <div className="sheet-handle" />
    <ModalToolbar title={transaction.type === 'refund' ? '分摊固定退款' : '分摊到固定支出'} onClose={onClose}
      closeLabel="关闭分摊" onConfirm={() => void submit()} confirmLabel="保存固定分摊" busy={busy} confirmDisabled={!ready} />
    <p className="text-xs leading-relaxed text-stone-500">原始流水 ¥{formatMoney(transaction.amount)} 保持不变。可选多项、按实际金额分摊，也可只付一部分。</p>
    {transaction.type === 'refund' && <p className="mt-2 text-xs leading-relaxed text-stone-500">未分摊部分按普通入账计算；仅选择实际退回的固定支出。</p>}
    {transaction.status !== 'confirmed' && <p className="mt-3 text-sm text-red-500">请先确认这笔交易，再分摊到固定支出。</p>}
    {data.isLoading && <p className="py-4 text-sm text-stone-500">正在加载固定支出…</p>}
    {data.isError && <p role="alert" className="py-4 text-sm text-red-500">固定支出加载失败，请关闭后重试。</p>}
    {ready && bills.length === 0 && <p className="my-4 rounded-xl bg-stone-50 px-3 py-3 text-sm text-stone-500">请先到「设置 → 固定支出」新增房租、水费等账单，再回来选择。</p>}
    <div className="my-4 space-y-3">
      {bills.map((bill) => {
        const selected = rows.filter((row) => row.billId === bill.id)
        return <section key={bill.id} className={`rounded-2xl border p-3 ${selected.length ? 'border-brand-500/25 bg-brand-50/40' : 'border-stone-200 bg-white/40'}`}>
          <label className="flex items-center gap-3">
            <input type="checkbox" aria-label={`选择${bill.name}`} disabled={!ready || busy} className="h-5 w-5 shrink-0 accent-brand-700"
              checked={selected.length > 0} onChange={(event) => event.target.checked ? append(bill) : setRows((old) => old.filter((row) => row.billId !== bill.id))} />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{bill.name}{!bill.active ? '（已停用）' : ''}</span>
              <span className="text-xs text-stone-500">每月 {bill.dueDay} 日 · 计划 ¥{formatMoney(bill.amount)}</span></span>
          </label>
          {selected.map((row, index) => {
            const label = `${bill.name}${index ? `第${index + 1}项` : ''}`
            return <div key={row.key} className="mt-3 grid grid-cols-2 gap-2">
              <label className="min-w-0"><span className="mb-1 block text-xs text-stone-500">{transaction.type === 'refund' ? '退款金额（元）' : '分摊金额（元）'}</span>
                <input className={inputClass} aria-label={`${label}分摊金额`} type="number" inputMode="decimal" step="0.01" min="0.01" value={row.value} disabled={busy}
                  onChange={(event) => updateRow(row.key, { value: event.target.value })} /></label>
              <label className="min-w-0"><span className="mb-1 block text-xs text-stone-500">所属到期日</span>
                <input className={inputClass} aria-label={`${label}所属到期日`} type="date" value={row.periodKey} disabled={busy}
                  onChange={(event) => updateRow(row.key, { periodKey: event.target.value })} /></label>
              {selected.length > 1 && <button type="button" disabled={busy} onClick={() => setRows((old) => old.filter((r) => r.key !== row.key))} className="ios-button ios-button-link ios-button-danger ios-button-end col-span-2">移除此项</button>}
            </div>
          })}
          {selected.length > 0 && <button type="button" disabled={busy} onClick={() => append(bill)} className="ios-button ios-button-link mt-3">＋ 再分摊一期</button>}
        </section>
      })}
    </div>
    <div className="rounded-2xl bg-stone-100/70 px-4 py-3 text-sm">
      <div className="flex items-center justify-between"><span>固定{transaction.type === 'refund' ? '退款' : '支出'}合计</span><span className="font-medium tabular-nums">¥{formatMoney(totalCents / 100)}</span></div>
      <div className="mt-2 flex items-center justify-between"><span className="text-stone-500">日常{transaction.type === 'refund' ? '入账' : '支出'}部分</span><span className={`font-medium tabular-nums ${remainder < 0 ? 'text-red-500' : 'text-brand-700'}`}>¥{formatMoney(remainder)}</span></div>
    </div>
    <p className="mt-2 text-xs leading-relaxed text-stone-500">所属到期日用于区分每一期账单，可选择补交或提前支付的期次。固定退款不能超过该期已关联的支付金额。</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
    <div className="mt-4 flex gap-3">
      <button type="button" disabled={busy || !ready || rows.length === 0} onClick={() => { setRows([]); setError('') }} className="ios-button ios-button-secondary ios-button-compact text-sm">取消全部分摊</button>
      <button type="button" disabled={busy || !ready} onClick={() => void submit()} className="ios-button ios-button-primary flex-1">{busy ? '保存中…' : '保存分摊'}</button>
    </div>
  </Modal>
}
