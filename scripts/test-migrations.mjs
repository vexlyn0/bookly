/**
 * Прогон всех миграций Bookly на локальном Postgres (PGlite) — без Supabase и сети.
 * Заглушки Supabase: роли anon/authenticated/service_role, auth.users, auth.uid(), storage (bucket и объекты).
 * Затем выполняются сценарии из scripts/sql/*.sql (assert внутри DO-блоков).
 *
 * Использование: npm run test:migrations
 */

import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase", "migrations");
const scenariosDir = path.join(root, "scripts", "sql");

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
`;

async function run(db, label, sql) {
  try {
    await db.exec(sql);
    console.log("[OK]", label);
  } catch (error) {
    console.error("[FAIL]", label, "—", error.message);
    process.exit(1);
  }
}

const db = new PGlite({ extensions: { btree_gist } });
await db.exec(SUPABASE_STUB);

const migrations = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
for (const file of migrations) {
  // pgcrypto в PGlite не нужен: gen_random_uuid() встроен в Postgres 13+
  const sql = fs
    .readFileSync(path.join(migrationsDir, file), "utf8")
    .replace(/create extension if not exists "?pgcrypto"?;/gi, "");
  await run(db, `migration ${file}`, sql);
}

// Повторный запуск последней миграции должен быть безопасным
const last = migrations[migrations.length - 1];
await run(db, `re-run ${last}`, fs.readFileSync(path.join(migrationsDir, last), "utf8"));

const scenarios = fs.existsSync(scenariosDir)
  ? fs.readdirSync(scenariosDir).filter((f) => f.endsWith(".sql")).sort()
  : [];
for (const file of scenarios) {
  await run(db, `scenarios ${file}`, fs.readFileSync(path.join(scenariosDir, file), "utf8"));
}

console.log("\nВсе миграции и сценарии прошли.");
