import type { FixedAllocationInput } from '../api/types'

export interface BackupData {
  categories: unknown[]
  transactions: unknown[]
  events: unknown[]
  bills: unknown[]
  payments: unknown[]
  overrides?: unknown[]
  allocations?: unknown[]
  settings: Record<string, unknown>
}

export interface BackupV1 {
  version: 1
  exportedAt: string
  data: BackupData
}

export function buildBackup(data: BackupData): BackupV1 {
  return { version: 1, exportedAt: new Date().toISOString(), data }
}

/** 全部交易/账单恢复后映射分摊，支出先于退款以满足净支付校验。 */
export function mapBackupAllocations(
  data: BackupData,
  txMap: Map<number, number>,
  billMap: Map<number, number>,
): Array<{ transactionId: number; allocations: FixedAllocationInput[] }> {
  const types = new Map((data.transactions as Array<{ id?: number; type?: string }>)
    .map((tx) => [tx.id, tx.type]))
  const grouped = new Map<number, FixedAllocationInput[]>()
  for (const raw of (data.allocations ?? []) as Array<{
    transactionId: number; billId: number; periodKey: string; amount: number
  }>) {
    const transactionId = txMap.get(raw.transactionId)
    const billId = billMap.get(raw.billId)
    if (transactionId == null || billId == null) throw new Error('固定支出分摊关联缺失，备份未能完整恢复')
    const rows = grouped.get(raw.transactionId) ?? []
    rows.push({ billId, periodKey: raw.periodKey, amount: raw.amount })
    grouped.set(raw.transactionId, rows)
  }
  return [...grouped].sort(([a], [b]) => Number(types.get(a) === 'refund') - Number(types.get(b) === 'refund'))
    .map(([id, allocations]) => ({ transactionId: txMap.get(id)!, allocations }))
}

const ITERATIONS = 150_000

const b64encode = (bytes: Uint8Array): string => {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

const b64decode = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations = ITERATIONS,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptBackup(backup: BackupV1, passphrase: string): Promise<Blob> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt)
  const plaintext = new TextEncoder().encode(JSON.stringify(backup))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  const envelope = {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: b64encode(salt),
    iv: b64encode(iv),
    data: b64encode(new Uint8Array(cipher)),
  }
  return new Blob([JSON.stringify(envelope)], { type: 'application/json' })
}

export async function decryptBackup(file: Blob, passphrase: string): Promise<BackupV1> {
  try {
    const envelope = JSON.parse(await file.text()) as {
      v: number
      iterations?: number
      salt: string
      iv: string
      data: string
    }
    if (envelope.v !== 1) throw new Error('版本不支持')
    const salt = b64decode(envelope.salt)
    const iv = b64decode(envelope.iv)
    const key = await deriveKey(passphrase, salt, envelope.iterations ?? ITERATIONS)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      b64decode(envelope.data) as BufferSource,
    )
    return JSON.parse(new TextDecoder().decode(plain)) as BackupV1
  } catch {
    throw new Error('口令错误或文件损坏')
  }
}
