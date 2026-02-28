// =============================================================
// lib/db.ts — Neon Serverless PostgreSQL Connection
// =============================================================
//
// Uses @neondatabase/serverless which is optimized for edge/serverless
// environments like Vercel. Each API route invocation gets a lightweight
// connection via HTTP, no persistent pool needed.
//
// Usage:
//   import { sql } from '@/lib/db';
//   const result = await sql`SELECT * FROM sessions WHERE id = ${id}`;
//
// =============================================================

import { neon } from '@neondatabase/serverless';

// Validate environment variable at import time
if (!process.env.NEON_DATABASE_URL) {
  throw new Error(
    '[DB] NEON_DATABASE_URL is not set. Check your .env file.'
  );
}

// Create the SQL tagged template function
// This is safe to call on every request — neon() is stateless and
// creates a new HTTP connection per query (ideal for serverless).
const sql = neon(process.env.NEON_DATABASE_URL);

export { sql };
