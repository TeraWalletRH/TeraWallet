import { Pool } from "pg";

// In unit tests, avoid remote database latency/timeouts by defaulting to fast in-memory store
// unless TEST_DB=true is explicitly set. In development and production, connect to real PostgreSQL.
const shouldUseDb =
  Boolean(process.env.DATABASE_URL) &&
  (process.env.NODE_ENV !== "test" || process.env.TEST_DB === "true");

export const pool: Pool | null = shouldUseDb
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

export default pool;
