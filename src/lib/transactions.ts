import type { Tx } from '../api/types'

/** 未记录时刻的交易置于当天末尾，不能用创建时间冒充发生时间。 */
export function sortTransactions(txs: readonly Tx[]): Tx[] {
  return [...txs].sort((a, b) =>
    b.occurredAt.localeCompare(a.occurredAt) ||
    (b.occurredTime ?? '').localeCompare(a.occurredTime ?? '') || b.id - a.id,
  )
}
