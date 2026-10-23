import pg from "pg";

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * DB_SCHEMA (optional) lets several apps share one Postgres database — each app gets its own schema
 * via search_path. Handy on free hosting tiers that only allow a single database.
 */
export function createPool(connectionString = process.env.DATABASE_URL, schema = process.env.DB_SCHEMA) {
  if (!connectionString) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and point it at your Postgres.");
  if (schema && !SCHEMA_NAME.test(schema)) throw new Error("DB_SCHEMA must be a lowercase identifier like my_app.");
  const useSsl = /sslmode=require/.test(connectionString) || process.env.PGSSL === "true";
  return new pg.Pool({
    connectionString,
    max: 5,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    // Sent at connection startup, so every query on every pooled connection uses the app's schema.
    options: schema ? `-c search_path=${schema}` : undefined,
  });
}

export async function ensureSchema(pool, schema = process.env.DB_SCHEMA) {
  if (schema) await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
}
