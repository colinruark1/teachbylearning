// Signed-in user's habit data. vercel.json rewrites /api/me/<path> to /api/me?__path=<path>.
//
//   GET    /api/me/state            commitments, recent check-ins, streak days, text-reminder status
//   POST   /api/me/onboarding       save chosen habits + commitments; marks onboarding done
//   POST   /api/me/checkins         log a session: proof, details, reflection
//   DELETE /api/me/checkins/:id
//   GET    /api/me/proof/:id        a check-in's photo (image/jpeg)
//   GET    /api/me/phone            phone reminder status (see phoneStatus)
//   POST   /api/me/phone            { phone } → sends a verification code (via lib/messaging)
//   POST   /api/me/phone/verify     { code } → turns phone reminders on
//   DELETE /api/me/phone            turn phone reminders off
import { HttpError, bad, json, str, requireUser, readBody, handler } from "../lib/http.js";
import { randomUUID } from "node:crypto";
import { pool } from "../lib/db.js";
import { storage } from "../lib/storage/index.js";
import { isHabit, isTimeZone } from "../lib/habits.js";
import { phone as channel, toE164 } from "../lib/messaging/index.js";
import { startVerification, confirmVerification, windowOpen } from "../lib/bot.js";

/* ---------- State ---------- */

async function phoneStatus(userId) {
  const { rows } = await pool.query(
    "select phone, verified_at, verify_pending, last_inbound_at from phone_link where user_id = $1", [userId]);
  const r = rows[0];
  return {
    configured: channel.configured(),
    channel: { label: channel.label, ...channel.capabilities },  // e.g. "WhatsApp", buttons, replyWindowHours
    phone: r?.phone ?? null,
    verified: Boolean(r?.verified_at),
    pending: Boolean(r?.verify_pending),   // a code was sent and not yet confirmed
    // Some channels (WhatsApp) only allow free-form messages within N hours of the user's
    // last message to us, so the UI asks new users to say hi once via chatLink.
    windowOpen: windowOpen(r?.last_inbound_at),
    hasMessagedUs: Boolean(r?.last_inbound_at),
    chatLink: channel.chatLink(),
  };
}

async function getState(user) {
  const [commitments, checkins, days, phone] = await Promise.all([
    pool.query(
      `select habit, statement, days, to_char(time_local, 'HH24:MI') as time, timezone,
              remind_before_min as "remindBefore", community
       from habit_commitment where user_id = $1 and active order by time_local`, [user.id]),
    pool.query(
      `select id, habit, day, proof_type as "proofType",
              case when proof_type = 'photo' then null else proof end as proof,
              details, reflection, created_at as "createdAt"
       from habit_checkin where user_id = $1 order by day desc, created_at desc limit 40`, [user.id]),
    pool.query(
      `select distinct day from habit_checkin
       where user_id = $1 and day > current_date - 400 order by day desc`, [user.id]),
    phoneStatus(user.id),
  ]);
  return {
    user: { name: user.name, onboarded: Boolean(user.onboardedAt) },
    commitments: commitments.rows,
    checkins: checkins.rows,
    activeDays: days.rows.map((r) => r.day),
    phone,
  };
}

/* ---------- Onboarding / commitments ---------- */

const REMIND_OPTIONS = [0, 10, 15, 30, 45, 60, 90, 120];

function parseCommitment(c) {
  if (!c || typeof c !== "object") bad("Invalid commitment.");
  const habit = c.habit;
  if (!isHabit(habit)) bad("Unknown skill.");
  const statement = str(c.statement, 280);
  if (statement.length < 10) bad("Write a commitment statement for each skill (at least a short sentence).");
  const days = [...new Set(Array.isArray(c.days) ? c.days : [])];
  if (!days.length || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) bad("Pick at least one day.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.time || "")) bad("Pick a time.");
  if (!isTimeZone(c.timezone)) bad("Unknown time zone.");
  const remindBefore = Number(c.remindBefore);
  if (!REMIND_OPTIONS.includes(remindBefore)) bad("Invalid reminder time.");
  // A SKILLS id from stream-platform/skills.js, or "none" to keep check-ins private.
  const community = c.community == null || c.community === "" ? null : String(c.community);
  if (community !== null && !/^[a-z][a-z0-9-]{0,40}$/.test(community)) bad("Unknown community.");
  return { habit, statement, days, time: c.time, timezone: c.timezone, remindBefore, community };
}

async function saveOnboarding(user, body) {
  const list = Array.isArray(body?.commitments) ? body.commitments.map(parseCommitment) : [];
  if (!list.length) bad("Choose at least one skill.");
  if (new Set(list.map((c) => c.habit)).size !== list.length) bad("Each skill can only have one commitment.");

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "delete from habit_commitment where user_id = $1 and not (habit = any($2))", [user.id, list.map((c) => c.habit)]);
    for (const c of list) {
      // A changed schedule may need today's reminder again, so reset the send markers.
      await client.query(
        `insert into habit_commitment (user_id, habit, statement, days, time_local, timezone, remind_before_min, community)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (user_id, habit) do update set
           statement = excluded.statement, days = excluded.days, time_local = excluded.time_local,
           timezone = excluded.timezone, remind_before_min = excluded.remind_before_min, active = true,
           community = excluded.community,
           updated_at = now(),
           last_reminded_on = case when habit_commitment.time_local = excluded.time_local
                                    and habit_commitment.timezone = excluded.timezone
                               then habit_commitment.last_reminded_on end,
           last_followup_on = case when habit_commitment.time_local = excluded.time_local
                                    and habit_commitment.timezone = excluded.timezone
                               then habit_commitment.last_followup_on end`,
        [user.id, c.habit, c.statement, c.days, c.time, c.timezone, c.remindBefore, c.community]);
    }
    await client.query(`update "user" set "onboardedAt" = coalesce("onboardedAt", now()) where id = $1`, [user.id]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
  return { ok: true };
}

/* ---------- Check-ins ---------- */

const MAX_PHOTO_BYTES = 1_800_000; // the client downscales to 1280px JPEG first, so real photos are far smaller

// Photos arrive as a JPEG data URL; they're stored as bytes via lib/storage.
function parseProof(p) {
  const type = p?.type;
  if (type === "photo") {
    const data = typeof p.data === "string" ? p.data : "";
    const m = data.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) bad("Attach a photo as proof.");
    const bytes = Buffer.from(m[1], "base64");
    if (bytes.length > MAX_PHOTO_BYTES) bad("That photo is too large.");
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) bad("That file isn't a JPEG photo.");
    return { type, bytes };
  }
  if (type === "link") {
    let url;
    try { url = new URL(str(p.url, 500)); } catch { bad("Paste a full link, starting with https://"); }
    if (!["https:", "http:"].includes(url.protocol)) bad("Paste a full link, starting with https://");
    return { type, value: url.href };
  }
  if (type === "text") {
    const text = typeof p.text === "string" ? p.text.trim().slice(0, 20000) : "";
    if (!text) bad("Paste your work as proof.");
    return { type, value: text };
  }
  bad("Add proof of what you did.");
}

function parseDetails(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return {};
  const out = {};
  for (const [k, v] of Object.entries(d).slice(0, 20)) {
    if (!/^[a-z][a-zA-Z]{0,30}$/.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.max(0, Math.min(v, 100000));
    else if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 300);
  }
  return out;
}

async function addCheckin(user, body) {
  if (!isHabit(body?.habit)) bad("Unknown skill.");
  // The client sends its own local date. Allow a day either side of UTC for time zones.
  const day = body.day;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "") || Math.abs(Date.parse(day) - Date.now()) > 2 * 864e5) bad("Invalid date.");
  const proof = parseProof(body.proof);
  const details = parseDetails(body.details);
  const reflection = str(body.reflection, 4000);
  if (!reflection) bad("Add a few thoughts on what you accomplished today.");

  // Photos go to file storage first; the row records where (proof_storage) and the file's ref.
  let value = proof.value, storedIn = null;
  if (proof.type === "photo") {
    storedIn = storage.id;
    value = await storage.put(`proof/${user.id}/${randomUUID()}.jpg`, proof.bytes, "image/jpeg");
  }
  try {
    const { rows } = await pool.query(
      `insert into habit_checkin (user_id, habit, day, proof_type, proof, proof_storage, details, reflection)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id, habit, day, proof_type as "proofType",
                 case when proof_type = 'photo' then null else proof end as proof,
                 details, reflection, created_at as "createdAt"`,
      [user.id, body.habit, day, proof.type, value, storedIn, details, reflection]);
    return rows[0];
  } catch (e) {
    if (storedIn) await storage.remove(storedIn, [value]).catch(() => {}); // don't leave an orphaned file
    throw e;
  }
}

async function deleteCheckin(user, id) {
  const { rows } = await pool.query(
    `delete from habit_checkin where id = $1 and user_id = $2
     returning proof_type, proof, proof_storage`, [id, user.id]);
  if (!rows[0]) throw new HttpError(404, "Not found.");
  const r = rows[0];
  if (r.proof_type === "photo") {
    await storage.remove(r.proof_storage, [r.proof]).catch((e) => console.error("storage remove:", e.message));
  }
  return { ok: true };
}

// Only the owner can see a proof photo: this route checks that, then serves the bytes or
// redirects to a short-lived signed link from the storage provider.
async function proofImage(user, id) {
  const { rows } = await pool.query(
    `select proof, proof_storage from habit_checkin
     where id = $1 and user_id = $2 and proof_type = 'photo'`, [id, user.id]);
  if (!rows[0]) throw new HttpError(404, "Not found.");
  const file = await storage.open(rows[0].proof_storage, rows[0].proof);
  if (file.redirect) {
    // Signed links last an hour; let the browser reuse this redirect for a few minutes.
    return new Response(null, { status: 302, headers: { location: file.redirect, "cache-control": "private, max-age=300" } });
  }
  return new Response(file.bytes, {
    headers: { "content-type": file.contentType, "cache-control": "private, max-age=31536000, immutable" },
  });
}

/* ---------- Phone reminders ---------- */

async function addPhone(user, body) {
  if (!channel.configured()) throw new HttpError(503, "Phone reminders aren't set up on this server yet.");
  const phone = toE164(body?.phone);
  if (!phone) bad("Enter your phone number, like (555) 123-4567 or +44 7700 900123.");
  let problem;
  try {
    problem = await startVerification(user.id, phone);
  } catch (e) {
    console.error(e);
    throw new HttpError(502, "We couldn't send a code right now. Try again in a moment.");
  }
  if (problem) bad(problem);
  return phoneStatus(user.id);
}

async function verifyPhone(user, body) {
  const code = String(body?.code ?? "").replace(/\s/g, "");
  if (!/^\d{4,8}$/.test(code)) bad("Enter the code we sent you.");
  const problem = await confirmVerification(user.id, code);
  if (problem) bad(problem);
  return phoneStatus(user.id);
}

async function removePhone(user) {
  await pool.query("delete from phone_link where user_id = $1", [user.id]);
  return phoneStatus(user.id);
}

/* ---------- Router ---------- */

async function route(request, path) {
  const user = await requireUser(request);
  const m = request.method;
  const body = await readBody(request);
  let id;

  if (path === "state" && m === "GET") return json(await getState(user));
  if (path === "onboarding" && m === "POST") return json(await saveOnboarding(user, body));
  if (path === "checkins" && m === "POST") return json(await addCheckin(user, body), 201);
  if ((id = path.match(/^checkins\/(\d+)$/)?.[1]) && m === "DELETE") return json(await deleteCheckin(user, id));
  if ((id = path.match(/^proof\/(\d+)$/)?.[1]) && m === "GET") return proofImage(user, id);
  if (path === "phone" && m === "GET") return json(await phoneStatus(user.id));
  if (path === "phone" && m === "POST") return json(await addPhone(user, body));
  if (path === "phone" && m === "DELETE") return json(await removePhone(user));
  if (path === "phone/verify" && m === "POST") return json(await verifyPhone(user, body));
  throw new HttpError(404, "Not found.");
}

export default handler("me", route);
