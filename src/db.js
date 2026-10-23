import pg from "pg";

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and point it at your Postgres.");
  const useSsl = /sslmode=require/.test(connectionString) || process.env.PGSSL === "true";
  return new pg.Pool({ connectionString, max: 5, ssl: useSsl ? { rejectUnauthorized: false } : undefined });
}
