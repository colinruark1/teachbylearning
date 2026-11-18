// Shared helpers for the JSON API functions in api/ (me.js, admin.js).
import { auth } from "./auth.js";

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = (msg) => { throw new HttpError(400, msg); };

export const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});

export const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// The signed-in user, with 2FA finished. user.isAdmin comes from lib/auth.js (customSession).
export async function requireUser(request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw new HttpError(401, "Sign in first.");
  if (!session.user.twoFactorEnabled) throw new HttpError(403, "Finish setting up two-factor authentication first.");
  return session.user;
}

// Serves a file from lib/storage's open(): a redirect to a short-lived signed link, or the bytes.
export function fileResponse(file) {
  if (file.redirect) {
    // Signed links last an hour; let the browser reuse this redirect for a few minutes.
    return new Response(null, { status: 302, headers: { location: file.redirect, "cache-control": "private, max-age=300" } });
  }
  return new Response(file.bytes, {
    headers: { "content-type": file.contentType, "cache-control": "private, max-age=31536000, immutable" },
  });
}

// Body for POST requests: {} when empty, 400 on bad JSON.
export async function readBody(request) {
  if (request.method !== "POST") return undefined;
  const text = await request.text();
  try { return text ? JSON.parse(text) : {}; } catch { bad("Invalid JSON."); }
}

// Wraps a router as a Vercel web handler. vercel.json rewrites /api/<name>/<path> to
// /api/<name>?__path=<path>; the router gets that <path>.
export const handler = (name, route) => ({
  async fetch(request) {
    const url = new URL(request.url);
    const path = (url.searchParams.get("__path") ?? url.pathname.replace(new RegExp(`^/api/${name}/?`), ""))
      .replace(/^\/+|\/+$/g, "");
    try {
      return await route(request, path);
    } catch (e) {
      if (e instanceof HttpError) return json({ message: e.message }, e.status);
      console.error(e);
      return json({ message: "Something went wrong. Try again." }, 500);
    }
  },
});
