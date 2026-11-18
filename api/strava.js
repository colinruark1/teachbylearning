// Strava connection for the signed-in user. vercel.json rewrites /api/strava/<path> to
// /api/strava?__path=<path>.
//
//   GET    /api/strava/connect      → 302 to Strava's consent screen (sets a state cookie)
//   GET    /api/strava/callback     Strava sends the user back here → 302 to the Fitness community
//   GET    /api/strava/status       { configured, connected, athlete }
//   GET    /api/strava/activities   { configured, connected, athlete, activities: [...] }
//   DELETE /api/strava              revoke access and forget the tokens
//   GET    /api/strava/webhook      Strava's subscription check (public)
//   POST   /api/strava/webhook      Strava events (public): we act on athlete deauthorizations
import { randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError, json, requireUser, handler } from "../lib/http.js";
import { baseURL } from "../lib/db.js";
import { beat } from "../lib/heartbeat.js";
import * as strava from "../lib/strava.js";

const COOKIE = "tbl_strava_state";
const RETURN_TO = "/stream-platform/communities.html#skill=fitness&tab=progress";

const redirect = (location, headers = {}) => new Response(null, { status: 302, headers: { location, ...headers } });
const back = (params) => `${RETURN_TO}&${new URLSearchParams(params)}`;

function stateCookie(value, maxAge) {
  const secure = baseURL?.startsWith("https://") ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/api/strava; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
const readCookie = (request) =>
  request.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || "";

const sameString = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/* ---------- OAuth ---------- */

async function startConnect(request) {
  await requireUser(request);
  if (!strava.configured()) return redirect(back({ strava: "error", reason: "Strava isn't set up on this server yet." }));
  const state = randomBytes(24).toString("base64url");
  return redirect(strava.authorizeURL(state), { "set-cookie": stateCookie(state, 600) });
}

async function finishConnect(request, url) {
  const clear = { "set-cookie": stateCookie("", 0) };
  const q = url.searchParams;
  const state = q.get("state") || "";
  const expected = readCookie(request);
  if (!expected || !sameString(state, expected)) {
    return redirect(back({ strava: "error", reason: "That Strava link expired. Try connecting again." }), clear);
  }
  if (q.get("error")) return redirect(back({ strava: "error", reason: "Strava wasn't connected." }), clear);

  let user;
  try { user = await requireUser(request); } catch { return redirect("/?next=/stream-platform/communities.html#login", clear); }
  try {
    await strava.connect(user.id, q.get("code") || "", q.get("scope") || "");
  } catch (e) {
    console.error("strava connect:", e.message);
    const reason = e instanceof strava.StravaError && e.status === 400 && /activities/.test(e.message)
      ? e.message : "We couldn't connect Strava. Try again.";
    return redirect(back({ strava: "error", reason }), clear);
  }
  return redirect(back({ strava: "connected" }), clear);
}

/* ---------- Webhook ---------- */

function verifySubscription(url) {
  const q = url.searchParams;
  const token = process.env.STRAVA_VERIFY_TOKEN || "";
  if (q.get("hub.mode") !== "subscribe" || !token || !sameString(q.get("hub.verify_token") || "", token)) {
    throw new HttpError(403, "Bad verify token.");
  }
  return json({ "hub.challenge": q.get("hub.challenge") });
}

// Strava doesn't sign events, so only trust the subscription id we registered (if set) and
// only ever act destructively: a deauthorized athlete's tokens get deleted.
async function onEvent(request) {
  const e = await request.json().catch(() => null);
  const sub = process.env.STRAVA_SUBSCRIPTION_ID;
  if (!e || (sub && String(e.subscription_id) !== sub)) return json({ ok: true });
  if (e.object_type === "athlete" && String(e.updates?.authorized) === "false") {
    await strava.forgetAthlete(e.owner_id ?? e.object_id);
  }
  await beat("strava_webhook", { aspect: e.aspect_type, object: e.object_type });
  return json({ ok: true }); // Strava wants a 200 within 2 seconds
}

/* ---------- Router ---------- */

async function route(request, path) {
  const url = new URL(request.url);
  const m = request.method;

  if (path === "webhook" && m === "GET") return verifySubscription(url);
  if (path === "webhook" && m === "POST") return onEvent(request);
  if (path === "connect" && m === "GET") return startConnect(request);
  if (path === "callback" && m === "GET") return finishConnect(request, url);

  const user = await requireUser(request);
  if (path === "status" && m === "GET") return json(await strava.status(user.id));
  if (path === "activities" && m === "GET") {
    const s = await strava.status(user.id);
    if (!s.configured || !s.connected) return json({ ...s, activities: [] });
    try {
      const activities = await strava.recentActivities(user.id);
      if (!activities) return json({ ...s, connected: false, activities: [] }); // revoked on strava.com
      return json({ ...s, activities });
    } catch (e) {
      if (e instanceof strava.StravaError) throw new HttpError(e.status === 429 ? 429 : 502, e.message);
      throw e;
    }
  }
  if (path === "" && m === "DELETE") {
    await strava.disconnect(user.id);
    return json(await strava.status(user.id));
  }
  throw new HttpError(404, "Not found.");
}

export default handler("strava", route);
