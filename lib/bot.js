// The accountability bot: phone verification, sending reminders, and replies to inbound
// messages and button taps. Provider-neutral: everything goes through lib/messaging, so
// the channel (WhatsApp, SMS, …) can be swapped there.
//
// Channel rules (e.g. WhatsApp's 24-hour reply window) are handled by the provider; we
// pass along when the user last messaged us (phone_link.last_inbound_at).
import { pool, baseURL } from "./db.js";
import { HABITS, localNow, toMinutes, fmtClock, fmtDays } from "./habits.js";
import { phone as channel, CannotDeliver, VerificationFailed } from "./messaging/index.js";

export { CannotDeliver };

export const todayUrl = (habit) =>
  `${baseURL || ""}/stream-platform/today.html${habit ? `?habit=${habit}` : ""}`;

export const windowOpen = (lastInboundAt) => channel.replyWindowOpen(lastInboundAt);

// Sends `text` to a phone_link row ({ phone, last_inbound_at }). Returns "message" or
// "template". Throws CannotDeliver when the channel's rules forbid it right now.
export const deliver = (link, text, { buttons, idempotencyKey } = {}) =>
  channel.send(link.phone, text, { buttons, idempotencyKey, lastInboundAt: link.last_inbound_at });

// Reply to something the user just sent (so any reply window is open).
const reply = (to, text, opts = {}) => channel.send(to, text, { ...opts, lastInboundAt: new Date() });

/* ---------- Verification (the provider sends and checks the code) ---------- */

const RESEND_AFTER_SEC = 45;

// Returns an error message string, or null once the code is on its way.
export async function startVerification(userId, phone) {
  const { rows } = await pool.query(
    `select 1 from phone_link where phone = $1 and verified_at is not null and user_id <> $2`, [phone, userId]);
  if (rows[0]) return "That number is already connected to another account.";
  const { rows: recent } = await pool.query(
    `select 1 from phone_link where user_id = $1 and phone = $2 and verify_pending
       and code_sent_at > now() - make_interval(secs => $3)`, [userId, phone, RESEND_AFTER_SEC]);
  if (recent[0]) return "We just sent a code. Give it a moment before asking for another.";

  try {
    await channel.startVerification(phone);
  } catch (e) {
    if (e instanceof VerificationFailed) return e.message;
    throw e;
  }
  await pool.query(
    `insert into phone_link (user_id, phone, code_sent_at, verify_pending)
     values ($1, $2, now(), true)
     on conflict (user_id) do update set
       phone = excluded.phone, code_sent_at = now(), verify_pending = true,
       verified_at = case when phone_link.phone = excluded.phone then phone_link.verified_at end,
       last_inbound_at = case when phone_link.phone = excluded.phone then phone_link.last_inbound_at end`,
    [userId, phone]);
  return null;
}

// Returns an error message string, or null once the number is verified.
export async function confirmVerification(userId, code) {
  const { rows } = await pool.query(
    "select phone from phone_link where user_id = $1 and verify_pending", [userId]);
  if (!rows[0]) return "Ask for a code first.";
  const { phone } = rows[0];

  const r = await channel.checkVerification(phone, code);
  if (!r.success) {
    if (r.reason === "incorrect_code") {
      return `That code didn't match.${r.attemptsRemaining != null ? ` ${r.attemptsRemaining} tries left.` : ""}`;
    }
    if (r.reason === "attempts_exhausted") return "Too many tries. Ask for a new code.";
    return "That code has expired. Ask for a new one.";
  }

  // A number belongs to one account; verifying it here releases it elsewhere.
  await pool.query("update phone_link set verified_at = null where phone = $1 and user_id <> $2", [phone, userId]);
  await pool.query(
    "update phone_link set verified_at = now(), verify_pending = false where user_id = $1", [userId]);

  // Welcome message: only possible if they've messaged us recently or a template is set.
  const { rows: link } = await pool.query("select * from phone_link where user_id = $1", [userId]);
  try {
    await deliver(link[0], await welcomeText(userId));
  } catch (e) {
    if (!(e instanceof CannotDeliver)) console.error(e);
  }
  return null;
}

/* ---------- Inbound ---------- */

const scheduleLine = (c) =>
  `• ${HABITS[c.habit]?.name ?? c.habit}: ${fmtDays(c.days)} at ${fmtClock(toMinutes(c.time_local))}`;

async function commitmentsFor(userId) {
  const { rows } = await pool.query(
    "select * from habit_commitment where user_id = $1 and active order by time_local", [userId]);
  return rows;
}

async function welcomeText(userId) {
  const list = await commitmentsFor(userId);
  return "You're connected to Teach by Learning! I'll message you before each commitment and check in afterward.\n\n" +
    (list.length ? `Your schedule:\n${list.map(scheduleLine).join("\n")}\n\n` : "") +
    "Reply STATUS any time to see what's left today, or PAUSE to turn reminders off.";
}

const HELP = "I'm your Teach by Learning accountability bot. Reply DONE when you've finished a session, " +
  "SKIP to take today off, STATUS to see what's left today, or PAUSE to turn reminders off.";

// Words that point at a specific habit, for "skip gym" etc.
const HABIT_WORDS = { gym: /gym|lift|workout/, poetry: /poe/, reading: /read|book/, leetcode: /leet|code|problem/ };

async function status(phone, userId) {
  const list = await commitmentsFor(userId);
  if (!list.length) return reply(phone, `You have no active commitments. Set one up: ${todayUrl()}`);
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
  return reply(phone, `Today:\n${lines.join("\n")}\n\nLog a session: ${todayUrl()}`);
}

// SKIP applies to a specific commitment (button tap), the habit they named, or else the one
// they were most recently reminded about today.
async function skip(phone, userId, msg, commitmentId) {
  const list = await commitmentsFor(userId);
  let c = commitmentId ? list.find((x) => String(x.id) === commitmentId) : null;
  if (!c) {
    const named = list.filter((x) => HABIT_WORDS[x.habit]?.test(msg));
    c = (named.length ? named : list.filter((x) => x.last_reminded_on === localNow(x.timezone).date))
      .sort((a, b) => toMinutes(b.time_local) - toMinutes(a.time_local))[0];
  }
  if (!c) return reply(phone, "Nothing to skip right now. Reply STATUS to see today's sessions.");
  const L = localNow(c.timezone);
  // Marking today's reminder and follow-up as sent means neither goes out.
  await pool.query(
    "update habit_commitment set last_reminded_on = $2, last_followup_on = $2 where id = $1", [c.id, L.date]);
  return reply(phone, `Okay, skipping ${HABITS[c.habit]?.name ?? c.habit} today. Rest up; see you next time.`);
}

const done = (phone, habit) => reply(phone,
  `Nice work! Log it with your proof and a few thoughts so it counts toward your streak: ${todayUrl(habit)}`);

// msg: { from, text, button } from parseInbound(). Button slugs are set in lib/reminders.js:
// "otw:<commitmentId>", "skip:<commitmentId>", "done:<habit>".
export async function handleInbound({ from, text, button }) {
  // Any message from them opens a fresh 24-hour window for free-form replies.
  await pool.query("update phone_link set last_inbound_at = now() where phone = $1", [from]);
  const { rows } = await pool.query(
    "select user_id from phone_link where phone = $1 and verified_at is not null", [from]);
  const userId = rows[0]?.user_id;
  const t = String(text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").trim();

  if (/^(stop|unsubscribe|pause)\b/.test(t)) {
    if (userId) await pool.query("update phone_link set verified_at = null where user_id = $1", [userId]);
    return reply(from, "Reminders are paused. Turn them back on any time from the Today page.");
  }
  if (!userId) {
    return reply(from, "Hi! This number isn't connected to a Teach by Learning account yet. " +
      "Add it from the Today page in the app, then you'll get your reminders here.");
  }

  const [action, arg] = String(button || "").split(":");
  if (action === "otw") return reply(from, "Let's go! Tap Done or reply DONE when you're finished.", {
    buttons: [{ slug: `done:${(await commitmentsFor(userId)).find((c) => String(c.id) === arg)?.habit ?? ""}`, text: "Done ✅" }],
  });
  if (action === "skip") return skip(from, userId, t, arg);
  if (action === "done") return done(from, arg || undefined);

  if (/^status\b/.test(t)) return status(from, userId);
  if (/^skip\b/.test(t)) return skip(from, userId, t);
  if (/^(on my way|omw|heading|going)\b/.test(t)) return reply(from, "Let's go! Reply DONE when you're finished.");
  if (/^(done|did it|yes|yep|yeah|finished)\b/.test(t)) return done(from);
  if (/^(hi|hello|hey|start|join)\b/.test(t)) return reply(from, await welcomeText(userId));
  return reply(from, HELP);
}
