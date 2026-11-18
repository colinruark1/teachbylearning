// File storage facade: the ONLY module the app uses to store and serve uploaded files
// (check-in proof photos today).
//
//   import { storage } from "../lib/storage/index.js";
//
// Which service holds the files is picked by env var, so it can be swapped without
// touching app code:
//
//   STORAGE_PROVIDER   supabase | postgres
//                      default: supabase if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set,
//                      else postgres (the old behavior: files inline in the database, for local dev)
//
// Every stored file is recorded with the id of the provider that holds it (e.g.
// habit_checkin.proof_storage), so files written before a switch keep working until
// `npm run storage:migrate` copies them to the current provider.
//
// To add a provider (e.g. Cloudflare R2), create lib/storage/<id>.js implementing the
// contract below and register it in PROVIDERS.
//
// ── Provider contract ────────────────────────────────────────────────────────────────
//   id, label
//   configured()                     → bool (env vars present)
//   put(key, bytes, contentType)     → ref: the string to save in the database for this file
//   open(ref)                        → { redirect: url } (short-lived link) or { bytes, contentType }
//   remove(refs)                     delete files; missing files are not an error
//   setup()                          one-time setup (create the bucket, …); returns a list of log lines
//   health()                         → [{ id, name, status, detail, fix? }] for the admin dashboard
import * as supabase from "./supabase.js";
import * as postgres from "./postgres.js";

const PROVIDERS = { supabase, postgres };

function current() {
  const id = process.env.STORAGE_PROVIDER
    || (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "postgres");
  const p = PROVIDERS[id];
  if (!p) throw new Error(`Unknown STORAGE_PROVIDER "${id}". Options: ${Object.keys(PROVIDERS).join(", ")}.`);
  return p;
}

// The provider that holds an existing file. Rows from before providers existed have no id
// and were stored inline in Postgres.
export function providerFor(id) {
  const p = PROVIDERS[id || "postgres"];
  if (!p) throw new Error(`File is stored with unknown provider "${id}".`);
  return p;
}

export const storage = {
  get id() { return current().id; },
  get label() { return current().label; },
  configured: () => current().configured(),
  put: (key, bytes, contentType) => current().put(key, bytes, contentType),
  setup: () => current().setup(),
  health: () => current().health(),
  // Reading and deleting go to whichever provider holds the file.
  open: (providerId, ref) => providerFor(providerId).open(ref),
  remove: (providerId, refs) => providerFor(providerId).remove(refs),
};
