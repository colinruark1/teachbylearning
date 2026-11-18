// Telegram bot: the free stand-in for an SMS chatbot. It sends reminders and
// follow-ups (lib/reminders.js) and answers a few messages.
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME (without the @).
//
// Users link their chat from the app: POST /api/me/telegram/link creates a one-time
// token, the user opens t.me/<bot>?start=<token>, and the bot receives "/start <token>".
import { pool, baseURL } from "./db.js";
import { HABITS, localNow, toMinutes, fmtClock, fmtDays } from "./habits.js";

export const telegramConfigured = () =>
  Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_USERNAME);

export async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const err = new Error(`Telegram ${method} failed: ${data.description || res.status}`);
    err.status = data.error_code || res.status;
    throw err;
  }
  return data.result;
}

export const todayUrl = (habit) =>
  `${baseURL || ""}/stream-platform/today.html${habit ? `?habit=${habit}` : ""}`;

// Telegram only accepts public https URLs in buttons, so in local dev (http://localhost)
// the link goes in the message text instead.
export function send(chatId, text, { link, buttons = [] } = {}) {
  const rows = [];
  if (link && link.url.startsWith("https://")) rows.push([{ text: link.label, url: link.url }]);
  else if (link) text += `\n\n${link.label}: ${link.url}`;
  if (buttons.length) rows.push(buttons);
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}),
  });
}

const scheduleLine = (c) =>
  `• ${HABITS[c.habit]?.name ?? c.habit}: ${fmtDays(c.days)} at ${fmtClock(toMinutes(c.time_local))}`;

async function commitmentsFor(userId) {
  const { rows } = await pool.query(
    "select * from habit_commitment where user_id = $1 and active order by time_local", [userId]);
  return rows;
}

async function userForChat(chatId) {
  const { rows } = await pool.query("select user_id from telegram_link where chat_id = $1", [chatId]);
  return rows[0]?.user_id ?? null;
}

const HELP =
  "I'm your Teach by Learning accountability bot. I'll nudge you before each commitment " +
  "and check in afterward.\n\n/status: what's left today\n/stop: turn reminders off";

async function linkChat(chatId, token, from) {
  const { rows } = await pool.query(
    `select user_id from telegram_link where link_token = $1 and token_expires_at > now()`, [token]);
  if (!rows[0]) {
    return send(chatId, "That link has expired. Open Teach by Learning and tap “Connect Telegram” again.");
  }
  const userId = rows[0].user_id;
  const client = await pool.connect();
  try {
    await client.query("begin");
    // A chat belongs to one account; re-linking moves it.
    await client.query("update telegram_link set chat_id = null, linked_at = null where chat_id = $1", [chatId]);
    await client.query(
      `update telegram_link set chat_id = $2, linked_at = now(), link_token = null, token_expires_at = null
       where user_id = $1`, [userId, chatId]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
  const list = await commitmentsFor(userId);
  const hi = from?.first_name ? `You're connected, ${from.first_name}!` : "You're connected!";
  return send(chatId,
    `${hi} I'll message you before each commitment and follow up afterward.\n\n` +
    (list.length ? `Your schedule:\n${list.map(scheduleLine).join("\n")}` : "You don't have any commitments yet.") +
    "\n\nSend /status any time to see what's left today.");
}

async function status(chatId) {
  const userId = await userForChat(chatId);
  if (!userId) return send(chatId, "This chat isn't linked yet. Open Teach by Learning and tap “Connect Telegram”.");
  const list = await commitmentsFor(userId);
  if (!list.length) return send(chatId, "You have no active commitments.", { link: { label: "Set one up", url: todayUrl() } });
  const lines = [];
  for (const c of list) {
    const L = localNow(c.timezone);
    const { rowCount } = await pool.query(
      "select 1 from habit_checkin where user_id = $1 and habit = $2 and day = $3", [userId, c.habit, L.date]);
    const name = HABITS[c.habit]?.name ?? c.habit;
    const at = fmtClock(toMinutes(c.time_local));
    if (rowCount) lines.push(`✅ ${name}: done`);
    else if (c.days.includes(L.dow)) lines.push(`⬜ ${name}: ${at}`);
    else lines.push(`➖ ${name}: rest day`);
  }
  return send(chatId, `Today:\n${lines.join("\n")}`, { link: { label: "Open today's log", url: todayUrl() } });
}

async function stop(chatId) {
  await pool.query("update telegram_link set chat_id = null, linked_at = null where chat_id = $1", [chatId]);
  return send(chatId, "Reminders are off. You can reconnect any time from the Today page.");
}

// Inline buttons on reminders: "otw:<commitmentId>:<date>" or "skip:<commitmentId>:<date>".
async function onButton(q) {
  const chatId = q.message?.chat?.id;
  const [action, id, date] = String(q.data || "").split(":");
  const { rows } = await pool.query(
    `select c.* from habit_commitment c join telegram_link t on t.user_id = c.user_id
     where c.id = $1 and t.chat_id = $2`, [id, chatId]);
  const c = rows[0];
  await tg("answerCallbackQuery", { callback_query_id: q.id }).catch(() => {});
  if (!c || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return;
  const name = HABITS[c.habit]?.name ?? c.habit;
  if (action === "otw") {
    return send(chatId, `Let's go. I'll check back later. Log ${name} when you're done.`,
      { link: { label: "Log it", url: todayUrl(c.habit) } });
  }
  if (action === "skip") {
    // No follow-up nag for a day they chose to skip.
    await pool.query("update habit_commitment set last_followup_on = $2 where id = $1", [c.id, date]);
    return send(chatId, `Okay, skipping ${name} today. Rest up; see you next time.`);
  }
}

export async function handleUpdate(update) {
  if (update.callback_query) return onButton(update.callback_query);
  const msg = update.message;
  if (!msg?.chat || msg.chat.type !== "private") return;
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();

  const start = text.match(/^\/start(?:\s+([\w-]+))?$/);
  if (start) return start[1] ? linkChat(chatId, start[1], msg.from) : send(chatId, HELP);
  if (/^\/?status\b/i.test(text)) return status(chatId);
  if (/^\/stop\b/i.test(text)) return stop(chatId);
  if (/^(done|did it|yes|yep|finished|✅)/i.test(text)) {
    return send(chatId, "Nice work! Log it with your proof and a few thoughts so it counts toward your streak.",
      { link: { label: "Log it", url: todayUrl() } });
  }
  return send(chatId, HELP);
}
