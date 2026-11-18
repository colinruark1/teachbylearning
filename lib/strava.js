// Strava OAuth + activity import (https://developers.strava.com/docs/authentication/).
// Tokens live in strava_link, encrypted with a key derived from BETTER_AUTH_SECRET
// (rotating that secret means everyone reconnects Strava, nothing worse).
//
// Env: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET (Strava → Settings → My API Application),
//      STRAVA_VERIFY_TOKEN (any random string; used once when registering the webhook).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { pool, baseURL } from "./db.js";

const OAUTH = "https://www.strava.com/oauth";
const API = "https://www.strava.com/api/v3";
// activity:read_all includes activities the athlete set to "Only You". They still choose
// each activity they post, so this mainly saves "why is my run missing?" confusion.
export const SCOPE = "read,activity:read_all";

const clientId = () => process.env.STRAVA_CLIENT_ID;
const clientSecret = () => process.env.STRAVA_CLIENT_SECRET;
export const configured = () => Boolean(clientId() && clientSecret());
export const redirectURI = () => `${baseURL}/api/strava/callback`;

export class StravaError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ---------- Token encryption (AES-256-GCM) ---------- */

let key;
const tokenKey = () =>
  (key ??= Buffer.from(hkdfSync("sha256", process.env.BETTER_AUTH_SECRET || "", "strava", "token-encryption", 32)));

function seal(text) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}
function open(sealed) {
  const b = Buffer.from(sealed, "base64");
  const d = createDecipheriv("aes-256-gcm", tokenKey(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

/* ---------- OAuth ---------- */

export function authorizeURL(state) {
  const q = new URLSearchParams({
    client_id: clientId(), redirect_uri: redirectURI(), response_type: "code",
    approval_prompt: "auto", scope: SCOPE, state,
  });
  return `${OAUTH}/authorize?${q}`;
}

async function tokenRequest(params) {
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new StravaError(res.status, data.message || `Strava token request failed (${res.status})`);
  return data;
}

async function saveTokens(userId, t, athlete) {
  await pool.query(
    `insert into strava_link (user_id, athlete_id, athlete_name, scope, access_token, refresh_token, expires_at)
     values ($1, $2, $3, $4, $5, $6, to_timestamp($7))
     on conflict (user_id) do update set
       athlete_id = coalesce(excluded.athlete_id, strava_link.athlete_id),
       athlete_name = coalesce(excluded.athlete_name, strava_link.athlete_name),
       scope = coalesce(excluded.scope, strava_link.scope),
       access_token = excluded.access_token, refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at, updated_at = now()`,
    [userId, athlete?.id ?? null, athlete?.name ?? null, athlete?.scope ?? null,
      seal(t.access_token), seal(t.refresh_token), t.expires_at]);
}

// Called by /api/strava/callback with the code Strava sent back.
export async function connect(userId, code, grantedScope) {
  if (!/activity:read/.test(grantedScope || "")) {
    throw new StravaError(400, "Strava didn't share your activities. Connect again and leave “View data about your activities” ticked.");
  }
  const t = await tokenRequest({ code, grant_type: "authorization_code" });
  const a = t.athlete || {};
  const name = [a.firstname, a.lastname].filter(Boolean).join(" ") || null;
  // One app account per Strava athlete: webhook events arrive by athlete id.
  await pool.query("delete from strava_link where athlete_id = $1 and user_id <> $2", [a.id, userId]);
  await saveTokens(userId, t, { id: a.id, name, scope: grantedScope });
}

// A valid access token, refreshed if it expires within 5 minutes. Null when not connected.
async function accessToken(userId) {
  const { rows } = await pool.query(
    "select access_token, refresh_token, expires_at from strava_link where user_id = $1", [userId]);
  const r = rows[0];
  if (!r) return null;
  if (new Date(r.expires_at).getTime() - Date.now() > 5 * 60e3) return open(r.access_token);
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: open(r.refresh_token) });
    await saveTokens(userId, t);
    return t.access_token;
  } catch (e) {
    // 400/401 = the athlete revoked access on strava.com. Forget the link so they can reconnect.
    if (e.status === 400 || e.status === 401) { await forget(userId); return null; }
    throw e;
  }
}

export async function status(userId) {
  const { rows } = await pool.query("select athlete_name, athlete_id from strava_link where user_id = $1", [userId]);
  return { configured: configured(), connected: Boolean(rows[0]), athlete: rows[0]?.athlete_name ?? null };
}

export const forget = (userId) => pool.query("delete from strava_link where user_id = $1", [userId]);
export const forgetAthlete = (athleteId) => pool.query("delete from strava_link where athlete_id = $1", [athleteId]);

// Revoke on Strava's side too, then drop our copy of the tokens.
export async function disconnect(userId) {
  const token = await accessToken(userId).catch(() => null);
  if (token) {
    await fetch(`${OAUTH}/deauthorize`, {
      method: "POST", headers: { authorization: `Bearer ${token}` },
    }).catch((e) => console.error("strava deauthorize:", e.message));
  }
  await forget(userId);
}

/* ---------- Activities ---------- */

// Google encoded polyline → [[lat, lng], …]
function decodePolyline(str) {
  const pts = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i < str.length);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lng += d;
    }
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}

// The route as SVG points fitted to the card's 100×64 viewBox, ~60 points max.
function routePoints(polyline) {
  if (!polyline) return null;
  let pts = decodePolyline(polyline);
  if (pts.length < 2) return null;
  const step = Math.ceil(pts.length / 60);
  pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const midLat = (pts[0][0] * Math.PI) / 180;
  const xy = pts.map(([la, ln]) => [ln * Math.cos(midLat), -la]); // rough equirectangular projection
  const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  const w = Math.max(...xs) - x0 || 1e-9, h = Math.max(...ys) - y0 || 1e-9;
  const s = Math.min(92 / w, 56 / h);
  const ox = (100 - w * s) / 2, oy = (64 - h * s) / 2;
  return xy.map(([x, y]) => `${(ox + (x - x0) * s).toFixed(1)},${(oy + (y - y0) * s).toFixed(1)}`).join(" ");
}

// The shape communities.js renders (stravaCard).
const toCard = (a) => ({
  stravaId: String(a.id),
  type: a.sport_type || a.type || "Workout",
  name: a.name || "Activity",
  distanceKm: Math.round((a.distance || 0) / 100) / 10,
  movingSec: a.moving_time || 0,
  elevM: Math.round(a.total_elevation_gain || 0),
  route: routePoints(a.map?.summary_polyline),
  t: Date.parse(a.start_date) || Date.now(),
});

// The athlete's latest activities, newest first. Null when not connected.
export async function recentActivities(userId, perPage = 10) {
  const token = await accessToken(userId);
  if (!token) return null;
  const res = await fetch(`${API}/athlete/activities?per_page=${perPage}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) { await forget(userId); return null; }
  if (res.status === 429) throw new StravaError(429, "Strava is busy right now (rate limit). Try again in a few minutes.");
  if (!res.ok) throw new StravaError(502, `Strava returned ${res.status}.`);
  return (await res.json()).map(toCard);
}

/* ---------- Webhook subscription (scripts/strava-webhook.js) ---------- */

export async function registerWebhook(callbackURL) {
  const res = await fetch(`${API}/push_subscriptions`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(), client_secret: clientSecret(),
      callback_url: callbackURL, verify_token: process.env.STRAVA_VERIFY_TOKEN || "",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data; // { id }
}
