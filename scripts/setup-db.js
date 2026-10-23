import { readFile } from "node:fs/promises";
import { createPool } from "../src/db.js";

const pool = createPool();
try {
  await pool.query(await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
  console.log("✔ schema ready (users, whispers, hearts, session)");
} catch (error) {
  console.error(`✖ ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
