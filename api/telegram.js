// Telegram webhook. Point the bot here with `npm run telegram:webhook`.
// Env: TELEGRAM_WEBHOOK_SECRET (Telegram echoes it in a header so we know the call is real).
import { handleUpdate } from "../lib/telegram.js";

export default {
  async fetch(request) {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (request.method !== "POST" || !secret
        || request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      await handleUpdate(await request.json());
    } catch (e) {
      // Still answer 200: a non-2xx makes Telegram retry the same update over and over.
      console.error(e);
    }
    return new Response("ok");
  },
};
