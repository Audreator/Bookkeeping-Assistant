import { drizzle } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import * as schema from './schema.ts'

export function createDb(url: string) {
  const parsed = new URL(url)
  const pool = mysql.createPool({
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
    dateStrings: true,
    connectionLimit: 5,
    charset: 'utf8mb4',
  })
  const db = drizzle(pool, { schema, mode: 'default' })
  return { pool, db }
}

export type DB = ReturnType<typeof createDb>['db']
