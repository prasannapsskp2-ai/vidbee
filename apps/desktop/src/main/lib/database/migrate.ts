import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { app } from 'electron'

const MIGRATIONS_RELATIVE_PATH = 'resources/drizzle'
const MIGRATIONS_TABLE = '__drizzle_migrations'
const LEGACY_MIGRATIONS = [
  {
    createdAt: 1_763_176_841_336,
    hash: '20c544c34667576d75c3c377d9f10aeaa281eba2892a91b32c7d6b32fbeb33d3',
    isApplied: (sqlite: Database.Database): boolean =>
      hasTable(sqlite, 'download_history') &&
      hasTable(sqlite, 'subscription_items') &&
      hasTable(sqlite, 'subscriptions') &&
      hasIndex(sqlite, 'subscription_items_subscription_idx')
  },
  {
    createdAt: 1_768_961_568_903,
    hash: '820a72164d76d265455f1a8642e27af0beaae03b2878df2726bfcc3f3105ca04',
    isApplied: (sqlite: Database.Database): boolean =>
      hasColumn(sqlite, 'download_history', 'yt_dlp_command'),
    addsColumns: [{ table: 'download_history', column: 'yt_dlp_command' }]
  },
  {
    createdAt: 1_768_961_585_359,
    hash: 'b52ea0e29bd5d00f68db555d33153432c66dbd286c0594e85d40b20094e941e8',
    isApplied: (sqlite: Database.Database): boolean =>
      hasColumn(sqlite, 'download_history', 'yt_dlp_log'),
    addsColumns: [{ table: 'download_history', column: 'yt_dlp_log' }]
  }
] as const

type LegacyMigration = (typeof LEGACY_MIGRATIONS)[number]

/**
 * Check whether a SQLite table already exists.
 *
 * @param sqlite The raw SQLite connection.
 * @param tableName The table name to look up.
 * @returns True when the table exists.
 */
const hasTable = (sqlite: Database.Database, tableName: string): boolean =>
  Boolean(
    sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(tableName)
  )

/**
 * Check whether a SQLite index already exists.
 *
 * @param sqlite The raw SQLite connection.
 * @param indexName The index name to look up.
 * @returns True when the index exists.
 */
const hasIndex = (sqlite: Database.Database, indexName: string): boolean =>
  Boolean(
    sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1")
      .get(indexName)
  )

/**
 * Check whether a table already contains a specific column.
 *
 * @param sqlite The raw SQLite connection.
 * @param tableName The table to inspect.
 * @param columnName The target column name.
 * @returns True when the column exists.
 */
const hasColumn = (sqlite: Database.Database, tableName: string, columnName: string): boolean => {
  if (!hasTable(sqlite, tableName)) {
    return false
  }

  const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name?: string
  }>
  return columns.some((column) => column.name === columnName)
}

/**
 * Read the underlying better-sqlite3 connection from a Drizzle database.
 *
 * @param database The Drizzle database wrapper.
 * @returns The raw SQLite connection.
 */
const getSqliteConnection = (database: BetterSQLite3Database): Database.Database =>
  (database as BetterSQLite3Database & { $client: Database.Database }).$client

/**
 * Backfill missing Drizzle migration rows for legacy databases that already match the schema.
 *
 * @param sqlite The raw SQLite connection.
 */
export const reconcileLegacyMigrationState = (sqlite: Database.Database): void => {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`
  )

  const appliedHashes = new Set<string>(
    (
      sqlite.prepare(`SELECT hash FROM "${MIGRATIONS_TABLE}"`).all() as Array<{
        hash: string
      }>
    ).map((row) => row.hash)
  )
  const insertMigration = sqlite.prepare(
    `INSERT INTO "${MIGRATIONS_TABLE}" (hash, created_at) VALUES (?, ?)`
  )

  for (const migration of LEGACY_MIGRATIONS) {
    if (!(migration.isApplied(sqlite) && !appliedHashes.has(migration.hash))) {
      continue
    }

    insertMigration.run(migration.hash, migration.createdAt)
    appliedHashes.add(migration.hash)
  }
}

/**
 * Extract the failing column name from a SQLite duplicate-column error.
 *
 * @param error The error thrown by drizzle's migrator.
 * @returns The duplicate column name when the error matches, otherwise null.
 */
const matchDuplicateColumnError = (error: unknown): string | null => {
  if (!(error instanceof Error)) {
    return null
  }
  const match = error.message.match(/duplicate column name:\s*([\w]+)/i)
  return match?.[1] ?? null
}

/**
 * Find a legacy migration that adds the given column so we can mark it
 * applied without re-running its ALTER TABLE.
 *
 * @param columnName The duplicate column reported by SQLite.
 * @returns The matching legacy migration entry when known.
 */
const findLegacyMigrationForColumn = (columnName: string): LegacyMigration | null => {
  for (const migration of LEGACY_MIGRATIONS) {
    if (!('addsColumns' in migration)) {
      continue
    }
    const hit = migration.addsColumns?.some((entry) => entry.column === columnName)
    if (hit) {
      return migration
    }
  }
  return null
}

export const runMigrations = (database: BetterSQLite3Database): void => {
  const migrationsFolder = resolveMigrationsFolder()
  if (!migrationsFolder) {
    throw new Error('drizzle migrations folder not found for desktop')
  }

  const sqlite = getSqliteConnection(database)
  reconcileLegacyMigrationState(sqlite)

  try {
    migrate(database, { migrationsFolder, migrationsTable: MIGRATIONS_TABLE })
  } catch (error) {
    // Sentry issue VIDBEE-16: legacy 1.3.x desktops still hit
    // `SqliteError: duplicate column name: <col>` when the local DB had the
    // column added by an older raw-ALTER path but our journal hash for that
    // migration doesn't match what reconcileLegacyMigrationState backfills.
    // Treat the migration as already applied: backfill its hash and retry.
    const duplicateColumn = matchDuplicateColumnError(error)
    if (!duplicateColumn) {
      throw error
    }

    const legacy = findLegacyMigrationForColumn(duplicateColumn)
    if (!legacy) {
      throw error
    }

    sqlite
      .prepare(`INSERT OR IGNORE INTO "${MIGRATIONS_TABLE}" (hash, created_at) VALUES (?, ?)`)
      .run(legacy.hash, legacy.createdAt)

    migrate(database, { migrationsFolder, migrationsTable: MIGRATIONS_TABLE })
  }
}

const resolveMigrationsFolder = (): string | null => {
  const candidates = new Set<string>()
  candidates.add(resolve(process.cwd(), MIGRATIONS_RELATIVE_PATH))
  candidates.add(resolve(import.meta.dirname, '../../../../', MIGRATIONS_RELATIVE_PATH))

  if (process.resourcesPath) {
    candidates.add(join(process.resourcesPath, MIGRATIONS_RELATIVE_PATH))
    candidates.add(join(process.resourcesPath, 'app.asar.unpacked', MIGRATIONS_RELATIVE_PATH))
  }

  try {
    candidates.add(join(app.getAppPath(), MIGRATIONS_RELATIVE_PATH))
  } catch {
    // app might not be ready yet, ignore
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}
