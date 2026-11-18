// Local stand-in for the Telegram webhook + reminder cron, for use alongside `vercel dev`
// (Telegram can't reach localhost). Long-polls the bot for messages and runs the
// reminder tick every minute. Use a separate dev bot: polling removes the bot's webhook.
//
//   npm run bot:dev
try { process.loadEnvFile(".env.local"); } catch { /* use the existing environment */ }
const { tg, handleUpdate, telegramConfigured } = await import("../lib/telegram.js");
const { runReminders } = await import("../lib/reminders.js");

if (!telegramConfigured()) {
  console.error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME in .env.local first.");
  process.exit(1);
}

await tg("deleteWebhook", {});
console.log(`Polling @${process.env.TELEGRAM_BOT_USERNAME}. Ctrl+C to stop.`);

const tick = async () => {
  try {
    const sent = await runReminders();
    if (sent.reminders || sent.followups) console.log(new Date().toLocaleTimeString(), "sent", sent);
  } catch (e) { console.error("reminders:", e.message); }
};
tick();
setInterval(tick, 60_000);

let offset = 0;
for (;;) {
  try {
    const updates = await tg("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] });
    for (const u of updates) {
      offset = u.update_id + 1;
      await handleUpdate(u).catch((e) => console.error("update:", e.message));
    }
  } catch (e) {
    console.error("poll:", e.message);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
