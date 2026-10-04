import { describe, expect, it } from 'vitest'
import { parsePaymentText } from './payment'

describe('parsePaymentText（付款成功页 OCR 文本）', () => {
  it('微信支付成功页', () => {
    const r = parsePaymentText(
      '微信支付\n付款成功\n收款方\n瑞幸咖啡(国贸店)\n¥35.50\n招商银行(1234)\n支付方式\n完成',
    )
    expect(r).toMatchObject({ type: 'expense', amount: 35.5, merchant: '瑞幸咖啡(国贸店)' })
  })

  it('支付宝成功页（花呗付款）', () => {
    const r = parsePaymentText('支付宝\n付款成功\n35.00\n商户名称：肯德基宅急送\n花呗')
    expect(r).toMatchObject({ type: 'expense', amount: 35, merchant: '肯德基宅急送' })
  })

  it('退款到账页识别为退款', () => {
    const r = parsePaymentText('退款成功\n退款金额 ¥35.50\n退回至 招商银行(1234)\n商户：瑞幸咖啡')
    expect(r).toMatchObject({ type: 'refund', amount: 35.5 })
  })

  it('金额带千分位或 元 后缀', () => {
    expect(parsePaymentText('支付成功 1,234.00元')?.amount).toBe(1234)
    expect(parsePaymentText('付款成功，金额 0.01 元')?.amount).toBe(0.01)
  })

  it('微信账单列表格式：-1.00 / 负号被 OCR 成点 ·1.00', () => {
    expect(parsePaymentText('9:42 账单 全部账单 杭州深度求索 -1.00 当前状态 支付成功')?.amount).toBe(1)
    expect(parsePaymentText('微信支付 杭州深度求索 使用零钱支付 ·1.00 当前状态 支付成功')?.amount).toBe(1)
  })

  it('带加号的一般收款不能冒充退款', () => {
    expect(parsePaymentText('微信支付\n收款成功 +20.00')).toBeNull()
    expect(parsePaymentText('退款到账\n+20.00')).toMatchObject({ type: 'refund', amount: 20 })
  })

  it('多行"商户全称"标签（标签行+商户行）', () => {
    const r = parsePaymentText('账单详情\n商户全称\n杭州深度求索\n-1.00 当前状态 支付成功')
    expect(r).toMatchObject({ type: 'expense', amount: 1, merchant: '杭州深度求索' })
  })

  it('没有金额返回 null', () => {
    expect(parsePaymentText('支付成功\n完成')).toBeNull()
  })

  it.each([
    '微信支付\n-35.50\n账单详情',
    '微信支付\n·35.50\n账单详情',
    '付款金额 ¥35.50\n待支付',
    '付款金额 ¥35.50\n未支付',
    '付款金额 ¥35.50\n支付处理中',
    '付款金额 ¥35.50\n支付失败',
    '付款金额 ¥35.50\n交易关闭',
    '退款金额 ¥35.50\n退款中',
    '退款金额 ¥35.50\n退款处理中',
    '退款金额 ¥35.50\n退款失败',
    '退款申请已提交\n退款金额 ¥35.50\n原订单支付成功',
    '支付成功\n退款未到账\n退款金额 ¥35.50',
    '工资到账\n+5000.00',
    '微信支付\n收入 ¥20.00',
    '支付成功可领取20.00元红包',
    '交易成功\n转入金额 ¥20.00',
    '原订单支付成功\n退款状态：处理中\n¥20.00',
    '退款到账失败\n¥20.00',
    '申请退款成功\n退款金额 ¥20.00',
    '退款申请成功\n退款金额 ¥20.00',
    '预计退款到账\n退款金额 ¥20.00',
    '交易成功\n转入成功\n¥20.00',
  ])('非已完成支付或退款不入账：%s', (text) => {
    expect(parsePaymentText(text)).toBeNull()
  })

  it('退款状态优先于原订单支付状态，金额取本次退款', () => {
    expect(parsePaymentText('原付款金额 ¥100.00\n原订单支付成功\n退款成功\n退款金额 ¥20.00'))
      .toMatchObject({ type: 'refund', amount: 20 })
  })

  it('实际支付金额优先于订单原价、优惠与余额', () => {
    expect(parsePaymentText('支付成功\n订单金额 ¥100.00\n优惠 ¥5.00\n实付金额 ¥95.00\n账户余额 ¥200.00'))
      .toMatchObject({ type: 'expense', amount: 95 })
  })

  it('明确支付金额优先于其它未标注金额', () => {
    expect(parsePaymentText('支付成功\n¥200.00\n支付金额：35.50元')?.amount).toBe(35.5)
  })

  it('拒绝无法决定主金额的多金额文本，重复显示同金额可接受', () => {
    expect(parsePaymentText('支付成功\n¥35.50\n¥20.00')).toBeNull()
    expect(parsePaymentText('退款成功\n退款金额 ¥35.50\n退款金额 ¥20.00')).toBeNull()
    expect(parsePaymentText('支付成功\n¥35.50\n支付金额 ¥35.50')?.amount).toBe(35.5)
  })

  it.each(['¥35.501', '¥1,23.00', '¥0.00', '35.501元', '¥-35.50', '订单号 1234567890123456', '卡号 6225888888881234'])
    ('拒绝畸形金额、零金额与仅卡号订单号：%s', (amount) => {
      expect(parsePaymentText(`支付成功\n${amount}`)).toBeNull()
    })

  it('银行卡已完成消费与退款通知', () => {
    expect(parsePaymentText('账户末四位1234发生一笔支出，金额人民币35.50元，账户余额1,234.56元'))
      .toMatchObject({ type: 'expense', amount: 35.5 })
    expect(parsePaymentText('账户末四位1234收到一笔退款人民币20.00元，账户余额1,254.56元'))
      .toMatchObject({ type: 'refund', amount: 20 })
  })

  it('提取交易日期和秒级时间', () => {
    expect(parsePaymentText('支付成功\n¥35.50\n交易时间 2026-10-04 09:42:07'))
      .toMatchObject({ occurredAt: '2026-10-04', occurredTime: '09:42:07' })
  })

  it('支持中文日期、斜杠日期和分钟精度', () => {
    expect(parsePaymentText('付款成功\n¥35.50\n付款时间：2026年10月4日9:42'))
      .toMatchObject({ occurredAt: '2026-10-04', occurredTime: '09:42:00' })
    expect(parsePaymentText('付款成功\n¥35.50\n2026/10/04 09:42:08'))
      .toMatchObject({ occurredAt: '2026-10-04', occurredTime: '09:42:08' })
  })

  it('退款时间优先于原付款时间', () => {
    expect(parsePaymentText('原付款时间 2026-10-03 10:30:00\n原付款金额 ¥100.00\n退款成功\n退款金额 ¥20.00\n退款时间 2026-10-04 09:42:07'))
      .toMatchObject({ occurredAt: '2026-10-04', occurredTime: '09:42:07' })
  })

  it('可提取明确时间标签，但不把屏幕状态栏当作交易时间', () => {
    expect(parsePaymentText('支付成功\n¥35.50\n交易时间 9:42:07')?.occurredTime).toBe('09:42:07')
    const parsed = parsePaymentText('9:42\n支付成功\n¥35.50')
    expect(parsed?.occurredAt).toBeUndefined()
    expect(parsed?.occurredTime).toBeUndefined()
  })

  it.each(['2026-02-29 12:30:00', '2026-13-01 12:30:00', '2026-04-31 12:30:00'])
    ('无效日期不输出日期或时间：%s', (date) => {
      const parsed = parsePaymentText(`支付成功\n¥35.50\n交易时间 ${date}`)
      expect(parsed?.occurredAt).toBeUndefined()
      expect(parsed?.occurredTime).toBeUndefined()
    })

  it.each(['24:00:00', '12:60:00', '12:30:60'])('拒绝非法时间：%s', (time) => {
    const parsed = parsePaymentText(`支付成功\n¥35.50\n交易时间 2026-10-04 ${time}`)
    expect(parsed?.occurredAt).toBe('2026-10-04')
    expect(parsed?.occurredTime).toBeUndefined()
  })

  it('缺失时分秒时只输出日期，不伪造当前时间', () => {
    const parsed = parsePaymentText('支付成功\n¥35.50\n交易时间 2026-10-04')
    expect(parsed?.occurredAt).toBe('2026-10-04')
    expect(parsed?.occurredTime).toBeUndefined()
  })

  it('独立纯整数不能把卡号尾号或订单号当金额', () => {
    expect(parsePaymentText('支付成功\n卡号\n1234')).toBeNull()
    expect(parsePaymentText('支付成功\n订单号\n123456')).toBeNull()
  })

  it('付款成功页的申请退款按钮不影响已完成支付', () => {
    expect(parsePaymentText('付款成功\n¥35.50\n申请退款')).toMatchObject({ type: 'expense', amount: 35.5 })
  })

  it('解析金额上限与结构化接口一致', () => {
    expect(parsePaymentText('支付成功\n¥100000000.00')?.amount).toBe(100_000_000)
    expect(parsePaymentText('支付成功\n¥100000000.01')).toBeNull()
  })

  it.each(['消费时间', '扣款时间', '付款时间', '支付时间', '原交易时间', '原消费时间', '创建时间', '订单创建时间'])
    ('退款没有退款时间时不借用 %s', (label) => {
      const parsed = parsePaymentText(`退款成功\n退款金额 ¥20.00\n${label} 2026-10-03 12:30:01`)
      expect(parsed).toMatchObject({ type: 'refund', amount: 20 })
      expect(parsed?.occurredAt).toBeUndefined()
      expect(parsed?.occurredTime).toBeUndefined()
    })

  it.each(['退款时间', '退款到账时间', '到账时间', '原交易时间', '原消费时间', '创建时间', '订单创建时间'])
    ('支付没有支付时间时不借用 %s', (label) => {
      const parsed = parsePaymentText(`支付成功\n实付金额 ¥20.00\n${label} 2026-10-03 12:30:01`)
      expect(parsed).toMatchObject({ type: 'expense', amount: 20 })
      expect(parsed?.occurredAt).toBeUndefined()
      expect(parsed?.occurredTime).toBeUndefined()
    })

  it.each(['收入', '收款', '转入'])('收/支字段为%s时不判为支出', (direction) => {
    expect(parsePaymentText(`交易成功\n收/支：${direction}\n金额 ¥20.00`)).toBeNull()
  })

  it('泛化交易成功与裸正号金额不能确定支出方向', () => {
    expect(parsePaymentText('交易成功\n+20.00')).toBeNull()
    expect(parsePaymentText('退款成功\n+20.00')).toMatchObject({ type: 'refund', amount: 20 })
    expect(parsePaymentText('交易成功\n收/支：支出\n金额 ¥20.00')).toMatchObject({ type: 'expense', amount: 20 })
  })

  it('泛化交易成功还需明确支出方向证据', () => {
    expect(parsePaymentText('交易成功\n金额 ¥20.00')).toBeNull()
    expect(parsePaymentText('交易成功\n支付金额 ¥20.00')).toMatchObject({ type: 'expense', amount: 20 })
    expect(parsePaymentText('交易成功\n-20.00')).toMatchObject({ type: 'expense', amount: 20 })
  })

  it.each([
    '支付成功后可获得20.00元现金红包',
    '如果支付成功，实付金额 ¥20.00',
    '将会支付成功，金额 ¥20.00',
  ])('条件或营销文案不是已完成状态：%s', (text) => {
    expect(parsePaymentText(text)).toBeNull()
  })

  it('实际已完成支付及附带营销文案保留真实金额', () => {
    expect(parsePaymentText('付款成功\n实付金额 ¥20.00\n支付成功后可获得5.00元现金红包'))
      .toMatchObject({ type: 'expense', amount: 20 })
  })

  it('分别出现的交易日期和交易时间应合成完整发生时刻', () => {
    expect(parsePaymentText('付款成功\n支付金额 ¥35.50\n交易日期：2026-10-03\n交易时间：09:42:07'))
      .toMatchObject({ occurredAt: '2026-10-03', occurredTime: '09:42:07' })
  })

  it('分别出现的退款日期和退款时间应合成完整发生时刻', () => {
    expect(parsePaymentText('退款成功\n退款金额 ¥35.50\n退款日期：2026-10-03\n退款时间：09:42:07'))
      .toMatchObject({ occurredAt: '2026-10-03', occurredTime: '09:42:07' })
  })

  it('裸完整日期与同一交易类型的明确时间标签可组合', () => {
    expect(parsePaymentText('付款成功\n支付金额 ¥35.50\n2026-10-03\n交易时间：09:42:07'))
      .toMatchObject({ occurredAt: '2026-10-03', occurredTime: '09:42:07' })
  })

  it('同一时间标签后日期和纯时间被 OCR 拆行时可组合', () => {
    expect(parsePaymentText('付款成功\n支付金额 ¥35.50\n支付时间：2026-10-03\n09:42:07'))
      .toMatchObject({ occurredAt: '2026-10-03', occurredTime: '09:42:07' })
    expect(parsePaymentText('退款成功\n退款金额 ¥35.50\n退款时间：2026-10-03\n09:42'))
      .toMatchObject({ occurredAt: '2026-10-03', occurredTime: '09:42:00' })
  })

  it('分离日期与時間不组合异类型或原交易字段', () => {
    const refund = parsePaymentText('退款成功\n退款金额 ¥35.50\n消费日期：2026-10-03\n原交易日期：2026-10-02\n退款时间：09:42:07')
    expect(refund?.occurredAt).toBeUndefined()
    expect(refund?.occurredTime).toBe('09:42:07')
    const expense = parsePaymentText('付款成功\n支付金额 ¥35.50\n退款日期：2026-10-03\n创建日期：2026-10-02\n支付时间：09:42:07')
    expect(expense?.occurredAt).toBeUndefined()
    expect(expense?.occurredTime).toBe('09:42:07')
  })

  it('日期字段不把之前状态栏或之后非纯时间行当交易时间', () => {
    const statusBar = parsePaymentText('09:42:07\n付款成功\n支付金额 ¥35.50\n支付日期：2026-10-03')
    expect(statusBar?.occurredAt).toBe('2026-10-03')
    expect(statusBar?.occurredTime).toBeUndefined()
    const irrelevant = parsePaymentText('付款成功\n支付金额 ¥35.50\n支付时间：2026-10-03\n手机时间 09:42:07')
    expect(irrelevant?.occurredAt).toBe('2026-10-03')
    expect(irrelevant?.occurredTime).toBeUndefined()
  })

  it.each([
    ['退款成功\n退款金额 ¥35.50', '退款日期'],
    ['付款成功\n支付金额 ¥35.50', '支付日期'],
  ])('不把其它日期的完整交易时间拼到已选日期：%s', (transaction, label) => {
    const mismatch = parsePaymentText(`${transaction}\n${label}：2026-10-04\n交易时间：2026-10-03 09:42:07`)
    expect(mismatch?.occurredAt).toBe('2026-10-04')
    expect(mismatch?.occurredTime).toBeUndefined()
    expect(parsePaymentText(`${transaction}\n${label}：2026-10-04\n交易时间：2026-10-04 09:42:07`))
      .toMatchObject({ occurredAt: '2026-10-04', occurredTime: '09:42:07' })
  })

  it('优先日期无效时不借其它日期的时间或 time-only 拼出发生时刻', () => {
    const parsed = parsePaymentText('退款成功\n退款金额 ¥35.50\n退款日期：2026-02-29\n交易时间：2026-10-03 09:42:07')
    expect(parsed?.occurredAt).toBeUndefined()
    expect(parsed?.occurredTime).toBeUndefined()
    const timeOnly = parsePaymentText('退款成功\n退款金额 ¥35.50\n退款日期：2026-02-29\n退款时间：09:42:07')
    expect(timeOnly?.occurredAt).toBeUndefined()
    expect(timeOnly?.occurredTime).toBeUndefined()
  })

  it('同等优先级日期有歧义时不拼接独立时间', () => {
    const parsed = parsePaymentText('退款成功\n退款金额 ¥35.50\n退款日期：2026-10-03\n退款日期：2026-10-04\n退款时间：09:42:07')
    expect(parsed?.occurredAt).toBeUndefined()
    expect(parsed?.occurredTime).toBeUndefined()
  })

  it('没有明确商户字段时不从银行名称或任意文本猜商家', () => {
    expect(parsePaymentText('招商银行\n账户发生一笔支出，金额人民币35.50元')?.merchant).toBe('')
    expect(parsePaymentText('付款成功\n瑞幸咖啡\n¥35.50')?.merchant).toBe('')
    expect(parsePaymentText('付款成功\n交易摘要：瑞幸咖啡\n¥35.50')?.merchant).toBe('')
  })

  it.each(['未知', '未知商户', '未提供', '未填写', '不详', '暂无', '--', '—', 'N/A'])
    ('商户标记%s时保持未知', (merchant) => {
      expect(parsePaymentText(`付款成功\n¥35.50\n商户：${merchant}`)?.merchant).toBe('')
    })

  it.each([
    '交易时间 2026-10-03 09:42:07',
    '2026-10-03 09:42:07',
    '支付金额 ¥35.50',
    '¥35.50',
    '支付方式：招商银行(1234)',
    '说明：请查看银行账单',
    '付款成功',
    '完成',
  ])('商户标签后下一字段%s不是名称', (field) => {
    expect(parsePaymentText(`付款成功\n¥35.50\n商户名称\n${field}`)?.merchant).toBe('')
  })

  it.each(['财付通-微信支付', '财付通-微信支付-微信零钱充值账户', '微信支付', '支付宝', '招商银行', '招商银行(1234)'])
    ('商户字段只有支付通道或银行%s时不当真实商家', (merchant) => {
      expect(parsePaymentText(`付款成功\n¥35.50\n收款方：${merchant}`)?.merchant).toBe('')
    })

  it('说明里谈及商户不构成明确商户字段', () => {
    expect(parsePaymentText('付款成功\n¥35.50\n本次消费商户未知，请查看账单')?.merchant).toBe('')
  })

  it('明确商户同一行后续字段不属于商户名称', () => {
    expect(parsePaymentText('付款成功\n¥35.50\n商户名称：瑞幸咖啡 支付时间：2026-10-03 09:42:07')?.merchant).toBe('瑞幸咖啡')
  })

  it('多个不同明确商户存在歧义时保持未知', () => {
    expect(parsePaymentText('付款成功\n¥35.50\n商户：瑞幸咖啡\n商户名称：肯德基')?.merchant).toBe('')
  })

  it('福建农信明确账户出账通知识别支出，不猜商户或时间', () => {
    const parsed = parsePaymentText('动账通知\n您尾号1234的账户出账 网联支出1.23元，点此查看详情')
    expect(parsed).toMatchObject({ type: 'expense', amount: 1.23, merchant: '' })
    expect(parsed?.occurredAt).toBeUndefined()
    expect(parsed?.occurredTime).toBeUndefined()
  })

  it.each([
    '动账通知\n您尾号1234的账户网联 入账收入1.23元，点此查看详情',
    '招商银行\n您尾号1234的账户入账人民币1.23元',
    '动账通知\n您尾号1234的账户待出账 网联支出1.23元，点此查看详情',
    '动账通知\n您尾号1234的账户出账处理中 网联支出1.23元，点此查看详情',
    '动账通知\n预计您尾号1234的账户出账 网联支出1.23元，点此查看详情',
    '招商银行\n您账户1234于10月04日22:45发生快捷支付扣款失败，人民币1.23',
    '招商银行\n预计您账户1234于10月04日22:45发生快捷支付扣款，人民币1.23',
    '招商银行\n您账户1234申请发生快捷支付扣款，人民币1.23',
  ])('银行收入或未完成动账不能成为支出退款：%s', (text) => {
    expect(parsePaymentText(text, '2026-10-04')).toBeNull()
  })

  it('招行快捷支付扣款通知按引用日期解析月日，不把支付通道当商家', () => {
    const parsed = parsePaymentText('招商银行\n您账户1234于10月04日22:45在【财付通-微信支付-微信零钱充值账户】发生快捷支付扣款，人民币1.23', '2026-10-04')
    expect(parsed).toMatchObject({ type: 'expense', amount: 1.23, merchant: '', occurredAt: '2026-10-04', occurredTime: '22:45:00' })
  })

  it('短月日根据引用日期选择相邻年份中最近日期，支持 MM/dd', () => {
    expect(parsePaymentText('付款成功\n¥1.23\n交易时间：12月31日23:50', '2027-01-01'))
      .toMatchObject({ occurredAt: '2026-12-31', occurredTime: '23:50:00' })
    expect(parsePaymentText('付款成功\n¥1.23\n交易时间：01/01 00:10', '2026-12-31'))
      .toMatchObject({ occurredAt: '2027-01-01', occurredTime: '00:10:00' })
  })

  it('引用日期缺失、非法或距离相同不推测短日期年份', () => {
    for (const reference of [undefined, '2026-02-29', '2024-07-02']) {
      const parsed = parsePaymentText('付款成功\n¥1.23\n交易时间：01/01 09:42:07', reference)
      expect(parsed?.occurredAt).toBeUndefined()
    }
  })

  it('短日期非法时不拼接交易时间，也不把卡尾号当金额', () => {
    const parsed = parsePaymentText('付款成功\n¥1.23\n交易时间：02/30 09:42:07', '2026-10-04')
    expect(parsed?.occurredAt).toBeUndefined()
    expect(parsed?.occurredTime).toBeUndefined()
    expect(parsePaymentText('动账通知\n您尾号1234的账户出账 网联支出，点此查看详情')).toBeNull()
  })
})
