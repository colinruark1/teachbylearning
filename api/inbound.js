// Incoming phone messages (replies, button taps) from whichever phone provider is active
// (lib/messaging). The provider verifies the request and parses it. Register this URL with
// `npm run messaging:webhook`.
import { pool } from "../lib/db.js";
import { phone, InvalidSignature } from "../lib/messaging/index.js";
import { handleInbound } from "../lib/bot.js";
import { beat } from "../lib/heartbeat.js";

export default {
  async fetch(request) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    let msg;
    try {
      msg = await phone.inbound(request);
    } catch (e) {
      if (!(e instanceof InvalidSignature)) throw e;
      await beat("phone_inbound_bad_signature", {});
      return new Response("Invalid signature", { status: 401 });
    }
    await beat("phone_inbound", {});
    if (!msg || !msg.from || (!msg.text && !msg.button)) return new Response("ignored");

    // Webhooks are delivered at least once; handle each message id once.
    if (msg.id) {
      const { rowCount } = await pool.query(
        "insert into webhook_event (id) values ($1) on conflict do nothing", [msg.id]);
      if (!rowCount) return new Response("duplicate");
      await pool.query("delete from webhook_event where received_at < now() - interval '7 days'").catch(() => {});
    }
    try {
      await handleInbound(msg);
    } catch (e) {
      // Still answer 200: the provider would retry, and we've already recorded the event.
      console.error(e);
    }
    return new Response("ok");
  },
};
