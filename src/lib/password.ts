import { sha256 } from 'js-sha256'

/**
 * 客户端密码预哈希（带域分隔）：
 * - 网络请求体与服务器日志中不出现明文口令；
 * - 服务端仍会用 bcrypt 再次哈希存储（双重保护）；
 * - 固定 64 字符输出，天然规避 bcrypt 72 字节截断问题。
 *
 * 注意：局域网 HTTP 下这是纵深防御而非等效于 HTTPS，云端部署必须启用 TLS。
 */
export function prehashPassword(password: string): string {
  return sha256(`jizhang:v1:${password}`)
}
