// The texting accountability bot, sent through Linq (lib/linq.js): phone verification,
// replies to inbound texts, and the shared helpers used by lib/reminders.js.
//
// Users add their number on the onboarding/Today page and confirm a 6-digit code we text them.
// Reminders say "Reply SKIP to take today off"; they can also text DONE, STATUS or PAUSE.
import { createHash, randomInt } from "node:crypto";
import { pool, baseURL } from "./db.js";
import { HABITS, localNow, toMinutes, fmtClock, fmtDays } from "./habits.js";
import { sendText, LinqError } from "./linq.js";

export const todayUrl = (habit) =>
  `${baseURL || ""}/stream-platform/today.html${habit ? `?habit=${habit}` : ""}`;

const hashCode = (userId, code) => createHash("sha256").update(`${userId}:${code}`).digest("hex");

// Sends a text; if the person has opted out (replied STOP), turns their reminders off.
export async function text(phone, body) {
  try {
    await sendText(phone, body);
    return true;
  } catch (e) {
    if (e instanceof LinqError && e.optedOut) {
      await pool.query("update phone_link set verified_at = null where phone = $1", [phone]);
      return false;
    }
    throw e;
  }
}

/* ---------- Verification ---------- */

const CODE_TTL_MIN = 10;
const RESEND_AFTER_SEC = 45;
const MAX_ATTEMPTS = 5;

// Texts a 6-digit code. Returns an error message string, or null on success.
// This is the first message in a new chat, so it must not contain a link.
export async function startVerification(userId, phone) {
  const { rows } = await pool.query(
    `select 1 from phone_link where phone = $1 and verified_at is not null and user_id <> $2`, [phone, userId]);
  if (rows[0]) return "That number is already connected to another account.";
  const { rows: recent } = await pool.query(
    `select 1 from phone_link where user_id = $1 and phone = $2
       and code_sent_at > now() - make_interval(secs => $3)`, [userId, phone, RESEND_AFTER_SEC]);
  if (recent[0]) return "We just sent a code. Give it a moment before asking for another.";

  const code = String(randomInt(0, 1e6)).padStart(6, "0");
  await pool.query(
    `insert into phone_link (user_id, phone, code_hash, code_sent_at, code_attempts)
     values ($1, $2, $3, now(), 0)
     on conflict (user_id) do update set
       phone = excluded.phone, code_hash = excluded.code_hash, code_sent_at = now(), code_attempts = 0,
       verified_at = case when phone_link.phone = excluded.phone then phone_link.verified_at end`,
    [userId, phone, hashCode(userId, code)]);
  await sendText(phone, `${code} is your Teach by Learning code. It expires in ${CODE_TTL_MIN} minutes.`);
  return null;
}

// Returns an error message string, or null once the number is verified.
export async function confirmVerification(userId, code) {
  const { rows } = await pool.query(
    `update phone_link set code_attempts = code_attempts + 1
     where user_id = $1 and code_hash is not null returning *`, [userId]);
  const link = rows[0];
  if (!link) return "Ask for a code first.";
  if (link.code_attempts > MAX_ATTEMPTS) return "Too many tries. Ask for a new code.";
  if (Date.now() - new Date(link.code_sent_at).getTime() > CODE_TTL_MIN * 60e3) return "That code has expired. Ask for a new one.";
  if (hashCode(userId, String(code).trim()) !== link.code_hash) return "That code didn't match. Check the text and try again.";

  // A number belongs to one account; verifying it here releases it elsewhere.
  await pool.query("update phone_link set verified_at = null where phone = $1 and user_id <> $2", [link.phone, userId]);
  await pool.query(
    "update phone_link set verified_at = now(), code_hash = null, code_attempts = 0 where user_id = $1", [userId]);

  const list = await commitmentsFor(userId);
  await text(link.phone,
    "You're connected! I'll text you before each commitment and check in afterward.\n\n" +
    (list.length ? `Your schedule:\n${list.map(scheduleLine).join("\n")}\n\n` : "") +
    "Reply STATUS any time to see what's left today, or PAUSE to turn reminders off.").catch(console.error);
  return null;
}

/* ---------- Inbound texts ---------- */

const scheduleLine = (c) =>
  `• ${HABITS[c.habit]?.name ?? c.habit}: ${fmtDays(c.days)} at ${fmtClock(toMinutes(c.time_local))}`;

async function commitmentsFor(userId) {
  const { rows } = await pool.query(
    "select * from habit_commitment where user_id = $1 and active order by time_local", [userId]);
  return rows;
}

const HELP = "I'm your Teach by Learning accountability bot. Reply DONE when you've finished a session, " +
  "SKIP to take today off, STATUS to see what's left today, or PAUSE to turn reminders off.";

// Words that point at a specific habit, for "skip gym" etc.
const HABIT_WORDS = { gym: /gym|lift|workout/, poetry: /poe/, reading: /read|book/, leetcode: /leet|code|problem/ };

async function status(phone, userId) {
  const list = await commitmentsFor(userId);
  if (!list.length) return text(phone, `You have no active commitments. Set one up: ${todayUrl()}`);
  const lines = [];
  for (const c of list) {
    const L = localNow(c.timezone);
    const { rowCount } = await pool.query(
      "select 1 from habit_checkin where user_id = $1 and habit = $2 and day = $3", [userId, c.habit, L.date]);
    const name = HABITS[c.habit]?.name ?? c.habit;
    if (rowCount) lines.push(`✅ ${name}: done`);
    else if (c.days.includes(L.dow)) lines.push(`⬜ ${name}: ${fmtClock(toMinutes(c.time_local))}`);
    else lines.push(`➖ ${name}: rest day`);
  }
  return text(phone, `Today:\n${lines.join("\n")}\n\nLog a session: ${todayUrl()}`);
}

// SKIP applies to the habit they named, else the one they were most recently reminded about today.
async function skip(phone, userId, msg) {
  const list = await commitmentsFor(userId);
  const named = list.filter((c) => HABIT_WORDS[c.habit]?.test(msg));
  const candidates = (named.length ? named : list.filter((c) => c.last_reminded_on === localNow(c.timezone).date))
    .sort((a, b) => toMinutes(b.time_local) - toMinutes(a.time_local));
  const c = candidates[0];
  if (!c) return text(phone, "Nothing to skip right now. Reply STATUS to see today's sessions.");
  const L = localNow(c.timezone);
  // Marking today's reminder and follow-up as sent means neither goes out.
  await pool.query(
    "update habit_commitment set last_reminded_on = $2, last_followup_on = $2 where id = $1", [c.id, L.date]);
  return text(phone, `Okay, skipping ${HABITS[c.habit]?.name ?? c.habit} today. Rest up; see you next time.`);
}

export async function handleInbound({ from, text: msg }) {
  const { rows } = await pool.query(
    "select user_id from phone_link where phone = $1 and verified_at is not null", [from]);
  const userId = rows[0]?.user_id;
  const t = msg.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").trim();

  // STOP-style words are handled by Linq/carriers (sending is blocked afterward), so we
  // just turn reminders off quietly.
  if (/^(stop|stopall|unsubscribe|cancel|end|quit)\b/.test(t)) {
    if (userId) await pool.query("update phone_link set verified_at = null where user_id = $1", [userId]);
    return;
  }
  if (!userId) {
    return text(from, "This number isn't connected to a Teach by Learning account yet. Add it from the Today page in the app.");
  }
  if (/^pause\b/.test(t)) {
    await pool.query("update phone_link set verified_at = null where user_id = $1", [userId]);
    return text(from, "Reminders are paused. Turn them back on any time from the Today page.");
  }
  if (/^status\b/.test(t)) return status(from, userId);
  if (/^skip\b/.test(t)) return skip(from, userId, t);
  if (/^(on my way|omw|heading|going)\b/.test(t)) {
    return text(from, "Let's go! Text DONE when you're finished.");
  }
  if (/^(done|did it|yes|yep|yeah|finished)\b/.test(t)) {
    return text(from, `Nice work! Log it with your proof and a few thoughts so it counts toward your streak: ${todayUrl()}`);
  }
  return text(from, HELP);
}
