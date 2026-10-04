import { migrate } from 'drizzle-orm/mysql2/migrator'
import { fileURLToPath } from 'node:url'
import type { DB } from './client.ts'

export async function runMigrations(db: DB): Promise<void> {
  const folder = fileURLToPath(new URL('../../drizzle', import.meta.url))
  await migrate(db, { migrationsFolder: folder })
}
