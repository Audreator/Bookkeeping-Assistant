/** 显式 API 前缀优先；未配置时使用页面部署目录。 */
export function resolveApiPrefix(configuredPrefix: string | undefined, baseUrl: string, pageUrl: string): string {
  const prefix = configuredPrefix?.trim() || new URL(baseUrl, pageUrl).pathname
  return prefix.replace(/\/+$/, '')
}
