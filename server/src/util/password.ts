import { createHash } from 'node:crypto'

/**
 * 与前端 src/lib/password.ts 完全一致的客户端预哈希（域分隔）。
 * 服务端收到的登录/注册密码已是该哈希；种子固定账号时必须同样先预哈希再 bcrypt。
 */
export function prehashPassword(password: string): string {
  return createHash('sha256').update(`jizhang:v1:${password}`, 'utf8').digest('hex')
}
