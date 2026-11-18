// Shared Postgres pool (Better Auth tables + the habit tables in lib/schema.sql).
import pg from "pg";

// Return DATE columns as "YYYY-MM-DD" strings. The default parser turns them into
// JS Dates at local midnight, which shifts days across time zones.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Public origin of the site, e.g. "https://your-app.vercel.app". Better Auth needs a
// full origin. Accept a bare host too (an easy mistake in the Vercel env settings),
// and fall back to Vercel's own URLs.
const rawBaseURL = process.env.BETTER_AUTH_URL
  || process.env.VERCEL_PROJECT_PRODUCTION_URL
  || process.env.VERCEL_URL;
export const baseURL = rawBaseURL && !/^https?:\/\//i.test(rawBaseURL)
  ? `https://${rawBaseURL.replace(/\/+$/, "")}`
  : rawBaseURL?.replace(/\/+$/, "");
