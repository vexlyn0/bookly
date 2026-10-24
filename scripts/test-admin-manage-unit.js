/**
 * Unit-тесты управления салоном из админ-панели (без Supabase и сети)
 * Использование: npm run test:admin-manage-unit
 */

const assert = require("assert");

// --- Подмена Supabase ---------------------------------------------------------

const tables = {};
const calls = [];
const authCalls = [];
let updateError = null;

function fakeSupabase() {
  return {
    from(table) {
      const filters = [];
      let single = false;
      let patch = null;
      let insertRow = null;
      let remove = false;
      const builder = {
        select: () => builder,
        order: () => builder,
        limit: () => builder,
        eq(column, value) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        neq(column, value) {
          filters.push((row) => row[column] !== value);
          return builder;
        },
        update(payload) {
          patch = payload;
          return builder;
        },
        insert(row) {
          insertRow = row;
          return builder;
        },
        delete() {
          remove = true;
          return builder;
        },
        maybeSingle() {
          single = true;
          return builder;
        },
        single() {
          single = true;
          return builder;
        },
        then(resolve, reject) {
          tables[table] = tables[table] || [];
          if (insertRow) {
            tables[table].push(insertRow);
            calls.push({ table, op: "insert", row: insertRow });
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          }
          if (patch && updateError && table === "organizations") {
            return Promise.resolve({ data: null, error: updateError }).then(resolve, reject);
          }
          let rows = tables[table].filter((row) => filters.every((f) => f(row)));
          if (patch) {
            rows.forEach((row) => Object.assign(row, patch));
            calls.push({ table, op: "update", patch });
          }
          if (remove) {
            tables[table] = tables[table].filter((row) => !rows.includes(row));
            calls.push({ table, op: "delete" });
          }
          rows = JSON.parse(JSON.stringify(rows));
          return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    rpc: async (name, args) => {
      calls.push({ op: "rpc", name, args });
      return { data: null, error: null };
    },
    auth: {
      admin: {
        getUserById: async (id) => ({ data: { user: { id, email: "owner@mail.kz", app_metadata: { provider: "email" } } }, error: null }),
        generateLink: async (args) => {
          authCalls.push({ op: "generateLink", args });
          return { data: { properties: { action_link: `https://supabase.test/verify?type=${args.type}` } }, error: null };
        },
        updateUserById: async (id, attrs) => {
          authCalls.push({ op: "update", id, attrs });
          return { data: {}, error: null };
        },
        deleteUser: async (id) => {
          authCalls.push({ op: "delete", id });
          return { data: {}, error: null };
        },
      },
    },
  };
}

require("../server/lib/supabase-admin").getSupabaseAdmin = () => fakeSupabase();
const config = require("../server/config");
config.publicUrl = "https://bookly.test";
const manage = require("../server/lib/platform-admin-manage");

const ORG = "org-1";
const ADMIN = "admin-1";

function reset(sub = { status: "active" }) {
  calls.length = 0;
  authCalls.length = 0;
  updateError = null;
  tables.organizations = [
    { id: ORG, name: "ТОО Борода", public_name: "Борода", slug: "boroda", phone: "", address: "", business_type: "barbershop", public_booking_enabled: true },
  ];
  tables.organization_members = [{ organization_id: ORG, user_id: "owner-1", role: "owner" }];
  tables.organization_subscriptions = [{ organization_id: ORG, ...sub }];
  tables.platform_admin_audit_log = [];
}

const audits = () => tables.platform_admin_audit_log.map((a) => a.action);

function ok(message) {
  console.log("[OK]", message);
}

(async () => {
  // 1. Редактирование
  reset();
  await manage.updateOrganization(ORG, ADMIN, { public_name: "Борода Pro", slug: "Boroda-Pro", public_booking_enabled: false });
  assert.strictEqual(tables.organizations[0].slug, "boroda-pro", "адрес приводится к нижнему регистру");
  assert.strictEqual(tables.organizations[0].public_booking_enabled, false);
  assert.deepStrictEqual(Object.keys(tables.platform_admin_audit_log[0].metadata.changes).sort(), ["public_booking_enabled", "public_name", "slug"]);
  await assert.rejects(manage.updateOrganization(ORG, ADMIN, { slug: "плохой адрес" }), (e) => e.status === 400);
  await assert.rejects(manage.updateOrganization(ORG, ADMIN, { public_name: "Б" }), (e) => e.status === 400);
  updateError = { code: "23505" };
  await assert.rejects(manage.updateOrganization(ORG, ADMIN, { slug: "taken" }), (e) => e.code === "SLUG_TAKEN");
  ok("Редактирование: проверка полей, занятый адрес, изменения в журнале");

  // 2. Вход как владелец и 3. ссылка для пароля
  reset();
  const login = await manage.ownerLoginLink(ORG, ADMIN, "http://ignored");
  assert.ok(login.link.includes("type=magiclink"));
  assert.strictEqual(authCalls[0].args.options.redirectTo, "https://bookly.test/login");
  const recovery = await manage.ownerPasswordLink(ORG, ADMIN);
  assert.strictEqual(authCalls[1].args.options.redirectTo, "https://bookly.test/reset-password");
  assert.ok(recovery.link.includes("type=recovery"));
  assert.deepStrictEqual(audits(), ["OWNER_LOGIN_LINK", "OWNER_PASSWORD_LINK"]);
  ok("Ссылки входа как владелец и нового пароля — с журналом");

  // 3. Почта и блокировка
  reset();
  await assert.rejects(manage.changeOwnerEmail(ORG, ADMIN, "не почта"), (e) => e.status === 400);
  await manage.changeOwnerEmail(ORG, ADMIN, "New@Mail.KZ");
  assert.deepStrictEqual(authCalls[0].attrs, { email: "new@mail.kz", email_confirm: true });
  await assert.rejects(manage.setOwnerBlocked(ORG, ADMIN, true, ""), (e) => e.status === 400, "без причины нельзя");
  await manage.setOwnerBlocked(ORG, ADMIN, true, "спам");
  assert.strictEqual(authCalls.at(-1).attrs.ban_duration, "876000h");
  await manage.setOwnerBlocked(ORG, ADMIN, false);
  assert.strictEqual(authCalls.at(-1).attrs.ban_duration, "none");
  assert.deepStrictEqual(audits(), ["OWNER_EMAIL_CHANGED", "OWNER_BLOCKED", "OWNER_UNBLOCKED"]);
  ok("Владелец: смена почты, блокировка и разблокировка входа");

  // 4. Забрать Pro
  reset({ status: "active", current_period_end: "2030-01-01" });
  await assert.rejects(manage.revokePro(ORG, ADMIN, ""), (e) => e.status === 400);
  await manage.revokePro(ORG, ADMIN, "возврат оплаты");
  assert.strictEqual(tables.organization_subscriptions[0].status, "expired");
  assert.ok(calls.some((c) => c.op === "rpc" && c.name === "_apply_free_plan_limits"), "мастера сверх лимита — на паузу");
  reset({ status: "suspended" });
  await assert.rejects(manage.revokePro(ORG, ADMIN, "x"), (e) => e.code === "INVALID_STATUS");
  ok("Забрать Pro: перевод на Free, пауза лишних мастеров; у приостановленного — нельзя");

  // 5. Удаление
  reset({ status: "suspended" });
  await assert.rejects(manage.deleteOrganization(ORG, ADMIN, { confirmSlug: "wrong" }), (e) => e.code === "CONFIRMATION_MISMATCH");
  assert.strictEqual(tables.organizations.length, 1, "без верного подтверждения ничего не удалено");
  await manage.deleteOrganization(ORG, ADMIN, { confirmSlug: "BORODA", deleteOwner: true });
  assert.strictEqual(tables.organizations.length, 0);
  const ops = calls.map((c) => `${c.table || c.op}:${c.op}`);
  assert.ok(
    ops.indexOf("organization_subscriptions:update") < ops.indexOf("organizations:delete"),
    "приостановка снимается до удаления (иначе триггеры не дадут удалить записи)"
  );
  assert.deepStrictEqual(authCalls.at(-1), { op: "delete", id: "owner-1" });
  const deleted = tables.platform_admin_audit_log.find((a) => a.action === "ORGANIZATION_DELETED");
  assert.strictEqual(deleted.metadata.slug, "boroda");
  assert.strictEqual(deleted.metadata.owner_email, "owner@mail.kz");
  ok("Удаление: только при точном вводе адреса, снятие приостановки, аккаунт владельца по желанию, след в журнале");

  console.log("\nВсе unit-тесты управления салоном пройдены.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
