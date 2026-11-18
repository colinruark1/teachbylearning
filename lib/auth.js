// Better Auth server config: email + password, with TOTP two-factor auth.
// Env: BETTER_AUTH_SECRET, BETTER_AUTH_URL, DATABASE_URL (Postgres).
// Create/update tables with `npm run migrate`.
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import pg from "pg";

// Better Auth needs a full origin like "https://example.com". Accept a bare host too
// (an easy mistake in the Vercel env settings), and fall back to Vercel's own URLs.
const rawBaseURL = process.env.BETTER_AUTH_URL
  || process.env.VERCEL_PROJECT_PRODUCTION_URL
  || process.env.VERCEL_URL;
const baseURL = rawBaseURL && !/^https?:\/\//i.test(rawBaseURL)
  ? `https://${rawBaseURL.replace(/\/+$/, "")}`
  : rawBaseURL;

export const auth = betterAuth({
  appName: "Teach by Learning", // shown as the issuer in authenticator apps
  baseURL,
  database: new pg.Pool({ connectionString: process.env.DATABASE_URL }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  plugins: [twoFactor()],
});

export default auth;
