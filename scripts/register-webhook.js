// Registers the deployed inbound webhook (api/inbound.js) with the active phone provider
// (PHONE_PROVIDER, see lib/messaging/index.js). Run once per deploy URL:
//
//   BETTER_AUTH_URL=https://your-app.vercel.app npm run messaging:webhook
//
// Prints the signing secret to set in Vercel (providers usually show it only once).
try { process.loadEnvFile(".env.local"); } catch { /* use the existing environment */ }
const { phone } = await import("../lib/messaging/index.js");
const { baseURL } = await import("../lib/db.js");

if (!phone.configured()) {
  console.error(`The phone provider "${phone.id}" isn't configured. Check PHONE_PROVIDER and its env vars.`);
  process.exit(1);
}
if (!baseURL?.startsWith("https://")) {
  console.error(`Webhooks need a public https URL; BETTER_AUTH_URL is "${baseURL}".`);
  process.exit(1);
}

const hook = await phone.registerWebhook(`${baseURL}/api/inbound`);
console.log(`Registered ${baseURL}/api/inbound with ${phone.id} (id ${hook.id}).`);
if (hook.secret) console.log(`\nSet this in Vercel as ${hook.secretEnv}, then redeploy:\n\n  ${hook.secret}\n`);
