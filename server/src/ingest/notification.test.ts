import { describe, expect, it } from 'vitest'
import { describeInput, extractNotificationText } from './notification.ts'

describe('快捷指令通知输入', () => {
  it('保持非空原文字符串', () => {
    expect(extractNotificationText('  支付成功\n金额 ¥1.23  ')).toBe('支付成功\n金额 ¥1.23')
    expect(extractNotificationText('  ')).toBeNull()
  })
  it('按标题、副标题、正文合并英文属性，不读取其他元数据', () => {
    expect(extractNotificationText({ body: '支付成功 ¥1.23', app: 'some-app', title: '招商银行', subtitle: '动账通知', timestamp: 123 })).toBe('招商银行\n动账通知\n支付成功 ¥1.23')
  })
  it('兼容系统属性大小写与中文属性', () => {
    expect(extractNotificationText({ Title: '招商银行', Message: '支付成功 ¥1.23' })).toBe('招商银行\n支付成功 ¥1.23')
    expect(extractNotificationText({ 标题: '银行', 副标题: '提醒', 信息: '支付成功 ¥1.23' })).toBe('银行\n提醒\n支付成功 ¥1.23')
  })
  it('处理通知包装和单个通知数组', () => {
    expect(extractNotificationText({ notification: { title: '银行', body: '支付成功 ¥1.23' } })).toBe('银行\n支付成功 ¥1.23')
    expect(extractNotificationText([{ 标题: '银行', 正文: '支付成功 ¥1.23' }])).toBe('银行\n支付成功 ¥1.23')
  })
  it('只接受单个文本数组，重复通知属性去重', () => {
    expect(extractNotificationText(['支付成功 ¥1.23'])).toBe('支付成功 ¥1.23')
    expect(extractNotificationText({ message: '支付成功 ¥1.23', body: '支付成功 ¥1.23' })).toBe('支付成功 ¥1.23')
  })
  it('未知对象不做 stringify、不把数字卡号或对象猜成正文', () => {
    for (const input of [null, 1.23, {}, { app: '银行', id: 1234 }, { message: 1.23 }, { body: true }, [{ body: '支付成功 ¥1.23' }, { body: '退款成功 ¥2.34' }]]) {
      expect(extractNotificationText(input)).toBeNull()
    }
  })
  it('拒绝过深包装', () => {
    expect(extractNotificationText({ notification: { notification: { notification: { notification: { body: '支付成功 ¥1.23' } } } } })).toBeNull()
  })
  it('拒绝同一正文槽中不同内容及冲突的包装通知', () => {
    const pay = '付款成功\n支付金额 ¥1.23'
    const refund = '退款成功\n退款金额 ¥1.23'
    expect(extractNotificationText({ body: pay, message: refund })).toBeNull()
    expect(extractNotificationText({ body: refund, notification: { body: pay } })).toBeNull()
    expect(extractNotificationText([pay, refund])).toBeNull()
    expect(extractNotificationText({ body: pay, notification: { body: pay } })).toBe(pay)
  })
})

describe('输入结构诊断', () => {
  it('记录字段类型与长度，永不输出原始内容或数值', () => {
    const shape = describeInput({ text: { title: '私密银行', body: '支付成功 ¥123.45' }, date: null, count: 9876, items: ['secret'] })
    expect(shape).toMatchObject({ type: 'object', fields: { text: { type: 'object', fields: { title: { type: 'string', length: 4 }, body: { type: 'string' } } }, date: { type: 'null' }, count: { type: 'number' }, items: { type: 'array', length: 1 } } })
    expect(JSON.stringify(shape)).not.toMatch(/私密银行|123\.45|9876|secret/)
  })
})
