import fs from "node:fs/promises";
import path from "node:path";
import pool from "./index";

export async function migrate(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const migrationsDir = path.resolve(__dirname, "../../db/migrations");
    let files: string[] = [];
    try {
      files = await fs.readdir(migrationsDir);
    } catch {
      console.warn(`Migrations directory not found at ${migrationsDir}`);
      return;
    }

    const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();

    const res = await client.query("SELECT filename FROM schema_migrations");
    const applied = new Set<string>(res.rows.map((r: { filename: string }) => r.filename));

    for (const file of sqlFiles) {
      if (applied.has(file)) {
        continue;
      }

      console.log(`Applying migration: ${file}`);
      const filePath = path.join(migrationsDir, file);
      const sql = await fs.readFile(filePath, "utf-8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, NOW())",
          [file],
        );
        await client.query("COMMIT");
        console.log(`Successfully applied migration: ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`Failed to apply migration ${file}:`, err);
        throw err;
      }
    }
  } finally {
    client.release();
  }
}
