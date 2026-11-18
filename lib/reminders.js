// Sends commitment reminders and follow-ups through the phone channel (lib/messaging). Called every few minutes
// by an external cron hitting POST /api/reminders (see api/reminders.js), or by
// `npm run reminders:dev` locally.
//
// For a commitment at time T on one of its days (in the user's time zone):
//   • reminder:  from T − remind_before_min until T + 30 min, once per local day
//   • follow-up: from T + 2 h until midnight, once per local day, only if nothing is logged
// Neither is sent if the user has already logged that habit today, or tapped Skip.
// Messages carry quick-reply buttons; providers without buttons fall back to the typed
// instructions in the text ("Reply SKIP…").
import { pool } from "./db.js";
import { HABITS, localNow, toMinutes, fmtClock } from "./habits.js";
import { deliver, todayUrl, CannotDeliver } from "./bot.js";
import { beat } from "./heartbeat.js";

const LATE_GRACE_MIN = 30;     // stop sending a reminder this long after the start time
const FOLLOWUP_AFTER_MIN = 120;

// Claim a send slot atomically so overlapping cron runs can't double-send.
async function claim(column, id, date) {
  const { rowCount } = await pool.query(
    `update habit_commitment set ${column} = $2 where id = $1 and ${column} is distinct from $2`, [id, date]);
  return rowCount === 1;
}

async function loggedToday(c, date) {
  const { rowCount } = await pool.query(
    "select 1 from habit_checkin where user_id = $1 and habit = $2 and day = $3 limit 1", [c.user_id, c.habit, date]);
  return rowCount > 0;
}

export async function runReminders(now = new Date()) {
  const { rows } = await pool.query(
    `select c.*, p.phone, p.last_inbound_at from habit_commitment c
     join phone_link p on p.user_id = c.user_id
     where c.active and p.verified_at is not null`);
  const sent = { reminders: 0, followups: 0, undeliverable: 0 };

  const send = async (c, text, opts) => {
    try {
      await deliver(c, text, opts);
      return true;
    } catch (e) {
      if (e instanceof CannotDeliver) sent.undeliverable++;
      else console.error(e);
      return false;
    }
  };

  for (const c of rows) {
    const habit = HABITS[c.habit];
    if (!habit) continue;
    const L = localNow(c.timezone, now);
    if (!c.days.includes(L.dow)) continue;
    const at = toMinutes(c.time_local);

    const remindFrom = Math.max(0, at - c.remind_before_min);
    if (L.minutes >= remindFrom && L.minutes < at + LATE_GRACE_MIN && c.last_reminded_on !== L.date) {
      if (!(await loggedToday(c, L.date)) && (await claim("last_reminded_on", c.id, L.date))) {
        const ok = await send(c, `${habit.reminder(fmtClock(at))}\n\nYou said: “${c.statement}”\n\nReply SKIP to take today off.`, {
          buttons: [{ slug: `otw:${c.id}`, text: "💪 On my way" }, { slug: `skip:${c.id}`, text: "Skip today" }],
          idempotencyKey: `reminder/${c.id}/${L.date}`,
        });
        if (ok) sent.reminders++;
      }
    }

    const followAt = at + FOLLOWUP_AFTER_MIN;
    if (followAt < 24 * 60 && L.minutes >= followAt && c.last_followup_on !== L.date) {
      if (!(await loggedToday(c, L.date)) && (await claim("last_followup_on", c.id, L.date))) {
        const ok = await send(c, `${habit.followup}\n\n${todayUrl(c.habit)}`, {
          buttons: [{ slug: `done:${c.habit}`, text: "Done ✅" }, { slug: `skip:${c.id}`, text: "Skipped today" }],
          idempotencyKey: `followup/${c.id}/${L.date}`,
        });
        if (ok) sent.followups++;
      }
    }
  }
  await beat("reminders_tick", { ...sent, commitments: rows.length });
  return sent;
}
