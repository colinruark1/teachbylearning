// Sends commitment reminders and follow-ups. Called every few minutes by an external
// cron hitting POST /api/reminders (see api/reminders.js), or by `npm run bot:dev`.
//
// For a commitment at time T on one of its days (in the user's time zone):
//   • reminder:  from T − remind_before_min until T + 30 min, once per local day
//   • follow-up: from T + 2 h until midnight, once per local day, only if nothing is logged
// Neither is sent if the user has already logged that habit today.
import { pool } from "./db.js";
import { HABITS, localNow, toMinutes, fmtClock } from "./habits.js";
import { send, todayUrl } from "./telegram.js";

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

// Telegram returns 403 when the user blocked the bot; stop messaging that chat.
async function deliver(c, text, opts) {
  try {
    await send(c.chat_id, text, opts);
    return true;
  } catch (e) {
    if (e.status === 403) await pool.query("update telegram_link set chat_id = null where chat_id = $1", [c.chat_id]);
    else console.error(e);
    return false;
  }
}

export async function runReminders(now = new Date()) {
  const { rows } = await pool.query(
    `select c.*, t.chat_id from habit_commitment c
     join telegram_link t on t.user_id = c.user_id
     where c.active and t.chat_id is not null`);
  const sent = { reminders: 0, followups: 0 };

  for (const c of rows) {
    const habit = HABITS[c.habit];
    if (!habit) continue;
    const L = localNow(c.timezone, now);
    if (!c.days.includes(L.dow)) continue;
    const at = toMinutes(c.time_local);

    const remindFrom = Math.max(0, at - c.remind_before_min);
    if (L.minutes >= remindFrom && L.minutes < at + LATE_GRACE_MIN && c.last_reminded_on !== L.date) {
      if (!(await loggedToday(c, L.date)) && (await claim("last_reminded_on", c.id, L.date))) {
        const ok = await deliver(c, `${habit.reminder(fmtClock(at))}\n\nYou said: “${c.statement}”`, {
          buttons: [
            { text: "💪 On my way", callback_data: `otw:${c.id}:${L.date}` },
            { text: "Skip today", callback_data: `skip:${c.id}:${L.date}` },
          ],
        });
        if (ok) sent.reminders++;
      }
    }

    const followAt = at + FOLLOWUP_AFTER_MIN;
    if (followAt < 24 * 60 && L.minutes >= followAt && c.last_followup_on !== L.date) {
      if (!(await loggedToday(c, L.date)) && (await claim("last_followup_on", c.id, L.date))) {
        const ok = await deliver(c, habit.followup, { link: { label: "Log it now", url: todayUrl(c.habit) } });
        if (ok) sent.followups++;
      }
    }
  }
  return sent;
}
