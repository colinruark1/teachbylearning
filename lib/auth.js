// Better Auth server config: email + password, with TOTP two-factor auth.
// Env: BETTER_AUTH_SECRET, BETTER_AUTH_URL, DATABASE_URL (Postgres).
// Create/update tables with `npm run migrate`.
import { betterAuth } from "better-auth";
import { twoFactor, customSession } from "better-auth/plugins";
import { pool, baseURL, trustedOrigins } from "./db.js";
import { isAdmin } from "./admin.js";

export const auth = betterAuth({
  appName: "Teach by Learning", // shown as the issuer in authenticator apps
  baseURL,
  trustedOrigins,
  database: pool,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  user: {
    additionalFields: {
      // Set by POST /api/me/onboarding. Until then, auth-guard.js sends the user to
      // the onboarding flow instead of the app. Clients can't write it directly.
      onboardedAt: { type: "date", required: false, input: false },
    },
  },
  plugins: [
    twoFactor(),
    // Adds user.isAdmin to every session response (see lib/admin.js); auth-guard.js uses it
    // to show the admin controls. The admin API checks it again on the server.
    customSession(async ({ user, session }) => ({ user: { ...user, isAdmin: isAdmin(user) }, session })),
  ],
});

export default auth;
