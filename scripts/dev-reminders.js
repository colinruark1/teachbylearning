// Local stand-in for the reminder cron, for use alongside `vercel dev`: runs the reminder
// tick every minute. Set LINQ_DRY_RUN=1 to print texts here instead of sending them.
// (Inbound texts need a public https URL for the Linq webhook, e.g. via a tunnel.)
//
//   npm run reminders:dev
try { process.loadEnvFile(".env.local"); } catch { /* use the existing environment */ }
const { linqConfigured } = await import("../lib/linq.js");
const { runReminders } = await import("../lib/reminders.js");

if (!linqConfigured()) {
  console.error("Set LINQ_API_KEY (or LINQ_DRY_RUN=1) in .env.local first.");
  process.exit(1);
}
console.log(`Checking reminders every minute${process.env.LINQ_DRY_RUN ? " (dry run)" : ""}. Ctrl+C to stop.`);

const tick = async () => {
  try {
    const sent = await runReminders();
    if (sent.reminders || sent.followups) console.log(new Date().toLocaleTimeString(), "sent", sent);
  } catch (e) { console.error("reminders:", e.message); }
};
tick();
setInterval(tick, 60_000);
