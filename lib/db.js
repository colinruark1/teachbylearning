// Shared Postgres pool (Better Auth tables + the habit tables in lib/schema.sql).
import pg from "pg";

// Return DATE columns as "YYYY-MM-DD" strings. The default parser turns them into
// JS Dates at local midnight, which shifts days across time zones.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Public origin of the site, e.g. "https://your-app.vercel.app". Better Auth needs a
// full origin. Accept a bare host too (an easy mistake in the Vercel env settings).
const origin = (raw) => raw && (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, "");

// On Vercel preview deploys (any non-production branch), use the branch's own URL
// (app-git-<branch>-<team>.vercel.app), so BETTER_AUTH_URL set to the production
// domain for every environment doesn't break login on branches. PREVIEW_BASE_URL
// overrides this, e.g. for a custom preview domain.
const preview = process.env.VERCEL_ENV === "preview";
export const baseURL = origin(
  (preview && (process.env.PREVIEW_BASE_URL || process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL))
  || process.env.BETTER_AUTH_URL
  || process.env.VERCEL_PROJECT_PRODUCTION_URL
  || process.env.VERCEL_URL,
);

// Every origin this deployment can be reached at: the per-deploy URL
// (app-<hash>-<team>.vercel.app), the branch URL and production. Better Auth rejects
// requests from origins that aren't listed here.
export const trustedOrigins = [...new Set([
  baseURL,
  origin(process.env.VERCEL_URL),
  origin(process.env.VERCEL_BRANCH_URL),
  ...(preview ? [] : [origin(process.env.VERCEL_PROJECT_PRODUCTION_URL)]),
].filter(Boolean))];
