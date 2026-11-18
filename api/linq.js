// Linq webhook: inbound texts (message.received). Register it with `npm run linq:webhook`,
// which prints the signing secret to set as LINQ_WEBHOOK_SECRET.
import { pool } from "../lib/db.js";
import { verifyWebhook, parseInbound } from "../lib/linq.js";
import { handleInbound } from "../lib/sms.js";
import { beat } from "../lib/heartbeat.js";

export default {
  async fetch(request) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const raw = await request.text();
    if (!verifyWebhook(request.headers, raw)) {
      await beat("linq_webhook_bad_signature", {});
      return new Response("Invalid signature", { status: 401 });
    }

    await beat("linq_webhook", {});
    let event;
    try { event = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }
    const msg = parseInbound(event);
    if (!msg.inbound || !msg.from || !msg.text) return new Response("ignored");

    // Deliveries are at-least-once; handle each event id once.
    if (msg.eventId) {
      const { rowCount } = await pool.query(
        "insert into webhook_event (id) values ($1) on conflict do nothing", [msg.eventId]);
      if (!rowCount) return new Response("duplicate");
      pool.query("delete from webhook_event where received_at < now() - interval '7 days'").catch(() => {});
    }
    try {
      await handleInbound(msg);
    } catch (e) {
      // Still answer 200: Linq would retry, and we've already recorded the event.
      console.error(e);
    }
    return new Response("ok");
  },
};
