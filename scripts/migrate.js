// Applies lib/schema.sql. Run via `npm run migrate` (after Better Auth's own migration,
// since the app tables reference "user").
import { readFile } from "node:fs/promises";

try { process.loadEnvFile(".env.local"); } catch { /* use the existing environment */ }
const { pool } = await import("../lib/db.js");

const sql = await readFile(new URL("../lib/schema.sql", import.meta.url), "utf8");
try {
  await pool.query(sql);
  console.log("App tables are up to date.");
} finally {
  await pool.end();
}
