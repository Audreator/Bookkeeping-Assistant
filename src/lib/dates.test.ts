import { describe, expect, it } from 'vitest'
import {
  addDays,
  daysBetween,
  formatCN,
  fromISO,
  monthKey,
  round2,
  startOfWeekISO,
  toISO,
  toLocalTime,
  calendarOffset,
} from './dates'

describe('dates', () => {
  it('toISO 使用本地时区，不因 UTC 偏移漂移', () => {
    expect(toISO(new Date(2026, 9, 4, 23, 59))).toBe('2026-10-04')
    expect(toISO(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01')
  })

  it('toLocalTime 保留本地秒，不使用 UTC 时间', () => {
    expect(toLocalTime(new Date(2026, 9, 4, 9, 5, 3))).toBe('09:05:03')
    expect(toLocalTime(new Date(2026, 9, 4, 23, 59, 59))).toBe('23:59:59')
  })

  it('fromISO 返回本地零点', () => {
    const d = fromISO('2026-10-04')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(9)
    expect(d.getDate()).toBe(4)
    expect(d.getHours()).toBe(0)
  })

  it('addDays 跨月', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('addDays 闰年', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01')
  })

  it('daysBetween 日历天差', () => {
    expect(daysBetween('2026-02-27', '2026-03-02')).toBe(3)
    expect(daysBetween('2026-10-04', '2026-10-04')).toBe(0)
    expect(daysBetween('2026-10-05', '2026-10-04')).toBe(-1)
  })

  it('startOfWeekISO 周一起始', () => {
    expect(startOfWeekISO('2026-10-04', 1)).toBe('2026-09-28')
    expect(startOfWeekISO('2026-09-28', 1)).toBe('2026-09-28')
  })

  it('日历月/周期间按真实起点星期对齐，周一和任意日切换都正确', () => {
    expect(calendarOffset('2026-10-05', 1)).toBe(0)
    expect(calendarOffset('2026-10-04', 1)).toBe(6)
    expect(calendarOffset('2026-10-07', 1)).toBe(2)
    expect(calendarOffset('2026-10-04', 7)).toBe(0)
    expect(calendarOffset('2026-10-07', 7)).toBe(3)
  })

  it('startOfWeekISO 周日起始', () => {
    expect(startOfWeekISO('2026-10-04', 7)).toBe('2026-10-04')
    expect(startOfWeekISO('2026-10-10', 7)).toBe('2026-10-04')
  })

  it('formatCN 中文日期与星期', () => {
    expect(formatCN('2026-10-04')).toBe('10月4日 周日')
    expect(formatCN('2026-01-01')).toBe('1月1日 周四')
  })

  it('round2 消除浮点误差', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(round2(1.005)).toBe(1.01)
    expect(round2(100)).toBe(100)
    expect(round2(-0.125)).toBe(-0.13)
  })

  it('round2 把浮点残差归零，不因科学计数法得到 NaN', () => {
    expect(round2(0.1 + 0.2 - 0.3)).toBe(0)
    expect(round2(0.01 + 0.02 - 0.01 - 0.02)).toBe(0)
    expect(round2(1.734723475976807e-18)).toBe(0)
    expect(round2(-1.734723475976807e-18)).toBe(0)
  })

  it('monthKey 提取年月', () => {
    expect(monthKey('2026-10-04')).toBe('2026-10')
    expect(monthKey('2026-01-31')).toBe('2026-01')
  })
})
