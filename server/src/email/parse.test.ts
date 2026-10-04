import { describe, expect, it } from 'vitest'
import { parseBankEmail } from './parse'

const CMB_EXPENSE = `尊敬的客户：您账户末四位1234于2026年10月04日12:30发生一笔支出，金额人民币35.50元，交易摘要：财付通-微信支付，账户余额1,234.56元。【招商银行】`

describe('parseBankEmail', () => {
  it('识别消费：金额、日期、商户、卡尾号', () => {
    const r = parseBankEmail({
      from: 'notify@message.cmbchina.com',
      subject: '账户变动通知',
      text: CMB_EXPENSE,
      date: new Date(2026, 9, 4, 12, 31),
    })
    expect(r.kind).toBe('expense')
    expect(r.amount).toBe(35.5)
    expect(r.occurredAt).toBe('2026-10-04')
    expect(r.occurredTime).toBe('12:30:00')
    expect(r.merchant).toBe('')
    expect(r.cardTail).toBe('1234')
  })

  it('识别退款（金额里的逗号也能解析）', () => {
    const r = parseBankEmail({
      from: 'notify@message.cmbchina.com',
      subject: '账户变动通知',
      text: '您账户末四位1234于10月06日收到一笔退款人民币1,234.00元，交易摘要：财付通-微信支付。【招商银行】',
      date: new Date(2026, 9, 6, 9, 0),
    })
    expect(r.kind).toBe('refund')
    expect(r.amount).toBe(1234)
    expect(r.occurredAt).toBe('2026-10-06')
  })

  it('收入/转入类不记账', () => {
    const r = parseBankEmail({
      from: 'notify@message.cmbchina.com',
      subject: '账户变动通知',
      text: '尊敬的客户：您账户末四位1234于10月04日发生一笔转入，金额人民币500.00元，摘要：工资。【招商银行】',
      date: new Date(2026, 9, 4),
    })
    expect(r.kind).toBe('ignore')
    expect(r.reason).toContain('收入')
  })

  it('验证码/营销邮件不记账', () => {
    const r = parseBankEmail({
      from: 'no-reply@cmbchina.com',
      subject: '您的验证码',
      text: '验证码 123456，5 分钟内有效。',
      date: new Date(2026, 9, 4),
    })
    expect(r.kind).toBe('ignore')
  })

  it('有交易关键词但无金额时标记待校准', () => {
    const r = parseBankEmail({
      from: 'notify@message.cmbchina.com',
      subject: '账户变动通知',
      text: '尊敬的客户：您账户发生一笔消费，详情请登录手机银行查看。【招商银行】',
      date: new Date(2026, 9, 4),
    })
    expect(r.kind).toBe('ignore')
    expect(r.amount).toBeNull()
    expect(r.reason).toContain('未解析出金额')
  })

  it('无完整日期时用邮件日期兜底', () => {
    const r = parseBankEmail({
      from: 'notify@message.cmbchina.com',
      subject: '消费提醒',
      text: '您于今日发生消费人民币10.00元。',
      date: new Date(2026, 9, 5, 8, 0),
    })
    expect(r.occurredAt).toBe('2026-10-05')
    expect(r.amount).toBe(10)
    expect(r.occurredTime).toBeNull()
  })

  it.each([
    '您的支付失败，金额人民币35.50元。',
    '支付处理中，金额人民币35.50元。',
    '退款处理中，退款金额人民币35.50元。',
    '退款申请已提交，原交易支付成功，金额人民币35.50元。',
    '退款失败，退款金额人民币35.50元。',
    '消费满35.50元赠送红包，欢迎支付。',
    '支付成功可领取人民币35.50元红包。',
    '您收到一笔收入，金额人民币35.50元，摘要：微信支付。',
  ])('未完成通知和营销不记账：%s', (text) => {
    const r = parseBankEmail({ from: 'notify@message.cmbchina.com', subject: '账户变动通知', text, date: new Date(2026, 9, 4) })
    expect(r.kind).toBe('ignore')
  })

  it('退款金额和退款时间优先于原交易金额和时间', () => {
    const r = parseBankEmail({ from: 'notify@message.cmbchina.com', subject: '退款到账通知', text: '原付款金额人民币100.00元，原付款时间2026-10-03 12:30:00\n退款成功，退款金额人民币20.00元，退款时间2026-10-04 15:31:02。', date: new Date(2026, 9, 4) })
    expect(r).toMatchObject({ kind: 'refund', amount: 20, occurredAt: '2026-10-04', occurredTime: '15:31:02' })
  })

  it('提取银行交易原时间，不使用邮件到达时间', () => {
    const r = parseBankEmail({ from: 'notify@message.cmbchina.com', subject: '账户变动通知', text: '您账户于2026年10月04日12:30:07发生一笔支出，金额人民币35.50元。', date: new Date(2026, 9, 4, 18, 0) })
    expect(r.occurredTime).toBe('12:30:07')
  })

  it('跨年只有月日时按邮件日期推断前一年', () => {
    const r = parseBankEmail({ from: 'notify@message.cmbchina.com', subject: '账户变动通知', text: '您账户于12月31日23:50发生一笔支出，金额人民币35.50元。', date: new Date(2027, 0, 1) })
    expect(r).toMatchObject({ occurredAt: '2026-12-31', occurredTime: '23:50:00' })
  })

  it('明确存在无效日期时不以邮件日期掩盖错误', () => {
    const r = parseBankEmail({ from: 'notify@message.cmbchina.com', subject: '账户变动通知', text: '您账户于2026年02月29日12:30:07发生一笔支出，金额人民币35.50元。', date: new Date(2026, 9, 4) })
    expect(r.kind).toBe('ignore')
    expect(r.occurredAt).toBeNull()
    expect(r.occurredTime).toBeNull()
  })

  it('无效时间不输出，保留有效日期', () => {
    const r = parseBankEmail({ from: 'notify@message.cmbchina.com', subject: '账户变动通知', text: '您账户于2026年10月04日25:30:07发生一笔支出，金额人民币35.50元。', date: new Date(2026, 9, 4) })
    expect(r.occurredAt).toBe('2026-10-04')
    expect(r.occurredTime).toBeNull()
  })

  it('无法确定交易金额时拒绝，而不是取余额', () => {
    const r = parseBankEmail({ from: 'notify@message.cmbchina.com', subject: '账户变动通知', text: '您账户发生一笔支出，账户余额人民币35.50元。', date: new Date(2026, 9, 4) })
    expect(r.kind).toBe('ignore')
    expect(r.amount).toBeNull()
  })

  it('明确商户字段保留，不把摘要或银行名称猜为商户', () => {
    const r = parseBankEmail({ from: 'notify@message.cmbchina.com', subject: '招商银行账户变动通知', text: '您发生一笔支出，金额人民币35.50元，商户名称：瑞幸咖啡(国贸店)，交易摘要：财付通-微信支付。【招商银行】', date: new Date(2026, 9, 4) })
    expect(r.merchant).toBe('瑞幸咖啡(国贸店)')
    expect(parseBankEmail({ from: 'notify@message.cmbchina.com', subject: '招商银行账户变动通知', text: '您发生一笔支出，金额人民币35.50元，摘要：瑞幸咖啡。【招商银行】', date: new Date(2026, 9, 4) }).merchant).toBe('')
  })

  it.each(['未知', '未提供', '--', '财付通-微信支付', '招商银行', '交易时间：2026-10-03 09:42:07', '金额人民币35.50元'])
    ('无商户名称时不保留%s', (merchant) => {
      const r = parseBankEmail({ from: 'notify@message.cmbchina.com', subject: '账户变动通知', text: `您发生一笔支出，金额人民币35.50元。\n商户名称：\n${merchant}`, date: new Date(2026, 9, 4) })
      expect(r.merchant).toBe('')
    })

  it('银行短月日通知与文本通道共用邮件日期作为引用日期', () => {
    const r = parseBankEmail({ from: 'notify@message.cmbchina.com', subject: '招商银行', text: '您账户1234于10月04日22:45在【财付通-微信支付-微信零钱充值账户】发生快捷支付扣款，人民币1.23', date: new Date(2026, 9, 4) })
    expect(r).toMatchObject({ kind: 'expense', amount: 1.23, merchant: '', occurredAt: '2026-10-04', occurredTime: '22:45:00' })
  })
})
