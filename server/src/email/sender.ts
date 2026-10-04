const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

const mailboxDomain = (address: string): string | null => {
  const match = address.match(/^[^\s<>@]+@([^@]+)$/)
  return match && DOMAIN_RE.test(match[1]) ? match[1] : null
}

/** 配置域名时允许该域及子域；配置邮箱时仅允许该完整地址。 */
export function matchesBankSender(address: string, filter: string): boolean {
  const sender = address.trim().toLowerCase()
  const allowed = filter.trim().toLowerCase()
  const domain = mailboxDomain(sender)
  if (!domain || !allowed) return false
  if (allowed.includes('@')) return mailboxDomain(allowed) !== null && sender === allowed
  if (!DOMAIN_RE.test(allowed)) return false
  return domain === allowed || domain.endsWith(`.${allowed}`)
}
