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

  const overrides = useMemo(
    () =>
      (overridesData.data ?? []).map((o) => ({
        date: o.date,
        amount: o.amount,
      })),
    [overridesData.data],
  )

  const state = useMemo(() => {
    if (loading || error || engineEvents.length === 0) return null
    return computeBudgetState({
      events: engineEvents,
      transactions: engineTxs,
      today,
      carryoverAcrossPeriod: carryover,
      overrides,
    })
  }, [engineEvents, engineTxs, today, carryover, overrides, loading, error])

  const reserve: ReserveResult = useMemo(() => {
    if (!state) return { reserved: 0, upcoming: [] }
    return computeReserve(
      billsData.data?.bills ?? [],
      billsData.data?.payments ?? [],
      state.periodStart,
      state.periodEnd,
      today,
    )
  }, [state, billsData.data, today])

  const reserveEnabled = settings.data?.reserveEnabled !== false

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
