// One-time setup for the active storage provider (STORAGE_PROVIDER, see lib/storage/index.js).
// For Supabase: creates the private bucket if needed, then checks upload, signed link,
// download and delete against it with a throwaway file.
//
//   npm run storage:setup
try { process.loadEnvFile(".env.local"); } catch { /* use the existing environment */ }
const { storage } = await import("../lib/storage/index.js");

if (!storage.configured()) {
  console.error(`Storage provider "${storage.id}" isn't configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example).`);
  process.exit(1);
}
console.log(`Setting up ${storage.label}…`);
try {
  for (const line of await storage.setup()) console.log(`  ${line}`);
  console.log("Done.");
} catch (e) {
  console.error(`Setup failed: ${e.message}`);
  process.exit(1);
}
