import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { fetchAllTransactions } from '../api/transactions'
import {
  useBillMutations,
  useBillsData,
  useCategories,
  useCategoryMutations,
  useSettings,
  useTransactions,
  useUpdateSettings,
} from '../api/hooks'
import type { Bill, Category, SettingsMap } from '../api/types'
import { ImportDialog } from '../components/ImportDialog'
import { Money } from '../components/Money'
import { Page } from '../components/Page'
import { buildBackup, decryptBackup, encryptBackup, mapBackupAllocations, type BackupData } from '../lib/backup'
import { daysInMonthKey, todayISO } from '../lib/dates'
import { computeReserve } from '../engine/reserve'
import { useAuth } from '../state/AuthContext'

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function Settings() {
  const { user, logout } = useAuth()
  const qc = useQueryClient()
  const settings = useSettings()
  const updateSettings = useUpdateSettings()
  const categories = useCategories()
  const catMut = useCategoryMutations()
  const billsData = useBillsData()
  const billMut = useBillMutations()
  const txs = useTransactions()

  const [error, setError] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const prefs: SettingsMap = settings.data ?? {}
  const today = todayISO()
  const month = today.slice(0, 7)
  const monthlyBills = computeReserve(billsData.data?.bills ?? [], billsData.data?.payments ?? [],
    `${month}-01`, `${month}-${daysInMonthKey(month)}`, today,
    { transactions: txs.data ?? [], allocations: billsData.data?.allocations ?? [] }).upcoming

  const collect = async (): Promise<BackupData> => {
    const [cs, ts, es, bs, st, os] = await Promise.all([
      api.get<{ categories: Category[] }>('/api/categories'),
      fetchAllTransactions(),
      api.get<{ events: unknown[] }>('/api/events'),
      api.get<{ bills: unknown[]; payments: unknown[]; allocations: unknown[] }>('/api/bills'),
      api.get<{ settings: SettingsMap }>('/api/settings'),
      api.get<{ overrides: unknown[] }>('/api/day-overrides'),
    ])
    return buildBackup({
      categories: cs.categories,
      transactions: ts,
      events: es.events,
      bills: bs.bills,
      payments: bs.payments,
      allocations: bs.allocations,
      settings: st.settings,
      overrides: os.overrides,
    }).data
  }

  const exportBackup = async (encrypted: boolean) => {
    setError('')
    setBusy(true)
    try {
      if (encrypted && !globalThis.crypto?.subtle) {
        throw new Error('加密备份需要 HTTPS 安全连接，请使用普通备份或 HTTPS 地址')
      }
      const data = await collect()
      const stamp = todayISO()
      if (encrypted) {
        const pass = window.prompt('设置备份口令（解密时需要，请牢记）：')
        if (!pass) return
        const blob = await encryptBackup(buildBackup(data), pass)
        downloadBlob(blob, `jizhang-backup-${stamp}.enc.json`)
      } else {
        downloadBlob(
          new Blob([JSON.stringify(buildBackup(data), null, 2)], { type: 'application/json' }),
          `jizhang-backup-${stamp}.json`,
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setBusy(false)
    }
  }

  const restore = async (data: BackupData) => {
    if (!window.confirm('导入将把备份内容追加到现有数据中，确定继续吗？')) return
    setBusy(true)
    setError('')
    try {
      const existing = await api.get<{ categories: Category[] }>('/api/categories')
      const byName = new Map(existing.categories.map((c) => [c.name, c.id]))
      const catMap = new Map<number, number>()
      for (const raw of (data.categories ?? []) as Array<Partial<Category>>) {
        if (!raw.name) continue
        const known = byName.get(raw.name)
        if (known != null) {
          if (raw.id != null) catMap.set(raw.id, known)
          continue
        }
        const res = await api.post<{ category: Category }>('/api/categories', {
          name: raw.name,
          icon: raw.icon ?? '',
          color: raw.color ?? '#64748b',
          sort: raw.sort ?? 0,
        })
        byName.set(raw.name, res.category.id)
        if (raw.id != null) catMap.set(raw.id, res.category.id)
      }

      const billMap = new Map<number, number>()
      for (const raw of (data.bills ?? []) as Array<Partial<Bill>>) {
        if (!raw.name || raw.amount == null || raw.dueDay == null) continue
        const res = await api.post<{ bill: Bill }>('/api/bills', {
          name: raw.name,
          amount: raw.amount,
          dueDay: raw.dueDay,
          remindDaysBefore: raw.remindDaysBefore ?? 3,
          active: raw.active ?? true,
          categoryId: raw.categoryId != null ? (catMap.get(raw.categoryId) ?? null) : null,
        })
        if (raw.id != null) billMap.set(raw.id, res.bill.id)
      }

      for (const raw of (data.events ?? []) as Array<{
        at: string
        mode: 'month' | 'week'
        monthBudget: number
        weekBudgetOverride: number | null
        cycleStartDay: number
        weekStartsOn: 1 | 7
        note?: string | null
      }>) {
        await api.post('/api/events', {
          at: raw.at,
          mode: raw.mode,
          monthBudget: raw.monthBudget,
          weekBudgetOverride: raw.weekBudgetOverride,
          cycleStartDay: raw.cycleStartDay,
          weekStartsOn: raw.weekStartsOn,
          note: raw.note ?? '导入备份',
        })
      }

      const txMap = new Map<number, number>()
      const importedTransactions = (data.transactions ?? []) as Array<{
        id?: number
        type: 'expense' | 'refund'
        amount: number
        categoryId?: number | null
        merchant?: string | null
        note?: string | null
        occurredAt: string
        occurredTime?: string | null
        source?: string
        refundOfId?: number | null
        status?: 'pending' | 'confirmed'
      }>
      for (const raw of importedTransactions) {
        const res = await api.post<{ transaction: { id: number } }>('/api/transactions', {
          type: raw.type,
          amount: raw.amount,
          categoryId: raw.categoryId != null ? (catMap.get(raw.categoryId) ?? null) : null,
          merchant: raw.merchant ?? null,
          note: raw.note ?? null,
          occurredAt: raw.occurredAt,
          occurredTime: raw.occurredTime ?? null,
          source: raw.source ?? 'import',
          status: raw.status ?? 'confirmed',
          refundOfId: null,
        })
        if (raw.id != null) txMap.set(raw.id, res.transaction.id)
      }

      // 备份通常按倒序导出；全部交易恢复后才能可靠映射退款的原交易。
      for (const raw of importedTransactions) {
        const restoredId = raw.id != null ? txMap.get(raw.id) : undefined
        const originalId = raw.refundOfId != null ? txMap.get(raw.refundOfId) : undefined
        if (restoredId != null && originalId != null) {
          await api.put(`/api/transactions/${restoredId}`, { refundOfId: originalId })
        }
      }

      for (const raw of (data.overrides ?? []) as Array<{ date: string; amount: number; note?: string | null }>) {
        await api.put('/api/day-overrides', { date: raw.date, amount: raw.amount, note: raw.note ?? null })
      }

      for (const group of mapBackupAllocations(data, txMap, billMap)) {
        await api.put(`/api/transactions/${group.transactionId}/fixed-allocations`, { allocations: group.allocations })
      }

      for (const raw of (data.payments ?? []) as Array<{
        billId: number
        periodKey: string
        paidAt: string
        transactionId?: number | null
      }>) {
        const newBill = billMap.get(raw.billId)
        if (!newBill) continue
        await api.post('/api/bill-payments', {
          billId: newBill,
          periodKey: raw.periodKey,
          paidAt: raw.paidAt,
          transactionId: raw.transactionId != null ? (txMap.get(raw.transactionId) ?? null) : null,
          // 支付标记未记录实际分摊金额；新旧备份都只恢复标记，不猜测整计划金额。
          markerOnly: true,
        })
      }

      if (data.settings && typeof data.settings === 'object') {
        await api.put('/api/settings', data.settings)
      }

      await qc.invalidateQueries()
      window.alert('导入完成')
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  const handleImportFile = async (file: File) => {
    setError('')
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        (parsed as { version?: number }).version === 1
      ) {
        await restore((parsed as { data: BackupData }).data)
      } else {
        if (!globalThis.crypto?.subtle) {
          throw new Error('加密备份需要 HTTPS 安全连接，请使用普通备份或 HTTPS 地址')
        }
        const pass = window.prompt('该备份已加密，请输入备份口令：')
        if (!pass) return
        const backup = await decryptBackup(file, pass)
        await restore(backup.data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '文件无法解析')
    }
  }

  const editCategory = async (cat: Category) => {
    const name = window.prompt('分类名称', cat.name)
    if (name == null) return
    const icon = window.prompt('图标（emoji）', cat.icon)
    if (icon == null) return
    try {
      await catMut.update.mutateAsync({ id: cat.id, patch: { name: name.trim() || cat.name, icon } })
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  const addCategory = async () => {
    const name = window.prompt('新分类名称：')
    if (!name?.trim()) return
    const icon = window.prompt('图标（emoji，可留空）：') ?? ''
    try {
      await catMut.create.mutateAsync({ name: name.trim(), icon })
    } catch (err) {
      setError(err instanceof Error ? err.message : '新增失败')
    }
  }

  const editBill = async (bill?: Bill) => {
    const name = window.prompt('账单名称', bill?.name ?? '')
    if (name == null || !name.trim()) return
    const amountText = window.prompt('金额（元）', bill ? String(bill.amount) : '')
    if (amountText == null) return
    const amount = Number(amountText)
    if (!Number.isFinite(amount) || amount <= 0) return
    const dueText = window.prompt('每月几号到期（1-28）', bill ? String(bill.dueDay) : '1')
    if (dueText == null) return
    const dueDay = Math.min(28, Math.max(1, Number(dueText) || 1))
    const remindText = window.prompt('提前几天提醒', bill ? String(bill.remindDaysBefore) : '3')
    if (remindText == null) return
    const remindDaysBefore = Math.min(30, Math.max(0, Number(remindText) || 0))
    try {
      if (bill) {
        await billMut.updateBill.mutateAsync({
          id: bill.id,
          patch: { name: name.trim(), amount, dueDay, remindDaysBefore },
        })
      } else {
        await billMut.createBill.mutateAsync({ name: name.trim(), amount, dueDay, remindDaysBefore })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  const sectionClass = 'glass-card overflow-hidden'
  const rowClass = 'flex w-full items-center justify-between px-4 py-3 text-left'

  return (
    <Page>
      <header><h1>设置</h1><p className="mt-1.5 text-xs text-stone-500">让账本，适合你的习惯</p></header>

      <section className={sectionClass}>
        <div className="border-b border-stone-100 px-4 py-3">
          <div className="text-sm font-medium">{user?.displayName}</div>
          <div className="text-xs text-stone-400">@{user?.username}</div>
        </div>
        <button type="button" className={`${rowClass} text-red-500`} onClick={logout}>
          退出登录
        </button>
      </section>

      <h2 className="mb-2 mt-5 px-1 text-xs text-stone-400">预算偏好</h2>
      <section className={sectionClass}>
        <label className={rowClass}>
          <span>
            <span className="block text-sm">扣除固定支出预留</span>
            <span className="text-xs text-stone-400">预留未付账单并覆盖固定支付，避免日常预算重复扣除</span>
          </span>
          <input
            type="checkbox"
            className="h-5 w-5 accent-brand-700"
            checked={prefs.reserveEnabled !== false}
            onChange={(e) => updateSettings.mutate({ reserveEnabled: e.target.checked })}
          />
        </label>
        <label className={`${rowClass} border-t border-stone-100`}>
          <span>
            <span className="block text-sm">跨期结转</span>
            <span className="text-xs text-stone-400">本期结余带入下个月/下一周（默认清零）</span>
          </span>
          <input
            type="checkbox"
            className="h-5 w-5 accent-brand-700"
            checked={prefs.carryoverAcrossPeriod === true}
            onChange={(e) => updateSettings.mutate({ carryoverAcrossPeriod: e.target.checked })}
          />
        </label>
      </section>

      <h2 className="mb-2 mt-5 flex items-center justify-between px-1 text-xs text-stone-400">
        <span>分类管理</span>
        <button type="button" className="text-brand-700" onClick={() => void addCategory()}>
          ＋ 新增
        </button>
      </h2>
      <section className={sectionClass}>
        <div className="flex flex-wrap gap-2 p-4">
          {(categories.data ?? []).map((cat) => (
            <span key={cat.id} className="flex items-center gap-1 rounded-full border border-stone-200 py-1 pl-3 pr-1 text-sm">
              <button type="button" onClick={() => void editCategory(cat)}>
                <span className="category-icon">{cat.icon}</span> {cat.name}
              </button>
              <button
                type="button"
                aria-label={`删除分类 ${cat.name}`}
                className="px-1.5 text-xs text-stone-300"
                onClick={() => {
                  if (!window.confirm(`删除分类「${cat.name}」？`)) return
                  catMut.remove.mutate(cat.id, {
                    onError: (err) => setError(err instanceof Error ? err.message : '删除失败'),
                  })
                }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      </section>

      <h2 className="mb-2 mt-5 flex items-center justify-between px-1 text-xs text-stone-400">
        <span>固定支出</span>
        <button type="button" className="text-brand-700" onClick={() => void editBill()}>
          ＋ 新增
        </button>
      </h2>
      <section className={sectionClass}>
        <p className="border-b border-stone-100 px-4 py-3 text-xs leading-relaxed text-stone-500">支付后在「账本」点开流水，选择「分摊到固定支出」。一笔可分摊房租、水费，也可分次付；流水与统计保留实际金额。旧支付标记仅用于展示，预算按实际分摊金额计算。</p>
        {(billsData.data?.bills ?? []).length === 0 ? (
          <p className="px-4 py-4 text-sm text-stone-400">暂无固定支出（房租、订阅等）</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {(billsData.data?.bills ?? []).map((bill) => {
              const progress = monthlyBills.find((item) => item.billId === bill.id)
              return (
              <li key={bill.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void editBill(bill)}>
                  <span className="block truncate">
                    {bill.name}
                    {!bill.active && <span className="ml-1 text-xs text-stone-400">（停用）</span>}
                  </span>
                  <span className="text-xs text-stone-400">
                    每月 {bill.dueDay} 号 · 提前 {bill.remindDaysBefore} 天提醒
                  </span>
                  {progress && <span className={`mt-1 block text-xs ${progress.paid ? 'text-brand-700' : 'text-stone-500'}`}>
                    本月到期 · {progress.paid && progress.paidAmount === 0 && progress.remainingAmount > 0
                      ? '已标记支付 · 金额未关联'
                      : `${progress.paid ? '已付' : progress.paidAmount > 0 ? '部分支付' : '未付'} ¥${progress.paidAmount.toFixed(2)}${!progress.paid ? ` · 待付 ¥${progress.remainingAmount.toFixed(2)}` : ''}`}
                  </span>}
                </button>
                <Money value={bill.amount} className="mr-2" />
                <button type="button" aria-label={`${bill.active ? '停用' : '启用'}固定支出 ${bill.name}`}
                  className="mr-2 shrink-0 text-xs text-brand-700" onClick={() => billMut.updateBill.mutate({ id: bill.id, patch: { active: !bill.active } }, {
                    onError: (err) => setError(err instanceof Error ? err.message : '账单状态修改失败'),
                  })}>{bill.active ? '停用' : '启用'}</button>
                <button
                  type="button"
                  aria-label={`删除固定支出 ${bill.name}`}
                  className="text-xs text-stone-300"
                  onClick={() => {
                    if (!window.confirm(`删除固定支出「${bill.name}」？`)) return
                    billMut.removeBill.mutate(bill.id, {
                      onError: (err) => setError(err instanceof Error ? err.message : '删除失败'),
                    })
                  }}
                >
                  ✕
                </button>
              </li>
            )})}
          </ul>
        )}
      </section>

      <h2 className="mb-2 mt-5 px-1 text-xs text-stone-400">数据</h2>
      <section className={sectionClass}>
        <button type="button" className={rowClass} onClick={() => setImportOpen(true)}>
          <span>
            <span className="block text-sm">账单对账导入</span>
            <span className="text-xs text-stone-400">导入微信/支付宝 CSV 账单，自动去重</span>
          </span>
          <span className="text-stone-300">›</span>
        </button>
        <div className="grid grid-cols-2 gap-2 border-t border-stone-100 p-4">
          <button
            type="button"
            disabled={busy}
            className="rounded-xl border border-stone-200 py-2 text-sm text-stone-600 disabled:opacity-50"
            onClick={() => void exportBackup(false)}
          >
            导出备份
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-xl border border-stone-200 py-2 text-sm text-stone-600 disabled:opacity-50"
            onClick={() => void exportBackup(true)}
          >
            加密导出
          </button>
          <label className="col-span-2 cursor-pointer rounded-xl border border-stone-200 py-2 text-center text-sm text-stone-600">
            导入备份文件
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleImportFile(file)
                e.target.value = ''
              }}
            />
          </label>
        </div>
        <p className="px-4 pb-4 text-xs text-stone-400">
          已加载 {txs.data?.length ?? 0} 笔交易记录
        </p>
      </section>

      <h2 className="mb-2 mt-5 px-1 text-xs text-stone-400">关于</h2>
      <section className={`${sectionClass} px-4 py-3 text-xs leading-relaxed text-stone-500`}>
        记账本 · 私人预算与账单
        <br />
        每日预算自动结转，支出与退款清楚留存。数据保存在你的记账服务中。
      </section>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-500" onClick={() => setError('')}>
          {error}
        </p>
      )}

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </Page>
  )
}
