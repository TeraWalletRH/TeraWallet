import { Pool } from "pg";
import { env } from "../env";

// In unit tests, avoid remote database latency/timeouts by defaulting to fast in-memory store
// unless TEST_DB=true is explicitly set. In development and production, connect to real PostgreSQL.
const dbUrl = env.databaseUrl || process.env.DATABASE_URL || "";
const shouldUseDb =
  Boolean(dbUrl) &&
  (process.env.NODE_ENV !== "test" || process.env.TEST_DB === "true");

export const pool: Pool | null = shouldUseDb
  ? new Pool({ connectionString: dbUrl })
  : null;

export default pool;
