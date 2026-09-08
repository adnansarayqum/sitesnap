// Postgres access. Present only when DATABASE_URL is set — without it the
// server runs the app in local mode (no accounts), exactly as before.
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATABASE_URL = process.env.DATABASE_URL || "";
export const hasDb = !!DATABASE_URL;

let pool = null;

export function db() {
  if (!pool) {
    if (!hasDb) throw new Error("no database configured");
    const local = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
    pool = new pg.Pool({
      connectionString: DATABASE_URL,
      max: 8,
      // the pg default is to wait forever for a free connection — under a
      // burst of large requests (a photo-heavy case sync holds one client
      // for many sequential queries) that turns pool exhaustion into every
      // other request hanging indefinitely instead of failing fast
      connectionTimeoutMillis: 10_000,
      // Railway's Postgres is TLS with a certificate the client can't verify
      ssl: local || process.env.PGSSL === "off" ? false : { rejectUnauthorized: false },
    });
    pool.on("error", (e) => console.error("pg pool error", e.message));
  }
  return pool;
}

export const q = (text, params) => db().query(text, params);

export async function one(text, params) {
  const r = await q(text, params);
  return r.rows[0] || null;
}

// runs a callback inside a transaction with its own client
export async function tx(fn) {
  const client = await db().connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    try { await client.query("rollback"); } catch { /* connection may be gone */ }
    throw e;
  } finally {
    client.release();
  }
}

// schema.sql is idempotent; migrations.js holds ordered changes made after
// the schema first shipped, each applied once and recorded.
//
// A session-level advisory lock serializes this across concurrent boots —
// Railway can briefly run more than one instance during a deploy, and
// without the lock two instances can both see a migration as unapplied and
// both run its DDL, with the loser's own bookkeeping insert crashing on the
// schema_migrations primary key. Held on one dedicated connection for the
// whole function, since the lock is scoped to the session that took it.
const MIGRATION_LOCK_KEY = 72190001;
export async function migrate() {
  const client = await db().connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
    await client.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
    const { MIGRATIONS } = await import("./migrations.js");
    for (const m of MIGRATIONS) {
      const done = (await client.query("select 1 from schema_migrations where name = $1", [m.name])).rows[0];
      if (done) continue;
      await client.query("begin");
      try {
        await client.query(m.sql);
        await client.query("insert into schema_migrations (name) values ($1)", [m.name]);
        await client.query("commit");
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw e;
      }
      console.log(`migration applied: ${m.name}`);
    }
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

export async function closeDb() {
  if (pool) { await pool.end(); pool = null; }
}
