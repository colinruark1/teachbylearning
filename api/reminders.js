// Reminder tick: sends due reminders and follow-ups (lib/reminders.js).
// Call it every 1–5 minutes with `Authorization: Bearer $CRON_SECRET` from a free
// external scheduler (cron-job.org, or .github/workflows/reminders.yml). Vercel's
// Hobby cron only runs once a day, which is too coarse for "30 minutes before".
import { runReminders } from "../lib/reminders.js";

export default {
  async fetch(request) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return new Response("Forbidden", { status: 403 });
    }
    const sent = await runReminders();
    return new Response(JSON.stringify(sent), { headers: { "content-type": "application/json" } });
  },
};
