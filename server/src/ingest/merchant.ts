const MERCHANT_LABEL_SOURCE = '商户全称|商户简称|商户名称|商家名称|收款方名称|收款人名称|对方户名|收款人|收款方|商户|商家|付款给|转账给|交易场所'
const FIELD_SOURCE = '(?:原|本次|实际)?(?:交易|支付|付款|消费|扣款|退款|到账|创建)(?:时间|日期|金额|状态|方式|渠道|类型|说明)|金额|当前状态|退款原因|备注|说明|订单号|交易单号|商户名称|收款方'
const EMPTY_MERCHANT_RE = /^(?:未知(?:商户|商家|名称)?|未提供|未填写|未识别|不详|无(?:商户|商家|名称)?|暂无(?:商户|商家|名称)?|N\/?A|null|undefined|[-—–_]+)(?:[（(][^（）()]*[）)])?$/i
const CHANNEL_RE = /^(?:财付通(?:支付科技(?:有限)?公司)?(?:[-—－/· ]*微信(?:支付)?(?:[-—－/· ]*微信零钱充值账户)?)?|微信(?:支付)?|支付宝(?:[（(]中国[）)]网络技术有限公司)?|银联(?:商务)?|网联|云闪付|Apple\s*Pay|(?:招商|工商|建设|农业|中国|交通|邮储|民生|兴业|浦发|平安|中信|光大|广发|华夏|北京|上海|宁波)银行)(?:\s*[（(]\d{4}[）)])?$/i
const DATE_OR_TIME_RE = /^(?:\d{4}[年\-/.]\d{1,2}[月\-/.]\d{1,2}|\d{1,2}[:：]\d{2}|\d{1,2}(?:月|\/)\d{1,2}(?:日)?)/
const AMOUNT_ONLY_RE = /^[+\-−–—·・]?\s*(?:人民币|[¥￥])?\s*[\d,]+(?:\.\d+)?\s*元?$/

/** 只取明确名称字段；没有名称、字段混淆或名称冲突时留空，摘要不作为商户。 */
export function extractExplicitMerchant(input: string): string {
  const text = input.replace(/\u3000/g, ' ').replace(/\r\n?/g, '\n')
  const names = new Set<string>()
  const labels = new RegExp(`(?<![\\p{L}\\p{N}])(?:${MERCHANT_LABEL_SOURCE})(?=[：:\\s]|$)[ \\t]*[：:]?[ \\t]*(?:\\n[ \\t]*)?`, 'gu')
  const fieldStart = new RegExp(`^(?:${FIELD_SOURCE})(?=[：:\\s]|人民币|[¥￥]|\\d)`)
  const nextField = new RegExp(`[ \\t]+(?:${FIELD_SOURCE})(?=[：:\\s])`)
  for (const match of text.matchAll(labels)) {
    const after = text.slice(match.index + match[0].length)
    let value = after.split(/[\n，。,；;【[\]]/, 1)[0].trim()
    const following = value.search(nextField)
    if (following >= 0) value = value.slice(0, following).trim()
    if (!value || value.length > 120 || EMPTY_MERCHANT_RE.test(value) || CHANNEL_RE.test(value)) continue
    if (fieldStart.test(value) || DATE_OR_TIME_RE.test(value) || AMOUNT_ONLY_RE.test(value) || /[¥￥]/.test(value)) continue
    if (/^(?:完成|账单详情|详情|已完成交易)$/.test(value)) continue
    if (/^(?:支付|付款|交易|消费|扣款|退款)(?:已)?(?:成功|完成|到账|失败|处理中)(?:\s|$)/.test(value)) continue
    if (/^请(?:查看|登录|前往|点击)|^详见/.test(value)) continue
    names.add(value)
  }
  return names.size === 1 ? [...names][0] : ''
}
