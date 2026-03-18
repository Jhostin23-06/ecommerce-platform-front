#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "migrations");
const rootEnvPath = join(__dirname, "..", "..", "..", ".env");

loadDotEnv(rootEnvPath);

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://ecom_user:ecom_pass@localhost:5433/ecommerce_dev";
const statusOnly = process.argv.includes("--status");
const isProduction = (process.env.NODE_ENV ?? "development").toLowerCase() === "production";

if (isProduction && !process.env.DATABASE_URL) {
  console.error("[migrations] Failed: DATABASE_URL is required in production.");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
});

const MIGRATIONS_TABLE = "schema_migrations";

async function main() {
  console.log(`[migrations] DB: ${redactDatabaseUrl(databaseUrl)}`);
  await ensureMigrationsTable();

  const files = (await readdir(migrationsDir))
    .filter((name) => /^\d+.*\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  if (!files.length) {
    console.log("[migrations] No SQL files found.");
    return;
  }

  const applied = await getAppliedVersions();

  if (statusOnly) {
    for (const file of files) {
      const appliedMark = applied.has(file) ? "applied" : "pending";
      console.log(`${appliedMark.padEnd(7)} ${file}`);
    }
    return;
  }

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[migrations] Skip ${file} (already applied).`);
      continue;
    }

    const sql = await readFile(join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO ${MIGRATIONS_TABLE}(version) VALUES ($1)`, [file]);
      await client.query("COMMIT");
      console.log(`[migrations] Applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      version varchar(255) NOT NULL UNIQUE,
      applied_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedVersions() {
  const result = await pool.query(`SELECT version FROM ${MIGRATIONS_TABLE}`);
  return new Set(result.rows.map((row) => row.version));
}

function loadDotEnv(envPath) {
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function redactDatabaseUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "*****";
    }
    return parsed.toString();
  } catch {
    return "DATABASE_URL";
  }
}

main()
  .catch((error) => {
    console.error("[migrations] Failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
