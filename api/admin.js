// Admin dashboard API (stream-platform/admin.html). Admins only: see lib/admin.js.
// vercel.json rewrites /api/admin/<path> to /api/admin?__path=<path>.
//
//   GET  /api/admin/overview   signed-up users + contact details, and integration health
//   POST /api/admin/text       { userId, message } → messages a user's verified phone (lib/messaging)
//   POST /api/admin/email      { userId, subject, message } → emails a user (lib/messaging)
import { HttpError, bad, json, str, requireUser, readBody, handler } from "../lib/http.js";
import { pool, baseURL } from "../lib/db.js";
import { phone, email, CannotDeliver } from "../lib/messaging/index.js";
import { deliver, windowOpen } from "../lib/bot.js";
import { heartbeats } from "../lib/heartbeat.js";
import { storage } from "../lib/storage/index.js";
import * as strava from "../lib/strava.js";

/* ---------- Users ---------- */

async function users() {
  const { rows } = await pool.query(`
    select u.id, u.name, u.email, u."emailVerified", u."twoFactorEnabled", u."createdAt", u."onboardedAt",
           p.phone, p.verified_at as "phoneVerifiedAt", p.last_inbound_at as "lastInboundAt",
           coalesce((select array_agg(c.habit order by c.time_local) from habit_commitment c
                     where c.user_id = u.id and c.active), '{}') as habits,
           (select count(*)::int from habit_checkin k where k.user_id = u.id) as checkins,
           (select max(k.created_at) from habit_checkin k where k.user_id = u.id) as "lastCheckinAt",
           (select max(s."updatedAt") from session s where s."userId" = u.id) as "lastSeenAt"
    from "user" u
    left join phone_link p on p.user_id = u.id
    order by u."createdAt" desc
    limit 1000`);
  return rows;
}

/* ---------- Integration health ---------- */
// Each check: { id, name, status: "ok" | "warn" | "missing", detail, fix? }.
// "missing" = not wired at all; "warn" = wired but misconfigured, stale, or a stand-in.

const MIN = 60e3;
const ago = (t) => (t ? Date.now() - new Date(t).getTime() : Infinity);
const when = (t) => {
  if (!t) return "never";
  const m = Math.round(ago(t) / MIN);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

async function schemaCheck() {
  const tables = ["habit_commitment", "habit_checkin", "phone_link", "webhook_event", "app_heartbeat", "strava_link"];
  const { rows } = await pool.query(
    `select t, to_regclass(t) is not null as present from unnest($1::text[]) as t`, [tables]);
  const cols = [["user", "onboardedAt"], ["habit_checkin", "proof_storage"], ["phone_link", "last_inbound_at"]];
  const { rows: found } = await pool.query(
    `select table_name || '.' || column_name as c from information_schema.columns
     where (table_name, column_name) in (select * from unnest($1::text[], $2::text[]))`,
    [cols.map((c) => c[0]), cols.map((c) => c[1])]);
  const have = new Set(found.map((r) => r.c));
  const missing = [...rows.filter((r) => !r.present).map((r) => r.t),
    ...cols.map(([t, c]) => `${t}.${c}`).filter((c) => !have.has(c))];
  return {
    id: "schema", name: "Database tables",
    status: missing.length ? "missing" : "ok",
    detail: missing.length ? `Missing: ${missing.join(", ")}` : "All app tables and columns exist.",
    fix: missing.length ? "Run `npm run migrate` against this database." : undefined,
  };
}

function authCheck() {
  const secret = process.env.BETTER_AUTH_SECRET || "";
  const prod = process.env.VERCEL_ENV === "production";
  const problems = [];
  if (secret.length < 32) problems.push("BETTER_AUTH_SECRET is missing or short");
  if (!baseURL) problems.push("BETTER_AUTH_URL is not set");
  else if (prod && !baseURL.startsWith("https://")) problems.push(`BETTER_AUTH_URL is ${baseURL} (should be https in production)`);
  return {
    id: "auth", name: "Sign-in (Better Auth + 2FA)",
    status: problems.length ? "warn" : "ok",
    detail: problems.length ? problems.join("; ") + "." : `Sessions and 2FA working at ${baseURL}.`,
    fix: problems.length ? "Set the variables in Vercel → Settings → Environment Variables (see .env.example)." : undefined,
  };
}

// Whether messages are actually going out, whatever the provider.
function deliveryCheck(kind, name, hb) {
  const sent = hb[`${kind}_send`]?.at, failed = hb[`${kind}_send_error`]?.at;
  const undeliverable = kind === "phone" ? hb.reminders_tick?.detail?.undeliverable ?? 0 : 0;
  const provider = kind === "phone" ? phone : email;
  if (failed && ago(failed) < ago(sent)) {
    return { id: `${kind}_send`, name, status: "warn",
      detail: `Last send failed ${when(failed)}: ${hb[`${kind}_send_error`].detail?.message ?? "unknown error"}`,
      fix: `Check the error above and the ${provider.id} dashboard.` };
  }
  if (undeliverable) {
    return { id: `${kind}_send`, name, status: "warn",
      detail: `${undeliverable} reminder(s) in the last run couldn't be sent because of ${phone.label} rules (e.g. a closed reply window).`,
      fix: "See the provider checks above (for WhatsApp, set BIRD_TEMPLATE_SLUG)." };
  }
  return { id: `${kind}_send`, name, status: sent ? "ok" : provider.configured() ? "warn" : "missing",
    detail: sent ? `Last message sent ${when(sent)} via ${provider.id}.` : `Nothing has been sent via ${provider.id} yet.` };
}

async function messagingChecks(hb) {
  const [phoneChecks, emailChecks] = await Promise.all([phone.health(hb), email.health(hb)]);
  return [
    ...phoneChecks,
    ...(phone.configured() ? [deliveryCheck("phone", `${phone.label} delivery`, hb)] : []),
    ...emailChecks,
    ...(email.configured() ? [deliveryCheck("email", "Email delivery", hb)] : []),
  ];
}

function cronCheck(hb) {
  const last = hb.reminders_tick?.at;
  const fix = "Point cron-job.org (or .github/workflows/reminders.yml) at POST /api/reminders every 5 min with `Authorization: Bearer $CRON_SECRET`.";
  if (!process.env.CRON_SECRET) {
    return { id: "cron", name: "Reminder scheduler", status: "missing", detail: "CRON_SECRET is not set, so /api/reminders refuses every call.", fix };
  }
  if (!last) return { id: "cron", name: "Reminder scheduler", status: "missing", detail: "The reminder check has never run.", fix };
  const stale = ago(last) > 15 * MIN;
  return {
    id: "cron", name: "Reminder scheduler", status: stale ? "warn" : "ok",
    detail: `Last ran ${when(last)}${stale ? ", so reminders are late or not going out" : ""}.`,
    fix: stale ? fix : undefined,
  };
}

// Strava OAuth (lib/strava.js): app credentials, connected athletes, and the deauth webhook.
async function stravaCheck(hb, schemaOk) {
  const fix = "Create an app at strava.com/settings/api and set STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET (see .env.example).";
  if (!strava.configured()) {
    return { id: "strava", name: "Strava", status: "missing", detail: "STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET are not set, so Connect with Strava is off.", fix };
  }
  const n = schemaOk ? (await pool.query("select count(*)::int as n from strava_link")).rows[0].n : 0;
  const hook = process.env.STRAVA_SUBSCRIPTION_ID;
  return {
    id: "strava", name: "Strava", status: hook ? "ok" : "warn",
    detail: `${n} athlete(s) connected. Redirect URI ${strava.redirectURI()}. `
      + (hook ? `Webhook subscription ${hook}, last event ${when(hb.strava_webhook?.at)}.` : "No webhook subscription, so revoked access is only noticed on next use.")
      + " New Strava apps allow 1 athlete until Strava reviews them.",
    fix: hook ? undefined : "Run `npm run strava:webhook` with BETTER_AUTH_URL set to the deployed origin, then set STRAVA_SUBSCRIPTION_ID.",
  };
}

// Parts of the site that are still stand-ins. Update this list as they get real backends.
const KNOWN_GAPS = [
  { id: "streams", name: "Community live streams", status: "missing",
    detail: "Live streams are mock data (LIVE_STREAMS in communities.js) and there is no stream player yet. The unlinked Browse page (browse.html) uses STREAMS, CATEGORIES in app.js." },
  { id: "learn", name: "Community posts & requests", status: "missing",
    detail: "Progress posts, discussions, likes, comments and community requests live in each visitor's browser (localStorage), so nobody else sees them." },
];

// Active provider's own checks, plus photos still held by an older provider.
async function storageChecks() {
  const checks = await storage.health();
  const { rows: [{ n }] } = await pool.query(
    `select count(*)::int as n from habit_checkin
     where proof_type = 'photo' and coalesce(proof_storage, 'postgres') <> $1`, [storage.id]);
  if (n && storage.id !== "postgres") {
    checks.push({ id: "storage_migrate", name: "Photos to migrate", status: "warn",
      detail: `${n} older photo(s) are still stored outside ${storage.label}. They still display fine.`,
      fix: "Run `npm run storage:migrate` to move them." });
  }
  return checks;
}

async function health() {
  let db;
  try {
    await pool.query("select 1");
    db = { id: "db", name: "Database", status: "ok", detail: "Connected." };
  } catch (e) {
    return [{ id: "db", name: "Database", status: "missing", detail: `Can't connect: ${e.message}`, fix: "Check DATABASE_URL." }];
  }
  const schema = await schemaCheck();
  const hb = schema.status === "ok" ? await heartbeats() : {};
  return [db, schema, authCheck(), ...(await messagingChecks(hb)), ...(await storageChecks()), cronCheck(hb), await stravaCheck(hb, schema.status === "ok"), ...KNOWN_GAPS];
}

/* ---------- Actions ---------- */

async function sendText(admin, body) {
  const message = str(body?.message, 1000);
  if (!message) bad("Write a message first.");
  const { rows } = await pool.query(
    "select phone, last_inbound_at from phone_link where user_id = $1 and verified_at is not null",
    [String(body?.userId ?? "")]);
  if (!rows[0]) bad("That user hasn't connected a phone number, or turned reminders off.");
  let via;
  try {
    via = await deliver(rows[0], message);
  } catch (e) {
    if (e instanceof CannotDeliver) bad(`${phone.label} won't deliver this right now: ${e.message}`);
    console.error(e);
    throw new HttpError(502, `${phone.id} couldn't send it: ${e.message}`);
  }
  console.log(`admin ${admin.email} messaged user ${body.userId} (${via})`);
  return { ok: true, via, windowOpen: windowOpen(rows[0].last_inbound_at) };
}

async function sendEmail(admin, body) {
  if (!email.configured()) bad("No email provider is set up yet (EMAIL_PROVIDER).");
  const subject = str(body?.subject, 200);
  const message = str(body?.message, 10000);
  if (!subject || !message) bad("Add a subject and a message.");
  const { rows } = await pool.query(`select email from "user" where id = $1`, [String(body?.userId ?? "")]);
  if (!rows[0]) bad("User not found.");
  try {
    await email.send({ to: rows[0].email, subject, text: message });
  } catch (e) {
    console.error(e);
    throw new HttpError(502, `${email.id} couldn't send it: ${e.message}`);
  }
  console.log(`admin ${admin.email} emailed user ${body.userId}`);
  return { ok: true };
}

/* ---------- Router ---------- */

async function route(request, path) {
  const user = await requireUser(request);
  if (!user.isAdmin) throw new HttpError(403, "Admins only.");
  const m = request.method;
  const body = await readBody(request);

  if (path === "overview" && m === "GET") {
    const [list, checks] = await Promise.all([users(), health()]);
    for (const u of list) if (u.phone) u.phoneLink = phone.contactLink(u.phone);
    return json({
      users: list, health: checks, generatedAt: new Date().toISOString(),
      messaging: {
        phone: { id: phone.id, label: phone.label, configured: phone.configured(), replyWindowHours: phone.capabilities.replyWindowHours },
        email: { id: email.id, label: email.label, configured: email.configured() },
      },
    });
  }
  if (path === "text" && m === "POST") return json(await sendText(user, body));
  if (path === "email" && m === "POST") return json(await sendEmail(user, body));
  throw new HttpError(404, "Not found.");
}

export default handler("admin", route);
