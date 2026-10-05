import { useState } from 'react'
import { useCategories, useTransactionMutations, type TxInput } from '../api/hooks'
import type { Tx, TxType } from '../api/types'
import { round2, todayISO, toLocalTime } from '../lib/dates'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { ModalToolbar } from './ModalToolbar'
import { makeRequestId } from '../lib/requestId'
import { FixedAllocationDialog } from './FixedAllocationDialog'

interface Props {
  open: boolean
  onClose: () => void
  editing?: Tx | null
  defaultDate?: string
}

export function QuickAdd({ open, onClose, editing, defaultDate }: Props) {
  if (!open) return null
  return <QuickAddForm key={editing ? JSON.stringify(editing) : `new-${defaultDate ?? ''}`}
    open={open} onClose={onClose} editing={editing} defaultDate={defaultDate} />
}

function QuickAddForm({ open, onClose, editing, defaultDate }: Props) {
  const { data: categories } = useCategories()
  const { create, update, remove } = useTransactionMutations()

  const [type, setType] = useState<TxType>(editing?.type ?? 'expense')
  const [amount, setAmount] = useState(editing ? String(editing.amount) : '')
  const [categoryId, setCategoryId] = useState<number | null>(editing?.categoryId ?? null)
  const [merchant, setMerchant] = useState(editing?.merchant ?? '')
  const [note, setNote] = useState(editing?.note ?? '')
  const [date, setDate] = useState(editing?.occurredAt ?? defaultDate ?? todayISO())
  const [time, setTime] = useState(() => editing ? editing.occurredTime ?? '' :
    !defaultDate || defaultDate === todayISO() ? toLocalTime(new Date()) : '')
  const [autoTime, setAutoTime] = useState(!editing && (!defaultDate || defaultDate === todayISO()))
  const [requestId] = useState(() => makeRequestId('manual'))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [allocationOpen, setAllocationOpen] = useState(false)

  const submit = async () => {
    if (busy) return
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      setError('请输入正确的金额')
      return
    }
    if (!date) { setError('请选择交易日期'); return }
    const normalizedTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? `${time}:00` : time
    if (normalizedTime && !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(normalizedTime)) {
      setError('请填写正确的交易时间，格式为 时:分:秒'); return
    }
    const input: TxInput = {
      type,
      amount: round2(value),
      categoryId,
      merchant: merchant.trim() || null,
      note: note.trim() || null,
      occurredAt: date,
      occurredTime: normalizedTime || null,
      ...(editing?.status === 'pending' ? { status: 'confirmed' as const } : {}),
    }
    setBusy(true)
    try {
      if (editing) await update.mutateAsync({ id: editing.id, patch: input })
      else await create.mutateAsync({ ...input, source: 'manual', requestId })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!editing) return
    if (!window.confirm('确定删除这笔记录吗？')) return
    setBusy(true)
    try {
      await remove.mutateAsync(editing.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setBusy(false)
    }
  }

  const inputClass =
    'w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 outline-none focus:border-brand-500'
  const changed = editing && (type !== editing.type || Number(amount) !== editing.amount ||
    categoryId !== editing.categoryId || merchant !== (editing.merchant ?? '') || note !== (editing.note ?? '') ||
    date !== editing.occurredAt || time !== (editing.occurredTime ?? ''))
  if (allocationOpen && editing) return <FixedAllocationDialog transaction={editing} onClose={() => setAllocationOpen(false)} />

  return (
    <Modal open={open} label={editing ? '编辑交易' : '记一笔'} sheet onClose={() => { if (!busy) onClose() }}>
        <div className="sheet-handle" />
        <ModalToolbar title={editing ? '编辑交易' : '记一笔'} onClose={onClose} onConfirm={() => void submit()}
          confirmLabel={editing?.status === 'pending' ? '确认交易' : '保存交易'} busy={busy}
          confirmDisabled={!Number.isFinite(Number(amount)) || Number(amount) <= 0 || !date} />
        <div className="mb-3 flex rounded-xl bg-stone-100 p-1 text-sm">
          {(
            [
              ['expense', '支出'],
              ['refund', '退款'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={type === value}
              onClick={() => setType(value)}
              className={`flex-1 rounded-lg py-1.5 ${
                type === value ? 'bg-white font-medium text-brand-700 shadow-sm' : 'text-stone-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="amount-field flex items-baseline gap-2 rounded-2xl px-4 py-4">
          <span className="text-lg text-stone-400">¥</span>
          <input
            className="w-full bg-transparent text-3xl font-semibold outline-none"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            aria-label="金额（元）"
            data-autofocus
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {(categories ?? []).map((cat) => (
            <button
              key={cat.id}
              type="button"
              aria-pressed={categoryId === cat.id}
              onClick={() => setCategoryId(categoryId === cat.id ? null : cat.id)}
              className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-sm ${
                categoryId === cat.id
                  ? 'border-brand-600 bg-brand-50 text-brand-700'
                  : 'border-stone-200 text-stone-600'
              }`}
            >
              <span className="category-icon">{cat.icon}</span>
              <span>{cat.name}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 space-y-3">
          <label className="block"><span className="mb-1.5 block text-xs text-stone-500">商家 / 对方</span><input
            className={inputClass}
            placeholder="商家 / 对方（可选）"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
          /></label>
          <label className="block"><span className="mb-1.5 block text-xs text-stone-500">备注</span><input
            className={inputClass}
            placeholder="备注（可选）"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          /></label>
          <div className="grid grid-cols-2 gap-3">
          <label className="block min-w-0"><span className="mb-1.5 block text-xs text-stone-500">交易日期</span><input
            className={inputClass}
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              if (autoTime && e.target.value !== todayISO()) { setTime(''); setAutoTime(false) }
            }}
          /></label>
          <label className="block min-w-0"><span className="mb-1.5 block text-xs text-stone-500">交易时间</span>
            <input className={inputClass} type="time" step="1" value={time}
              onInput={(e) => { setTime(e.currentTarget.value); setAutoTime(false) }}
              onChange={(e) => { setTime(e.target.value); setAutoTime(false) }} />
          </label>
          </div>
          <div className="flex items-center justify-between text-xs text-stone-500">
            <span>{time ? '按实际交易时间记录，精确到秒' : '时间未记录，可补充实际交易时刻'}</span>
            <button type="button" onClick={() => { setTime(''); setAutoTime(false) }} className="ios-button ios-button-link shrink-0">清空时间</button>
          </div>
        </div>

        {editing ? <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50/70 p-3">
          <button type="button" disabled={busy || Boolean(changed) || editing.status !== 'confirmed'}
            onClick={() => setAllocationOpen(true)} className="ios-button ios-button-secondary ios-button-spread w-full text-sm">
            {editing.type === 'refund' ? '分摊固定退款' : '分摊到固定支出'} <Icon name="chevron-right" />
          </button>
          <p className="mt-1 text-xs leading-relaxed text-stone-500">{changed ? '请先保存交易修改，再打开分摊。' : editing.status !== 'confirmed' ? '请先确认这笔交易。' : '房租、水费一起付？选择多项并分配金额，保留原始流水。'}</p>
        </div> : <p className="mt-4 text-xs leading-relaxed text-stone-500">房租等固定支出：保存后点开这笔记录，可分摊到一项或多项账单。</p>}

        {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}

        <div className="mt-4 flex gap-3">
          {editing && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="ios-button ios-button-danger"
            >
              删除
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="ios-button ios-button-primary flex-1"
          >
            {busy ? '保存中…' : editing?.status === 'pending' ? '确认并保存' : '保存'}
          </button>
        </div>
    </Modal>
  )
}
