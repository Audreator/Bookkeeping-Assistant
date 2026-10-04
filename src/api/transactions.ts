import { api } from './client'
import type { Tx } from './types'

interface TransactionPage {
  transactions: Tx[]
  nextCursor: number | null
}

/** ID 游标避免按交易日期分页漏掉回补记录；请求失败不能返回部分数据。 */
export async function fetchAllTransactions(): Promise<Tx[]> {
  const list: Tx[] = []
  let cursor: number | null = null
  for (;;) {
    const page: TransactionPage = await api.get<TransactionPage>(
      `/api/transactions?pagination=id&limit=2000${cursor === null ? '' : `&beforeId=${cursor}`}`,
    )
    list.push(...page.transactions)
    if (page.nextCursor === null) return list
    if (!Number.isSafeInteger(page.nextCursor) || page.nextCursor <= 0 ||
      (cursor !== null && page.nextCursor >= cursor)) {
      throw new Error('交易分页游标无效，请重试')
    }
    cursor = page.nextCursor
  }
}
