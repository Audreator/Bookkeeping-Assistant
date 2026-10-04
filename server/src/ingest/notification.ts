/** 快捷指令通知输入适配；字段白名单实现由回归测试约束。 */
export function extractNotificationText(input: unknown): string | null {
  const groups = [
    ['title', '标题', 'notificationtitle'],
    ['subtitle', '副标题', 'notificationsubtitle'],
    ['body', 'message', 'text', 'content', '正文', '信息', '消息', '内容'],
    ['notification', '通知'],
  ]
  const normalizeKey = (key: string) => key.toLowerCase().replace(/[\s_-]/g, '')
  const equivalent = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim()
  const read = (value: unknown, depth: number): string[] | null => {
    if (depth > 3) return null
    if (typeof value === 'string') return value.trim() ? [value.trim()] : []
    if (value == null) return []
    if (Array.isArray(value)) {
      return value.length === 1 ? read(value[0], depth + 1) : null
    }
    if (typeof value !== 'object') return null
    const entries = Object.entries(value)
    const parts: string[] = []
    let wrapper: string[] | undefined
    let recognized = false
    for (const group of groups) {
      let selected: string[] | undefined
      for (const alias of group) {
        for (const [key, field] of entries) {
          if (normalizeKey(key) !== alias) continue
          recognized = true
          const parsed = read(field, depth + 1)
          if (parsed === null) return null
          if (!parsed.length) continue
          if (selected && equivalent(selected.join('\n')) !== equivalent(parsed.join('\n'))) return null
          selected ??= parsed
        }
      }
      if (group === groups.at(-1)) wrapper = selected
      else if (selected) parts.push(...selected)
    }
    if (wrapper) {
      if (parts.length && equivalent(parts.join('\n')) !== equivalent(wrapper.join('\n'))) return null
      return wrapper
    }
    return recognized ? parts : null
  }
  const parts = read(input, 0)
  return parts ? [...new Set(parts)].join('\n') || null : null
}

/** 仅输出输入结构，不包含值。 */
export function describeInput(input: unknown, depth = 0): unknown {
  if (input === null) return { type: 'null' }
  if (typeof input === 'string') return { type: 'string', length: input.length }
  if (Array.isArray(input)) return { type: 'array', length: input.length, items: depth < 3 ? input.slice(0, 2).map(item => describeInput(item, depth + 1)) : undefined }
  if (typeof input === 'object') return {
    type: 'object',
    fields: depth < 3 ? Object.fromEntries(Object.entries(input).slice(0, 12).map(([key, value]) => [key.slice(0, 64), describeInput(value, depth + 1)])) : undefined,
  }
  return { type: typeof input }
}
