// Local stand-in for the reminder cron, for use alongside `vercel dev`: runs the reminder
// tick every minute. Set PHONE_PROVIDER=log to print messages here instead of sending them.
// (Real providers deliver replies to a public https webhook, e.g. via a tunnel.)
//
//   npm run reminders:dev
try { process.loadEnvFile(".env.local"); } catch { /* use the existing environment */ }
const { phone } = await import("../lib/messaging/index.js");
const { runReminders } = await import("../lib/reminders.js");

if (!phone.configured()) {
  console.error(`The phone provider "${phone.id}" isn't configured. Set PHONE_PROVIDER (e.g. log) in .env.local first.`);
  process.exit(1);
}
console.log(`Checking reminders every minute${phone.id === "log" ? " (log only)" : ` via ${phone.id}`}. Ctrl+C to stop.`);

const tick = async () => {
  try {
    const sent = await runReminders();
    if (sent.reminders || sent.followups) console.log(new Date().toLocaleTimeString(), "sent", sent);
  } catch (e) { console.error("reminders:", e.message); }
};
tick();
setInterval(tick, 60_000);
