import { AsyncLocalStorage } from 'node:async_hooks';

const runtime = new AsyncLocalStorage();
const schemaPromises = new WeakMap();

function currentEnv() {
  const env = runtime.getStore();
  if (!env) throw new Error('Cloudflare runtime context is unavailable.');
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is not configured.');
  return env;
}

export function withCloudflareEnv(env, callback) {
  return runtime.run(env, callback);
}

async function ensureSchema(db) {
  let promise = schemaPromises.get(db);
  if (!promise) {
    promise = db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS kv_store (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (namespace, key)
      )`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_kv_store_namespace ON kv_store(namespace)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (
        scope TEXT NOT NULL,
        subject TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (scope, subject)
      )`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_rate_limits_updated ON rate_limits(updated_at)`),
    ]).catch((error) => {
      schemaPromises.delete(db);
      throw error;
    });
    schemaPromises.set(db, promise);
  }
  await promise;
}

function decode(row, type) {
  if (!row) return null;
  if (type === 'json') {
    try { return JSON.parse(row.value); } catch { return null; }
  }
  return row.value;
}

function changes(result) {
  return Number(result?.meta?.changes || 0);
}

export function getStore({ name } = {}) {
  const namespace = String(name || '').trim();
  if (!namespace) throw new Error('Store name is required.');

  async function database() {
    const db = currentEnv().DB;
    await ensureSchema(db);
    return db;
  }

  return {
    async get(key, options = {}) {
      const db = await database();
      const row = await db.prepare('SELECT value FROM kv_store WHERE namespace = ? AND key = ?')
        .bind(namespace, String(key))
        .first();
      return decode(row, options.type);
    },

    async getWithMetadata(key, options = {}) {
      const db = await database();
      const row = await db.prepare('SELECT value, version FROM kv_store WHERE namespace = ? AND key = ?')
        .bind(namespace, String(key))
        .first();
      if (!row) return null;
      return { data: decode(row, options.type), etag: String(row.version) };
    },

    async setJSON(key, value, options = {}) {
      const db = await database();
      const itemKey = String(key);
      const payload = JSON.stringify(value);
      const now = new Date().toISOString();

      if (options.onlyIfNew) {
        const result = await db.prepare(`INSERT INTO kv_store(namespace, key, value, version, updated_at)
          VALUES (?, ?, ?, 1, ?)
          ON CONFLICT(namespace, key) DO NOTHING`)
          .bind(namespace, itemKey, payload, now)
          .run();
        const modified = changes(result) > 0;
        return { modified, etag: modified ? '1' : null };
      }

      if (options.onlyIfMatch != null) {
        const expected = Number(options.onlyIfMatch);
        if (!Number.isInteger(expected) || expected < 1) return { modified: false, etag: null };
        const result = await db.prepare(`UPDATE kv_store
          SET value = ?, version = version + 1, updated_at = ?
          WHERE namespace = ? AND key = ? AND version = ?`)
          .bind(payload, now, namespace, itemKey, expected)
          .run();
        const modified = changes(result) > 0;
        return { modified, etag: modified ? String(expected + 1) : null };
      }

      await db.prepare(`INSERT INTO kv_store(namespace, key, value, version, updated_at)
        VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(namespace, key) DO UPDATE SET
          value = excluded.value,
          version = kv_store.version + 1,
          updated_at = excluded.updated_at`)
        .bind(namespace, itemKey, payload, now)
        .run();
      return { modified: true, etag: null };
    },

    async set(key, value, options = {}) {
      return this.setJSON(key, value, options);
    },

    async delete(key) {
      const db = await database();
      await db.prepare('DELETE FROM kv_store WHERE namespace = ? AND key = ?')
        .bind(namespace, String(key))
        .run();
    },
  };
}

export async function cloudflareDatabase() {
  const db = currentEnv().DB;
  await ensureSchema(db);
  return db;
}
