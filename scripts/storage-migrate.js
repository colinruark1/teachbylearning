// Copies check-in photos stored by any other provider (including old rows stored inline in
// Postgres) to the active storage provider, then updates each row. Safe to re-run: rows
// already on the active provider are skipped. Old files are removed after each row is moved.
//
//   npm run storage:migrate            (add -- --dry-run to only count)
try { process.loadEnvFile(".env.local"); } catch { /* use the existing environment */ }
const { storage } = await import("../lib/storage/index.js");
const { pool } = await import("../lib/db.js");

const dryRun = process.argv.includes("--dry-run");
const target = storage.id;
const pending = `proof_type = 'photo' and coalesce(proof_storage, 'postgres') <> $1`;

try {
  const { rows: [{ n }] } = await pool.query(`select count(*)::int as n from habit_checkin where ${pending}`, [target]);
  console.log(`${n} photo(s) to move to ${storage.label}.`);
  if (dryRun || !n) process.exit(0);

  let moved = 0, failed = 0;
  for (;;) {
    const { rows } = await pool.query(
      `select id, user_id, proof, proof_storage from habit_checkin where ${pending} order by id limit 20`, [target]);
    if (!rows.length) break;
    for (const r of rows) {
      try {
        const file = await storage.open(r.proof_storage, r.proof);
        const bytes = file.bytes ?? Buffer.from(await (await fetch(file.redirect)).arrayBuffer());
        const ref = await storage.put(`proof/${r.user_id}/migrated-${r.id}.jpg`, bytes, "image/jpeg");
        await pool.query("update habit_checkin set proof = $2, proof_storage = $3 where id = $1", [r.id, ref, target]);
        await storage.remove(r.proof_storage, [r.proof]).catch(() => {});
        moved++;
      } catch (e) {
        failed++;
        console.error(`  check-in ${r.id}: ${e.message}`);
        // Mark nothing; stop rather than loop forever on the same failing rows.
        if (failed >= 5) throw new Error("Too many failures; stopping.");
      }
    }
    process.stdout.write(`\r  moved ${moved}`);
  }
  console.log(`\nDone: ${moved} moved, ${failed} failed.`);
} finally {
  await pool.end();
}
