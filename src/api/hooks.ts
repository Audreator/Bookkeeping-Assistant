import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { fetchAllTransactions } from './transactions'
import { sortTransactions } from '../lib/transactions'
import type {
  Bill,
  BillPayment,
  BudgetEventDTO,
  Category,
  DayOverride,
  SettingsMap,
  Tx,
  TxSource,
  TxType,
  User,
} from './types'

export const qk = {
  me: ['me'] as const,
  transactions: ['transactions'] as const,
  categories: ['categories'] as const,
  events: ['events'] as const,
  bills: ['bills'] as const,
  dayOverrides: ['day-overrides'] as const,
  settings: ['settings'] as const,
}

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => api.get<{ user: User }>('/api/auth/me').then((r) => r.user),
    retry: false,
  })
}

export function useTransactions() {
  return useQuery({
    queryKey: qk.transactions,
    queryFn: () => fetchAllTransactions().then(sortTransactions),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
}

export function useCategories() {
  return useQuery({
    queryKey: qk.categories,
    queryFn: () => api.get<{ categories: Category[] }>('/api/categories').then((r) => r.categories),
  })
}

export function useEvents() {
  return useQuery({
    queryKey: qk.events,
    queryFn: () => api.get<{ events: BudgetEventDTO[] }>('/api/events').then((r) => r.events),
  })
}

export function useBillsData() {
  return useQuery({
    queryKey: qk.bills,
    queryFn: () => api.get<{ bills: Bill[]; payments: BillPayment[] }>('/api/bills'),
  })
}

export function useDayOverrides() {
  return useQuery({
    queryKey: qk.dayOverrides,
    queryFn: () =>
      api.get<{ overrides: DayOverride[] }>('/api/day-overrides').then((r) => r.overrides),
  })
}

export function useSettings() {
  return useQuery({
    queryKey: qk.settings,
    queryFn: () => api.get<{ settings: SettingsMap }>('/api/settings').then((r) => r.settings),
  })
}

function useInvalidator() {
  const qc = useQueryClient()
  return (keys: ReadonlyArray<readonly unknown[]>) => {
    for (const key of keys) void qc.invalidateQueries({ queryKey: key })
  }
}

export interface TxInput {
  type: TxType
  amount: number
  categoryId?: number | null
  merchant?: string | null
  note?: string | null
  occurredAt: string
  occurredTime?: string | null
  source?: TxSource
  refundOfId?: number | null
  status?: 'pending' | 'confirmed'
  requestId?: string
}

export function useTransactionMutations() {
  const invalidate = useInvalidator()
  const fresh = () => invalidate([qk.transactions])

  const create = useMutation({
    mutationFn: (input: TxInput) =>
      api.post<{ transaction: Tx }>('/api/transactions', input).then((r) => r.transaction),
    onSuccess: fresh,
  })
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<TxInput> }) =>
      api.put<{ transaction: Tx }>(`/api/transactions/${id}`, patch).then((r) => r.transaction),
    onSuccess: fresh,
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/transactions/${id}`),
    onSuccess: () => invalidate([qk.transactions, qk.bills]),
  })
  return { create, update, remove }
}

export function useCategoryMutations() {
  const invalidate = useInvalidator()
  const fresh = () => invalidate([qk.categories])
  const create = useMutation({
    mutationFn: (input: Partial<Category>) => api.post('/api/categories', input),
    onSuccess: fresh,
  })
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Category> }) =>
      api.put(`/api/categories/${id}`, patch),
    onSuccess: fresh,
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/categories/${id}`),
    onSuccess: fresh,
  })
  return { create, update, remove }
}

export function useCreateEvent() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (input: Omit<BudgetEventDTO, 'id' | 'createdAt'>) =>
      api.post<{ event: BudgetEventDTO }>('/api/events', input).then((r) => r.event),
    onSuccess: () => invalidate([qk.events]),
  })
}

export function useBillMutations() {
  const invalidate = useInvalidator()
  const fresh = () => invalidate([qk.bills])
  const createBill = useMutation({
    mutationFn: (input: Partial<Bill>) => api.post('/api/bills', input),
    onSuccess: fresh,
  })
  const updateBill = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Bill> }) =>
      api.put(`/api/bills/${id}`, patch),
    onSuccess: fresh,
  })
  const removeBill = useMutation({
    mutationFn: (id: number) => api.del(`/api/bills/${id}`),
    onSuccess: fresh,
  })
  const payBill = useMutation({
    mutationFn: (input: { billId: number; periodKey: string; paidAt: string; transactionId?: number | null }) =>
      api.post('/api/bill-payments', input),
    onSuccess: fresh,
  })
  const payBillWithTransaction = useMutation({
    mutationFn: ({ billId, ...input }: { billId: number; periodKey: string; paidAt: string; occurredTime?: string | null }) =>
      api.post<{ payment: BillPayment; transaction: Tx | null; duplicate: boolean }>(`/api/bills/${billId}/pay`, input),
    onSuccess: () => invalidate([qk.bills, qk.transactions]),
  })
  const removePayment = useMutation({
    mutationFn: (id: number) => api.del(`/api/bill-payments/${id}`),
    onSuccess: fresh,
  })
  return { createBill, updateBill, removeBill, payBill, payBillWithTransaction, removePayment }
}

export function useDayOverrideMutations() {
  const invalidate = useInvalidator()
  const fresh = () => invalidate([qk.dayOverrides])
  const save = useMutation({
    mutationFn: (input: { date: string; amount: number; note?: string }) =>
      api.put<{ override: DayOverride }>('/api/day-overrides', input).then((r) => r.override),
    onSuccess: fresh,
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/day-overrides/${id}`),
    onSuccess: fresh,
  })
  return { save, remove }
}

export function useUpdateSettings() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (patch: SettingsMap) => api.put('/api/settings', patch),
    onSuccess: () => invalidate([qk.settings]),
  })
}
