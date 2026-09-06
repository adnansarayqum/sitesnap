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
// the schema first shipped, each applied once and recorded
export async function migrate() {
  await q(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
  await q("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const { MIGRATIONS } = await import("./migrations.js");
  for (const m of MIGRATIONS) {
    const done = await one("select 1 from schema_migrations where name = $1", [m.name]);
    if (done) continue;
    await tx(async (c) => {
      await c.query(m.sql);
      await c.query("insert into schema_migrations (name) values ($1)", [m.name]);
    });
    console.log(`migration applied: ${m.name}`);
  }
}

export async function closeDb() {
  if (pool) { await pool.end(); pool = null; }
}
