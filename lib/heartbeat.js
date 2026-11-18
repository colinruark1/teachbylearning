// Records when background pieces last ran (reminder cron, WhatsApp webhook, WhatsApp sends) so the
// admin dashboard can tell "configured" apart from "actually working". Never throws.
import { pool } from "./db.js";

export function beat(key, detail = {}) {
  return pool.query(
    `insert into app_heartbeat (key, at, detail) values ($1, now(), $2)
     on conflict (key) do update set at = now(), detail = excluded.detail`, [key, detail])
    .catch((e) => console.error("heartbeat:", e.message));
}

export async function heartbeats() {
  const { rows } = await pool.query("select key, at, detail from app_heartbeat");
  return Object.fromEntries(rows.map((r) => [r.key, { at: r.at, detail: r.detail }]));
}
