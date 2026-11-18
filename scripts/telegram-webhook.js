// Points the Telegram bot at the deployed webhook (api/telegram.js) and registers its
// command menu. Run once per deploy URL:
//
//   BETTER_AUTH_URL=https://your-app.vercel.app npm run telegram:webhook
try { process.loadEnvFile(".env.local"); } catch { /* use the existing environment */ }
const { tg } = await import("../lib/telegram.js");
const { baseURL } = await import("../lib/db.js");

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_WEBHOOK_SECRET) {
  console.error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET first.");
  process.exit(1);
}
if (!baseURL?.startsWith("https://")) {
  console.error(`Telegram needs a public https URL; BETTER_AUTH_URL is "${baseURL}". For local dev use \`npm run bot:dev\`.`);
  process.exit(1);
}

await tg("setWebhook", {
  url: `${baseURL}/api/telegram`,
  secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
  allowed_updates: ["message", "callback_query"],
});
await tg("setMyCommands", {
  commands: [
    { command: "status", description: "What's left today" },
    { command: "stop", description: "Turn reminders off" },
  ],
});
console.log(`Webhook set to ${baseURL}/api/telegram`);
