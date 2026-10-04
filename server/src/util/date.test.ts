import { describe, expect, it } from 'vitest'
import { round2 } from './date'

describe('round2', () => {
  it('四舍五入到分并消除浮点误差', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(round2(1.005)).toBe(1.01)
    expect(round2(-0.125)).toBe(-0.13)
    expect(round2(100)).toBe(100)
  })

  it('把浮点残差归零，不因科学计数法得到 NaN', () => {
    expect(round2(0.01 + 0.02 - 0.01 - 0.02)).toBe(0)
    expect(round2(1.734723475976807e-18)).toBe(0)
    expect(round2(-1.734723475976807e-18)).toBe(0)
  })
})