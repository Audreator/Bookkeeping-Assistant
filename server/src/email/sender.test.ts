import { describe, expect, it } from 'vitest'
import { matchesBankSender } from './sender.ts'

describe('matchesBankSender（银行邮件地址白名单）', () => {
  it.each(['notify@cmbchina.com', 'notify@message.cmbchina.com', 'NOTIFY@MESSAGE.CMBCHINA.COM'])
    ('允许域名本身和具有点分隔边界的子域名：%s', (address) => {
      expect(matchesBankSender(address, 'cmbchina.com')).toBe(true)
    })

  it.each([
    'notify@cmbchina.com.evil.example',
    'notify@fakecmbchina.com',
    'cmbchina.com@evil.example',
    'notify@evil.example?cmbchina.com',
    'cmbchina.com <notify@evil.example>',
    'notify@@cmbchina.com',
    'notify@.cmbchina.com',
    'notify@message..cmbchina.com',
    '',
  ])('拒绝伪造边界和畸形地址：%s', (address) => {
    expect(matchesBankSender(address, 'cmbchina.com')).toBe(false)
  })

  it('邮箱地址配置只允许完整邮箱匹配', () => {
    expect(matchesBankSender('notify@message.cmbchina.com', 'notify@message.cmbchina.com')).toBe(true)
    expect(matchesBankSender('other@message.cmbchina.com', 'notify@message.cmbchina.com')).toBe(false)
    expect(matchesBankSender('evilnotify@message.cmbchina.com', 'notify@message.cmbchina.com')).toBe(false)
    expect(matchesBankSender('notify@message.cmbchina.com.evil', 'notify@message.cmbchina.com')).toBe(false)
  })

  it.each(['', '  ', '.cmbchina.com', '*.cmbchina.com', 'https://cmbchina.com', 'cmbchina.com,evil.example'])
    ('空白或不合法配置不会放行：%s', (filter) => {
      expect(matchesBankSender('notify@message.cmbchina.com', filter)).toBe(false)
    })
})
