import { describe, expect, it } from 'vitest'
import type { Tx } from '../api/types'
import { dedupe, parseAlipayCSV, parseWeChatCSV } from './billimport'

const WECHAT_CSV = `微信支付账单明细
微信昵称：[测试]
起始时间：[2026-10-01 00:00:00] 终止时间：[2026-10-31 23:59:59]
导出类型：[全部]
----------------------微信支付账单明细列表--------------------
交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注
2026-10-03 12:30:00,商户消费,肯德基,"汉堡,可乐",支出,¥35.50,招商银行(1234),支付成功,4200001,商户001,
2026-10-05 08:10:00,商户消费,地铁,乘车码,支出,¥4.00,零钱,支付成功,4200002,商户002,
2026-10-06 20:00:00,退款,肯德基,退款,收入,¥35.50,招商银行(1234),退款成功,4200003,商户001,
`

const ALIPAY_CSV = `支付宝交易记录明细查询
账号:[test@example.com]
起始日期:[2026-10-01 00:00:00] 终止日期:[2026-10-31 23:59:59]
---------------------------------交易记录明细列表------------------------------------
交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注
2026-10-02 19:00:00,餐饮美食,沙县小吃,,拌面,支出,15.00,余额宝,交易成功,20261002001,,无
2026-10-04 10:00:00,日用百货,淘宝,,日用品,支出,129.00,花呗,交易成功,20261004001,,无
`

describe('parseWeChatCSV', () => {
  it('解析交易行、方向与退款标识、带引号逗号的商品名', () => {
    const bills = parseWeChatCSV(WECHAT_CSV)
    expect(bills).toHaveLength(3)
    expect(bills[0]).toMatchObject({
      occurredAt: '2026-10-03',
      occurredTime: '12:30:00',
      amount: 35.5,
      type: 'expense',
      merchant: '肯德基',
      note: '汉堡,可乐',
    })
    expect(bills[1].type).toBe('expense')
    expect(bills[2].type).toBe('refund')
  })
})

describe('parseAlipayCSV', () => {
  it('解析交易行', () => {
    const bills = parseAlipayCSV(ALIPAY_CSV)
    expect(bills).toHaveLength(2)
    expect(bills[0]).toMatchObject({
      occurredAt: '2026-10-02',
      occurredTime: '19:00:00',
      amount: 15,
      type: 'expense',
      merchant: '沙县小吃',
      note: '拌面',
    })
  })
})

describe('dedupe', () => {
  const existing: Tx = {
    id: 1,
    type: 'expense',
    amount: 15,
    categoryId: null,
    merchant: '沙县小吃',
    note: null,
    occurredAt: '2026-10-02',
    source: 'manual',
    refundOfId: null,
    status: 'confirmed',
    createdAt: 'x',
  }

  it('金额相同且 3 天内且商家相同判定为重复', () => {
    const bills = parseAlipayCSV(ALIPAY_CSV)
    const { fresh, dupes } = dedupe(bills, [existing])
    expect(dupes).toHaveLength(1)
    expect(fresh).toHaveLength(1)
    expect(fresh[0].merchant).toBe('淘宝')
  })

  it('相差 4 天不算重复', () => {
    const bills = parseAlipayCSV(ALIPAY_CSV)
    const far = { ...existing, occurredAt: '2026-09-28' }
    const { dupes } = dedupe(bills, [far])
    expect(dupes).toHaveLength(0)
  })

  it('金额不同不算重复', () => {
    const bills = parseAlipayCSV(ALIPAY_CSV)
    const other = { ...existing, amount: 16 }
    const { dupes } = dedupe(bills, [other])
    expect(dupes).toHaveLength(0)
  })

  it('退款行不会被同额原消费误判为重复（类型必须一致）', () => {
    const purchase: Tx = {
      ...existing,
      amount: 35.5,
      merchant: '肯德基',
      occurredAt: '2026-10-03',
      type: 'expense',
    }
    const bills = parseWeChatCSV(WECHAT_CSV)
    const { dupes } = dedupe(bills, [purchase])
    expect(dupes.some((d) => d.type === 'refund')).toBe(false)
    expect(dupes.some((d) => d.type === 'expense' && d.merchant === '肯德基')).toBe(true)
  })
})

describe('GBK 解码', () => {
  it('Node/browser 的 TextDecoder 支持 gbk', () => {
    const bytes = new Uint8Array([0xb2, 0xcd, 0xd2, 0xfb]) // 餐饮
    expect(new TextDecoder('gbk').decode(bytes)).toBe('餐饮')
  })
})

describe('账单精确时间与收支边界', () => {
  const csv = (rows: string) => `交易时间,交易类型,交易对方,商品,收/支,金额(元),当前状态\n${rows}`

  it('保留秒级时间，日期记录不伪造时刻，分钟时间补零，非法时间跳过', () => {
    const bills = parseWeChatCSV(csv(`2026-10-03 12:30:41,商户消费,便利店,水,支出,¥3.00,支付成功
2026-10-03,商户消费,便利店,水,支出,¥3.00,支付成功
2026-10-03 12:30,商户消费,便利店,水,支出,¥3.00,支付成功
2026-10-03 25:30:41,商户消费,便利店,水,支出,¥3.00,支付成功`))
    expect(bills.map((b) => b.occurredTime)).toEqual(['12:30:41', null, '12:30:00'])
  })

  it('不同秒的同额同商家消费不能误去重，精确重复仍跳过', () => {
    const bills = parseAlipayCSV(ALIPAY_CSV)
    const existing: Tx = { ...bills[0], id: 1, categoryId: null, source: 'ocr',
      refundOfId: null, status: 'confirmed', createdAt: 'x', occurredTime: '19:00:01' }
    expect(dedupe(bills, [existing]).dupes).toHaveLength(0)
    expect(dedupe(bills, [{ ...existing, occurredTime: '19:00:00' }]).dupes).toHaveLength(1)
    expect(dedupe(bills, [{ ...existing, occurredAt: '2026-10-01', occurredTime: '19:00:00' }]).dupes).toHaveLength(0)
  })

  it('普通收入、失败支付、退款处理中不计为支出或退款', () => {
    const bills = parseWeChatCSV(csv(`2026-10-03 12:00:00,转账,好友,转账,收入,¥30.00,转账成功
2026-10-03 12:01:00,商户消费,商家,商品,支出,¥30.00,支付失败
2026-10-03 12:02:00,退款,商家,商品,收入,¥30.00,退款处理中
2026-10-03 12:03:00,退款,商家,商品,收入,¥30.00,退款成功
2026-10-03 12:04:00,商户消费,商家,商品,支出,¥30.00,已部分退款`))
    expect(bills.map((b) => [b.type, b.occurredTime])).toEqual([
      ['refund', '12:03:00'], ['expense', '12:04:00'],
    ])
  })
})
