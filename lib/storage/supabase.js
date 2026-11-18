// Storage provider: Supabase Storage, private bucket, accessed from the server only.
// Implements the contract in lib/storage/index.js.
//
// Env:
//   SUPABASE_URL                https://<project-ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   a secret key (sb_secret_…) or the legacy service_role key (eyJ…).
//                               Server-only: it bypasses all access rules. Never send it to a browser.
//   SUPABASE_STORAGE_BUCKET     bucket name (default "proof-photos"); `npm run storage:setup` creates it
//
// The app signs in with Better Auth, not Supabase Auth, so Supabase's per-user storage
// policies don't apply. Instead the server checks ownership (api/me.js) and hands out
// short-lived signed links.
export const id = "supabase";
export const label = "Supabase Storage";

const env = (k) => process.env[k] || "";
const base = () => `${env("SUPABASE_URL").replace(/\/+$/, "")}/storage/v1`;
const bucket = () => env("SUPABASE_STORAGE_BUCKET") || "proof-photos";
const key = () => env("SUPABASE_SERVICE_ROLE_KEY");
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_TTL_SEC = 3600;

export const configured = () => Boolean(env("SUPABASE_URL") && key());

// New secret keys (sb_secret_…) go only in `apikey`; legacy service_role JWTs also go in
// `Authorization: Bearer` (Supabase docs: "Send publishable and secret keys on the apikey
// header, not on Authorization: Bearer").
const authHeaders = () => ({
  apikey: key(),
  ...(key().startsWith("eyJ") ? { authorization: `Bearer ${key()}` } : {}),
});

const objectPath = (ref) => `${encodeURIComponent(bucket())}/${ref.split("/").map(encodeURIComponent).join("/")}`;

class SupabaseError extends Error {
  constructor(status, body) {
    super(`Supabase Storage ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

async function call(path, { method = "GET", json, body, headers = {} } = {}) {
  const res = await fetch(base() + path, {
    method,
    headers: { ...authHeaders(), ...(json !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : body,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new SupabaseError(res.status, data);
  return data;
}

export async function put(ref, bytes, contentType) {
  await call(`/object/${objectPath(ref)}`, {
    method: "POST", body: bytes,
    headers: { "content-type": contentType, "cache-control": "max-age=31536000", "x-upsert": "true" },
  });
  return ref;
}

export async function open(ref) {
  const data = await call(`/object/sign/${objectPath(ref)}`, { method: "POST", json: { expiresIn: SIGNED_URL_TTL_SEC } });
  // The REST API returns a path relative to /storage/v1 (e.g. "/object/sign/…?token=…").
  const signed = data?.signedURL ?? data?.signedUrl;
  if (!signed) throw new Error(`Supabase Storage: unexpected sign response ${JSON.stringify(data)}`);
  return { redirect: /^https?:\/\//.test(signed) ? signed : `${base()}${signed.startsWith("/") ? "" : "/"}${signed}` };
}

export async function remove(refs) {
  if (!refs.length) return;
  await call(`/object/${encodeURIComponent(bucket())}`, { method: "DELETE", json: { prefixes: refs } });
}

async function getBucket() {
  try {
    return await call(`/bucket/${encodeURIComponent(bucket())}`);
  } catch (e) {
    if (e instanceof SupabaseError && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
}

// Creates the private bucket if needed, then checks every call the app makes with a test file.
export async function setup() {
  const log = [];
  let b = await getBucket();
  if (!b) {
    await call("/bucket", {
      method: "POST",
      json: { id: bucket(), name: bucket(), public: false, file_size_limit: MAX_FILE_BYTES, allowed_mime_types: ["image/jpeg"] },
    });
    log.push(`Created private bucket "${bucket()}".`);
    b = await getBucket();
  } else {
    log.push(`Bucket "${bucket()}" already exists.`);
  }
  if (b?.public) log.push(`⚠ Bucket "${bucket()}" is PUBLIC. Make it private in the Supabase dashboard (Storage → bucket settings).`);

  // Round trip: upload → signed link → download → delete.
  const ref = `_setup-check/${Date.now()}.jpg`;
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); // smallest JPEG markers; content doesn't matter
  await put(ref, bytes, "image/jpeg");
  const { redirect } = await open(ref);
  const res = await fetch(redirect);
  if (!res.ok) throw new Error(`Signed link didn't work (${res.status}): ${redirect}`);
  if (Buffer.from(await res.arrayBuffer()).length !== bytes.length) throw new Error("Downloaded file doesn't match the upload.");
  await remove([ref]);
  log.push("Upload, signed link, download and delete all work.");
  return log;
}

export async function health() {
  const name = "Photo storage (Supabase)";
  if (!configured()) {
    return [{ id: "storage", name, status: "missing", detail: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set.",
      fix: "Copy both from the Supabase dashboard (see CLAUDE.md), then run `npm run storage:setup`." }];
  }
  try {
    const b = await getBucket();
    if (!b) return [{ id: "storage", name, status: "missing", detail: `Bucket "${bucket()}" doesn't exist.`, fix: "Run `npm run storage:setup`." }];
    if (b.public) return [{ id: "storage", name, status: "warn", detail: `Bucket "${bucket()}" is public, so anyone with a file's address can see it.`, fix: "Make it private in Supabase → Storage → bucket settings." }];
    return [{ id: "storage", name, status: "ok", detail: `Private bucket "${bucket()}" is reachable.` }];
  } catch (e) {
    const detail = e.status === 401 || e.status === 403 ? "Supabase rejected SUPABASE_SERVICE_ROLE_KEY." : `Couldn't reach Supabase Storage: ${e.message}`;
    return [{ id: "storage", name, status: "missing", detail, fix: "Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." }];
  }
}
