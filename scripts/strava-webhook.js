// Subscribes the deployed /api/strava/webhook to Strava events (one subscription per app).
// Strava then tells us when an athlete revokes access, so we delete their tokens.
//
//   BETTER_AUTH_URL=https://your-app.vercel.app npm run strava:webhook
//
// Needs STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET and STRAVA_VERIFY_TOKEN, and the deployed app
// must already have the same STRAVA_VERIFY_TOKEN (Strava calls it back during this request).
try { process.loadEnvFile(".env.local"); } catch { /* use the existing environment */ }
const strava = await import("../lib/strava.js");
const { baseURL } = await import("../lib/db.js");

if (!strava.configured() || !process.env.STRAVA_VERIFY_TOKEN) {
  console.error("Set STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET and STRAVA_VERIFY_TOKEN first.");
  process.exit(1);
}
if (!baseURL?.startsWith("https://")) {
  console.error(`Strava webhooks need a public https URL; BETTER_AUTH_URL is "${baseURL}".`);
  process.exit(1);
}

try {
  const sub = await strava.registerWebhook(`${baseURL}/api/strava/webhook`);
  console.log(`Subscribed ${baseURL}/api/strava/webhook (subscription id ${sub.id}).`);
  console.log(`\nSet this in Vercel, then redeploy:\n\n  STRAVA_SUBSCRIPTION_ID=${sub.id}\n`);
} catch (e) {
  console.error(`Strava refused the subscription: ${e.message}`);
  console.error("If it says one already exists, view it with:\n  curl -G https://www.strava.com/api/v3/push_subscriptions -d client_id=$STRAVA_CLIENT_ID -d client_secret=$STRAVA_CLIENT_SECRET");
  process.exit(1);
}
