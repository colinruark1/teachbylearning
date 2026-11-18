// Better Auth server config: email + password, with TOTP two-factor auth.
// Env: BETTER_AUTH_SECRET, BETTER_AUTH_URL, DATABASE_URL (Postgres).
// Create/update tables with `npm run migrate`.
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import pg from "pg";

export const auth = betterAuth({
  appName: "Teach by Learning", // shown as the issuer in authenticator apps
  database: new pg.Pool({ connectionString: process.env.DATABASE_URL }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  plugins: [twoFactor()],
});

export default auth;
