// Admin dashboard API (stream-platform/admin.html). Admins only: see lib/admin.js.
// vercel.json rewrites /api/admin/<path> to /api/admin?__path=<path>.
//
//   GET  /api/admin/overview   signed-up users + contact details, and integration health
//   POST /api/admin/text       { userId, message } → texts a user's verified number via Linq
import { HttpError, bad, json, str, requireUser, readBody, handler } from "../lib/http.js";
import { pool, baseURL } from "../lib/db.js";
import { linq, linqConfigured } from "../lib/linq.js";
import { text } from "../lib/sms.js";
import { heartbeats } from "../lib/heartbeat.js";

/* ---------- Users ---------- */

async function users() {
  const { rows } = await pool.query(`
    select u.id, u.name, u.email, u."emailVerified", u."twoFactorEnabled", u."createdAt", u."onboardedAt",
           p.phone, p.verified_at as "phoneVerifiedAt",
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
  const tables = ["habit_commitment", "habit_checkin", "phone_link", "webhook_event", "app_heartbeat"];
  const { rows } = await pool.query(
    `select t, to_regclass(t) is not null as present from unnest($1::text[]) as t`, [tables]);
  const { rowCount: hasCol } = await pool.query(
    `select 1 from information_schema.columns where table_name = 'user' and column_name = 'onboardedAt'`);
  const missing = [...rows.filter((r) => !r.present).map((r) => r.t), ...(hasCol ? [] : ['"user".onboardedAt'])];
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

async function linqChecks(hb) {
  const out = [];
  const key = process.env.LINQ_API_KEY;
  const dry = Boolean(process.env.LINQ_DRY_RUN);

  // API key: try a real authenticated call, which also tells us whether the webhook is registered.
  let subs = null;
  if (!key) {
    out.push({
      id: "linq_api", name: "Linq texting API",
      status: dry ? "warn" : "missing",
      detail: dry ? "Dry-run mode: texts are printed to the server log, not sent." : "LINQ_API_KEY is not set, so no texts can be sent.",
      fix: "Generate a token at dashboard.linqapp.com → API → Overview, and set LINQ_API_KEY.",
    });
  } else {
    try {
      const data = await linq("/webhook-subscriptions", undefined, "GET");
      subs = Array.isArray(data) ? data : data?.webhook_subscriptions ?? data?.data ?? data?.subscriptions ?? null;
      out.push({
        id: "linq_api", name: "Linq texting API",
        status: dry ? "warn" : "ok",
        detail: dry ? "Token works, but LINQ_DRY_RUN is set, so texts are only logged." : "Token accepted by Linq.",
        fix: dry ? "Remove LINQ_DRY_RUN in production." : undefined,
      });
    } catch (e) {
      out.push({
        id: "linq_api", name: "Linq texting API",
        status: e.status === 401 || e.status === 403 ? "missing" : "warn",
        detail: e.status === 401 || e.status === 403 ? "Linq rejected LINQ_API_KEY." : `Couldn't reach Linq: ${e.message}`,
        fix: e.status === 401 || e.status === 403 ? "Generate a new token in the Linq dashboard and update LINQ_API_KEY." : undefined,
      });
    }
  }

  // Outgoing texts actually going through.
  const sent = hb.linq_send?.at, failed = hb.linq_send_error?.at;
  if (failed && ago(failed) < ago(sent)) {
    out.push({
      id: "linq_send", name: "Text delivery", status: "warn",
      detail: `Last send failed ${when(failed)}: ${hb.linq_send_error.detail?.message ?? "unknown error"}`,
      fix: "Check the Linq dashboard for the line's health, and the error above.",
    });
  } else {
    out.push({
      id: "linq_send", name: "Text delivery", status: sent ? "ok" : linqConfigured() ? "warn" : "missing",
      detail: sent ? `Last text sent ${when(sent)}.` : "No text has been sent yet.",
    });
  }

  // Inbound webhook: secret set, registered with Linq, and receiving.
  const target = baseURL ? `${baseURL}/api/linq` : null;
  const registered = subs && target
    ? subs.some((s) => String(s.target_url || s.webhook_url || "").startsWith(target) && s.is_active !== false)
    : null;
  const got = hb.linq_webhook?.at, badSig = hb.linq_webhook_bad_signature?.at;
  let status = "ok", detail, fix;
  if (!process.env.LINQ_WEBHOOK_SECRET) {
    status = "missing"; detail = "LINQ_WEBHOOK_SECRET is not set, so replies (SKIP, STATUS, …) are rejected.";
    fix = "Run `npm run linq:webhook` with BETTER_AUTH_URL set to this site, then set the printed secret.";
  } else if (badSig && ago(badSig) < ago(got)) {
    status = "warn"; detail = `Linq is calling the webhook but the signature check fails (last ${when(badSig)}).`;
    fix = "LINQ_WEBHOOK_SECRET doesn't match the subscription. Re-run `npm run linq:webhook` and update it.";
  } else if (registered === false) {
    status = "missing"; detail = `No active Linq subscription points at ${target}.`;
    fix = "Run `npm run linq:webhook` with BETTER_AUTH_URL set to this site.";
  } else {
    detail = got ? `Last reply received ${when(got)}.` : "Configured; no replies received yet.";
    if (registered === null && key) detail += " (Couldn't confirm the subscription with Linq.)";
  }
  out.push({ id: "linq_webhook", name: "Text replies (Linq webhook)", status, detail, fix });
  return out;
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

// Parts of the site that are still stand-ins. Update this list as they get real backends.
const KNOWN_GAPS = [
  { id: "email", name: "Email sending", status: "missing",
    detail: "No email provider is connected: no welcome emails, email verification or password reset. Email users from your own inbox for now.",
    fix: "Add a provider (e.g. Resend) and Better Auth's emailVerification / sendResetPassword." },
  { id: "strava", name: "Strava", status: "missing",
    detail: "Connecting Strava on the Learn pages is simulated (STRAVA_ACTIVITIES in learn.js).",
    fix: "Needs Strava OAuth plus a server endpoint to store tokens and fetch activities." },
  { id: "streams", name: "Browse page streams", status: "missing",
    detail: "Streams, channels and categories are mock data (STREAMS, CATEGORIES in app.js)." },
  { id: "learn", name: "Learn community posts", status: "missing",
    detail: "Progress posts, discussions, likes and comments live in each visitor's browser (localStorage), so nobody else sees them." },
  { id: "photos", name: "Proof photo storage", status: "warn",
    detail: "Check-in photos are stored inside Postgres. Fine for now; will bloat the database as usage grows.",
    fix: "Move to object storage (e.g. Vercel Blob) when it matters." },
];

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
  return [db, schema, authCheck(), ...(await linqChecks(hb)), cronCheck(hb), ...KNOWN_GAPS];
}

/* ---------- Actions ---------- */

async function sendText(admin, body) {
  const message = str(body?.message, 1000);
  if (!message) bad("Write a message first.");
  const { rows } = await pool.query(
    "select phone from phone_link where user_id = $1 and verified_at is not null", [String(body?.userId ?? "")]);
  if (!rows[0]) bad("That user hasn't verified a phone number, or turned texts off.");
  let ok;
  try {
    ok = await text(rows[0].phone, message);
  } catch (e) {
    console.error(e);
    throw new HttpError(502, `Linq couldn't send it: ${e.message}`);
  }
  if (!ok) bad("That user has opted out of texts (replied STOP).");
  console.log(`admin ${admin.email} texted user ${body.userId}`);
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
    return json({ users: list, health: checks, generatedAt: new Date().toISOString() });
  }
  if (path === "text" && m === "POST") return json(await sendText(user, body));
  throw new HttpError(404, "Not found.");
}

export default handler("admin", route);
