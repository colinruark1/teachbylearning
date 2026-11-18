// Subscribes the deployed webhook (api/linq.js) to inbound texts. Run once per deploy URL:
//
//   BETTER_AUTH_URL=https://your-app.vercel.app npm run linq:webhook
//
// Prints the signing secret: set it as LINQ_WEBHOOK_SECRET in Vercel (Linq shows it only once).
try { process.loadEnvFile(".env.local"); } catch { /* use the existing environment */ }
const { linq } = await import("../lib/linq.js");
const { baseURL } = await import("../lib/db.js");

if (!process.env.LINQ_API_KEY) {
  console.error("Set LINQ_API_KEY first.");
  process.exit(1);
}
if (!baseURL?.startsWith("https://")) {
  console.error(`Linq needs a public https URL; BETTER_AUTH_URL is "${baseURL}".`);
  process.exit(1);
}

const sub = await linq("/webhook-subscriptions", {
  subscribed_events: ["message.received"],
  // Pin the payload version so the shape parseInbound() expects doesn't change under us.
  target_url: `${baseURL}/api/linq?version=2026-02-03`,
});
console.log(`Subscribed ${sub.target_url} (id ${sub.id}).`);
console.log(`\nSet this in Vercel as LINQ_WEBHOOK_SECRET, then redeploy:\n\n  ${sub.signing_secret}\n`);
