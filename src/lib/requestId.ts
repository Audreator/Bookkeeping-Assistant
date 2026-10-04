/** getRandomValues 在局域网 HTTP 可用；不依赖 HTTPS 专属的 randomUUID。 */
export function makeRequestId(prefix: 'csv' | 'manual'): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${prefix}-${hex}`
}
