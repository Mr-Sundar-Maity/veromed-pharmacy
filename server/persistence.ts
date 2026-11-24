import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import pg from 'pg';

const { Pool } = pg;
const STATE_ID = 'primary';

function createPool(): pg.Pool | null {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return null;
  return new Pool({ connectionString, max: 2, idleTimeoutMillis: 10_000 });
}

async function ensurePersistenceSchema(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS veromed_sqlite_state (
      id TEXT PRIMARY KEY,
      database_gzip BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS veromed_uploaded_files (
      file_key TEXT PRIMARY KEY,
      content BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function initializePersistenceSchema(): Promise<void> {
  const pool = createPool();
  if (!pool) throw new Error('DATABASE_URL is not configured.');
  try {
    await ensurePersistenceSchema(pool);
    await pool.query('SELECT 1');
  } finally {
    await pool.end();
  }
}

export function neonPersistenceEnabled(): boolean {
  return process.env.NODE_ENV === 'production' && Boolean(process.env.DATABASE_URL?.trim());
}

export async function restorePersistentState(databasePath: string, uploadsDir: string): Promise<boolean> {
  if (!neonPersistenceEnabled()) return false;
  const pool = createPool();
  if (!pool) return false;
  try {
    await ensurePersistenceSchema(pool);
    const state = await pool.query<{ database_gzip: Buffer }>(
      'SELECT database_gzip FROM veromed_sqlite_state WHERE id = $1',
      [STATE_ID]
    );
    if (state.rows[0]?.database_gzip) {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
      for (const suffix of ['-wal', '-shm']) {
        const stalePath = `${databasePath}${suffix}`;
        if (fs.existsSync(stalePath)) fs.unlinkSync(stalePath);
      }
      fs.writeFileSync(databasePath, gunzipSync(state.rows[0].database_gzip));
    }

    fs.mkdirSync(uploadsDir, { recursive: true });
    const files = await pool.query<{ file_key: string; content: Buffer }>(
      'SELECT file_key, content FROM veromed_uploaded_files'
    );
    for (const file of files.rows) {
      const safeKey = path.basename(file.file_key);
      if (safeKey !== file.file_key) continue;
      fs.writeFileSync(path.join(uploadsDir, safeKey), file.content);
    }
    return state.rowCount === 1;
  } finally {
    await pool.end();
  }
}

export async function savePersistentState(databasePath: string, uploadsDir: string): Promise<void> {
  if (!neonPersistenceEnabled() || !fs.existsSync(databasePath)) return;
  const pool = createPool();
  if (!pool) return;
  try {
    await ensurePersistenceSchema(pool);
    const databaseGzip = gzipSync(fs.readFileSync(databasePath), { level: 6 });
    await pool.query(
      `INSERT INTO veromed_sqlite_state (id, database_gzip, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET database_gzip = EXCLUDED.database_gzip, updated_at = NOW()`,
      [STATE_ID, databaseGzip]
    );

    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir, { withFileTypes: true }).filter((entry) => entry.isFile());
      for (const file of files) {
        const filePath = path.join(uploadsDir, file.name);
        await pool.query(
          `INSERT INTO veromed_uploaded_files (file_key, content, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (file_key) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()`,
          [file.name, fs.readFileSync(filePath)]
        );
      }
    }
  } finally {
    await pool.end();
  }
}
