import { useState } from 'react'
import { useTransactionMutations } from '../api/hooks'
import type { TxInput } from '../api/hooks'
import type { Tx } from '../api/types'
import { fetchAllTransactions } from '../api/transactions'
import { dedupe, parseAlipayCSV, parseWeChatCSV, type ParsedBill } from '../lib/billimport'
import { Modal } from './Modal'
import { ModalToolbar } from './ModalToolbar'
import { makeRequestId } from '../lib/requestId'

interface ImportRow extends ParsedBill {
  requestId: string
  categoryId: number | null
}

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { create } = useTransactionMutations()
  const [stage, setStage] = useState<'pick' | 'preview'>('pick')
  const [fresh, setFresh] = useState<ImportRow[]>([])
  const [dupes, setDupes] = useState<ParsedBill[]>([])
  const [sourceName, setSourceName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [imported, setImported] = useState(0)

  if (!open) return null

  const reset = () => {
    setStage('pick')
    setFresh([])
    setDupes([])
    setSourceName('')
    setError('')
    setImported(0)
  }

  const handleFile = async (file: File) => {
    setError('')
    setBusy(true)
    try {
    const buf = await file.arrayBuffer()
    let text = new TextDecoder('utf-8').decode(buf)
    if (text.includes('\uFFFD')) {
      try {
        text = new TextDecoder('gbk').decode(buf)
      } catch {
        // 保留 UTF-8 结果
      }
    }
    const isAlipay = text.includes('支付宝')
    const bills = isAlipay ? parseAlipayCSV(text) : parseWeChatCSV(text)
    if (bills.length === 0) {
      setError('未能识别账单格式：请选择微信或支付宝官方导出的 CSV 账单文件')
      return
    }
    // 预览前完整读取最新账本；失败不能降级为空数组，否则会重复入账。
    const existing = await fetchAllTransactions()
    const result = dedupe(bills, existing)
    setFresh(result.fresh.map((bill) => ({ ...bill, requestId: makeRequestId('csv'),
      categoryId: guessCategory(bill.merchant, existing) })))
    setDupes(result.dupes)
    setSourceName(isAlipay ? '支付宝' : '微信')
    setStage('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : '文件读取失败，请重新选择')
    } finally {
      setBusy(false)
    }
  }

  const guessCategory = (merchant: string, existing: Tx[]): number | null => {
    const hit = existing.find(
      (t) => t.merchant && t.categoryId != null && t.merchant === merchant,
    )
    return hit?.categoryId ?? null
  }

  const confirm = async () => {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      for (const bill of fresh) {
        const input: TxInput = {
          type: bill.type,
          amount: bill.amount,
          merchant: bill.merchant || null,
          note: bill.note || null,
          occurredAt: bill.occurredAt,
          occurredTime: bill.occurredTime,
          source: 'import',
          categoryId: bill.categoryId,
          requestId: bill.requestId,
        }
        await create.mutateAsync(input)
        setFresh((remaining) => remaining.filter((row) => row.requestId !== bill.requestId))
        setImported((count) => count + 1)
      }
      reset()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal label="账单对账导入" onClose={() => { if (!busy) { reset(); onClose() } }}>
        <ModalToolbar title="账单对账导入" onClose={() => { reset(); onClose() }} onConfirm={() => void confirm()}
          confirmLabel="确认导入" busy={busy} confirmDisabled={stage !== 'preview' || fresh.length === 0} />
        {stage === 'pick' ? (
          <>
            <p className="mb-3 text-xs leading-relaxed text-stone-500">
              微信：我 → 服务 → 钱包 → 账单 → 常见问题 → 下载账单 → 用于个人对账；
              支付宝：我的 → 账单 → 开具交易流水证明 → 导出。下载后解压得到 CSV 文件，在此导入。
              系统会自动去除与已有记录重复的部分。
            </p>
            <label className="block cursor-pointer rounded-xl border border-dashed border-stone-300 py-8 text-center text-sm text-stone-500">
              选择 CSV 账单文件
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleFile(file)
                }}
              />
            </label>
          </>
        ) : (
          <>
            <p className="mb-2 text-sm">
              识别到 {sourceName}账单：<span className="font-medium text-brand-700">{fresh.length}</span> 笔新记录，
              重复跳过 {dupes.length} 笔。
            </p>
            {imported > 0 && <p className="mb-2 text-xs text-stone-500">已导入 {imported} 笔，剩余 {fresh.length} 笔。重试会继续完成剩余记录。</p>}
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl bg-stone-50 p-2 text-xs">
              {fresh.slice(0, 50).map((b) => (
                <li key={b.requestId} className="flex items-center justify-between gap-2">
                  <span className="truncate text-stone-600">
                    {b.occurredAt.slice(5)} {b.occurredTime ?? '时间未记录'} {b.merchant || b.note || '未记录商家'}
                  </span>
                  <span className="text-stone-800">
                    {b.type === 'refund' ? '+' : '-'}¥{b.amount.toFixed(2)}
                  </span>
                </li>
              ))}
              {fresh.length > 50 && <li className="text-stone-400">…还有 {fresh.length - 50} 笔</li>}
            </ul>
          </>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (busy) return
              reset()
              onClose()
            }}
            className="ios-button ios-button-secondary flex-1"
          >
            {stage === 'pick' ? '取消' : '返回'}
          </button>
          {stage === 'preview' && (
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy || fresh.length === 0}
              className="ios-button ios-button-primary flex-1"
            >
              {busy ? '导入中…' : `导入 ${fresh.length} 笔`}
            </button>
          )}
        </div>
    </Modal>
  )
}
