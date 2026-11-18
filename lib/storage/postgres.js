// Storage provider: files inline in the database as data URLs (the original behavior).
// Needs no setup, so it's the default for local development without Supabase keys.
// Implements the contract in lib/storage/index.js. Select it with STORAGE_PROVIDER=postgres.
export const id = "postgres";
export const label = "Postgres (inline)";

export const configured = () => true;

export async function put(_key, bytes, contentType) {
  return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
}

export async function open(ref) {
  const [head, b64] = String(ref).split(",");
  return { bytes: Buffer.from(b64 || "", "base64"), contentType: head.match(/^data:([^;]+)/)?.[1] || "application/octet-stream" };
}

// The data lives in the row itself, so deleting the row deletes the file.
export async function remove() {}

export async function setup() {
  return ["Postgres storage needs no setup: files are stored inline in the database."];
}

export async function health() {
  return [{
    id: "storage", name: "Photo storage", status: "warn",
    detail: "Check-in photos are stored inside Postgres (STORAGE_PROVIDER=postgres). Fine for local dev; bloats the database in production.",
    fix: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, run `npm run storage:setup`, then `npm run storage:migrate`.",
  }];
}
