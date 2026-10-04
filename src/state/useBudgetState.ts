import { useMemo } from 'react'
import {
  useBillsData,
  useDayOverrides,
  useEvents,
  useSettings,
  useTransactions,
} from '../api/hooks'
import { computeBudgetState } from '../engine/engine'
import { computeReserve, type ReserveResult } from '../engine/reserve'
import type { BudgetEvent, EngineTx } from '../engine/types'
import { todayISO } from '../lib/dates'

export function useBudgetState() {
  const txs = useTransactions()
  const events = useEvents()
  const settings = useSettings()
  const billsData = useBillsData()
  const overridesData = useDayOverrides()
  const today = todayISO()

  const loading =
    txs.isLoading ||
    events.isLoading ||
    settings.isLoading ||
    billsData.isLoading ||
    overridesData.isLoading
  const error = txs.error ?? events.error ?? settings.error ?? billsData.error ?? overridesData.error

  const engineEvents: BudgetEvent[] = useMemo(
    () =>
      (events.data ?? []).map((e) => ({
        id: String(e.id),
        at: e.at,
        mode: e.mode,
        monthBudget: e.monthBudget,
        weekBudgetOverride: e.weekBudgetOverride,
        cycleStartDay: e.cycleStartDay,
        weekStartsOn: e.weekStartsOn,
        note: e.note ?? undefined,
        createdAt: e.createdAt,
      })),
    [events.data],
  )

  const engineTxs: EngineTx[] = useMemo(
    () =>
      (txs.data ?? []).map((t) => ({
        id: String(t.id),
        type: t.type,
        amount: t.amount,
        occurredAt: t.occurredAt,
        status: t.status,
      })),
    [txs.data],
  )

  const carryover = settings.data?.carryoverAcrossPeriod === true
  const reserveEnabled = settings.data?.reserveEnabled !== false

  const overrides = useMemo(
    () =>
      (overridesData.data ?? []).map((o) => ({
        date: o.date,
        amount: o.amount,
      })),
    [overridesData.data],
  )

  const engineInput = useMemo(() => ({
    events: engineEvents,
    transactions: engineTxs,
    today,
    carryoverAcrossPeriod: carryover,
    overrides,
  }), [engineEvents, engineTxs, today, carryover, overrides])

  // 两遍计算：第一遍确定当期边界，算出当期固定支出后第二遍从当期总预算中扣除。
  const baseState = useMemo(() => {
    if (loading || error || engineEvents.length === 0) return null
    return computeBudgetState(engineInput)
  }, [engineInput, engineEvents.length, loading, error])

  const reserve: ReserveResult = useMemo(() => {
    if (!baseState) return { reserved: 0, upcoming: [] }
    return computeReserve(
      billsData.data?.bills ?? [],
      billsData.data?.payments ?? [],
      baseState.periodStart,
      baseState.periodEnd,
      today,
    )
  }, [baseState, billsData.data, today])

  const state = useMemo(() => {
    if (!baseState) return null
    if (!reserveEnabled || reserve.reserved <= 0) return baseState
    return computeBudgetState({
      ...engineInput,
      fixedReserve: { periodStart: baseState.periodStart, amount: reserve.reserved },
    })
  }, [baseState, engineInput, reserveEnabled, reserve.reserved])

  return {
    state,
    reserve,
    reserveEnabled,
    loading,
    error,
    retry: () => { void Promise.allSettled([
      txs.refetch(), events.refetch(), settings.refetch(), billsData.refetch(), overridesData.refetch(),
    ]) },
    today,
    overrides: overridesData.data ?? [],
  }
}
