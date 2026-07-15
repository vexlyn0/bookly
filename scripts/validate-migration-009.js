/**
 * Валидация миграции 009 после ручного применения в Supabase.
 * Требует: DATABASE_URL (или SUPABASE_DB_URL)
 *
 * Ограничение: не применяет миграцию, только проверяет состояние БД.
 */

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });

const databaseUrl = String(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "").trim();
const migrationPath = path.join(__dirname, "..", "supabase", "migrations", "009_public_booking.sql");

function fail(msg) {
  console.error("[FAIL]", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("[OK]", msg);
}

async function main() {
  if (!databaseUrl) {
    fail("Задайте DATABASE_URL для проверки миграции 009");
  }

  if (!fs.existsSync(migrationPath)) {
    fail("Файл миграции 009 не найден");
  }

  const { Client } = require("pg");
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const { rows: slugifyTests } = await client.query(`
      select
        public.slugify_organization_base('Моя компания') as company,
        public.slugify_organization_base('Ёжик') as hedgehog,
        public.slugify_organization_base('Чай & Кофе') as cafe,
        public.slugify_organization_base('!!!') as special
    `);

    const pattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (const [label, value] of Object.entries(slugifyTests[0])) {
      if (!value || !pattern.test(value) || value.length < 3 || value.length > 60) {
        fail(`slugify '${label}' -> '${value}' невалиден`);
      }
    }
    ok("slugify_organization_base возвращает валидные slug");

    const { rows: dupSlugs } = await client.query(`
      select slug, count(*)::int as cnt
      from public.organizations
      group by slug
      having count(*) > 1
    `);
    if (dupSlugs.length) {
      fail(`Найдены дубли slug: ${dupSlugs.map((r) => r.slug).join(", ")}`);
    }
    ok("Все slug организаций уникальны");

    const { rows: invalidSlugs } = await client.query(`
      select id, slug
      from public.organizations
      where slug is null
         or slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
         or length(slug) < 3
         or length(slug) > 60
      limit 5
    `);
    if (invalidSlugs.length) {
      fail(`Некорректные slug после миграции: ${invalidSlugs.map((r) => r.slug).join(", ")}`);
    }
    ok("Все slug соответствуют формату 3–60");

    const { rows: publicNameRows } = await client.query(`
      select count(*)::int as cnt
      from public.organizations
      where public_name is not null and char_length(trim(public_name)) < 2
    `);
    if (publicNameRows[0].cnt > 0) {
      fail("Есть организации с пустым public_name после backfill");
    }
    ok("public_name backfill: нет пустых значений");

    const { rows: defaultRows } = await client.query(`
      select column_default
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'organizations'
        and column_name = 'public_booking_enabled'
    `);
    const defaultValue = String(defaultRows[0]?.column_default || "");
    if (!defaultValue.includes("false")) {
      fail(`public_booking_enabled default не false: ${defaultValue}`);
    }
    ok("public_booking_enabled default = false");

    const { rows: anonPolicies } = await client.query(`
      select tablename, policyname, cmd
      from pg_policies
      where schemaname = 'public'
        and tablename in ('organizations', 'services', 'staff', 'bookings')
        and 'anon' = any (roles)
    `);
    if (anonPolicies.length) {
      fail(`Найдены anon-политики: ${anonPolicies.map((r) => `${r.tablename}.${r.policyname}`).join(", ")}`);
    }
    ok("Нет anon-политик на приватных таблицах");

    const { rows: refIndex } = await client.query(`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'bookings'
        and indexname = 'bookings_public_reference_unique'
    `);
    if (!refIndex.length) {
      fail("Индекс bookings_public_reference_unique не найден");
    }
    ok("Уникальный partial index public_reference существует");

    const { rows: triggers } = await client.query(`
      select tgname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'bookings'
        and not t.tgisinternal
        and tgname in ('bookings_assign_public_reference', 'bookings_protect_public_reference')
    `);
    if (triggers.length < 2) {
      fail("Триггеры public_reference не найдены");
    }
    ok("Триггеры public_reference установлены");

    const { rows: grants } = await client.query(`
      select
        has_function_privilege('anon', 'public.generate_booking_public_reference()', 'EXECUTE') as anon_ref,
        has_function_privilege('authenticated', 'public.generate_booking_public_reference()', 'EXECUTE') as auth_ref,
        has_function_privilege('anon', 'public.generate_unique_organization_slug(text, uuid)', 'EXECUTE') as anon_slug,
        has_function_privilege('authenticated', 'public.generate_unique_organization_slug(text, uuid)', 'EXECUTE') as auth_slug
    `);
    const g = grants[0];
    if (g.anon_ref || g.auth_ref || g.anon_slug || g.auth_slug) {
      fail("Лишние EXECUTE на генераторах slug/reference для anon/authenticated");
    }
    ok("Генераторы slug/reference не доступны anon/authenticated");

    const refPattern = /^BK-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
    const { rows: badRefs } = await client.query(`
      select public_reference
      from public.bookings
      where public_reference is not null
        and public_reference !~ '^BK-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'
      limit 5
    `);
    if (badRefs.length) {
      fail(`Некорректный формат public_reference: ${badRefs.map((r) => r.public_reference).join(", ")}`);
    }
    ok("Существующие public_reference соответствуют формату BK-XXXXXX");

    console.log("\nВалидация миграции 009 завершена успешно.");
    console.log("Файл для применения (если ещё не применён): supabase/migrations/009_public_booking.sql");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
