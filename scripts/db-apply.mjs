// Applies db/schema.sql to the Postgres in DATABASE_URL (.env or env var).
// Usage: node scripts/db-apply.mjs
import { readFileSync } from 'node:fs';
import pg from 'pg';

try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // no .env — rely on real env vars
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não definido (.env ou variável de ambiente).');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(readFileSync('db/schema.sql', 'utf8'));
  const tables = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  );
  console.log('Schema aplicado. Tabelas:', tables.rows.map((r) => r.table_name).join(', '));
} finally {
  await client.end();
}
