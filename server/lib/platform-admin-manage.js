/**
 * Управление салоном из админ-панели платформы:
 * редактирование, вход как владелец, управление владельцем,
 * отмена Pro, удаление салона. Каждое действие пишется в журнал.
 */

const config = require("../config");
const { getSupabaseAdmin } = require("./supabase-admin");
const { appError } = require("./subscription-service");

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const BAN_FOREVER = "876000h"; // 100 лет

function fail(context, error) {
  console.error(`[platform-admin] ${context}`, error?.code || error?.status || "unknown");
  return appError("Не удалось выполнить действие", "INTERNAL_ERROR", 500);
}

function siteUrl(baseUrl) {
  return (config.publicUrl || baseUrl || "").replace(/\/+$/, "");
}

async function audit(adminUserId, action, organizationId, metadata = {}) {
  const { error } = await getSupabaseAdmin().from("platform_admin_audit_log").insert({
    admin_user_id: adminUserId,
    action,
    organization_id: organizationId,
    metadata,
  });
  if (error) console.error("[platform-admin] audit insert", error.code || "unknown");
}

async function loadOrganization(organizationId) {
  const { data, error } = await getSupabaseAdmin()
    .from("organizations")
    .select("id, name, public_name, slug, phone, address, business_type, public_booking_enabled")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw fail("manage:org", error);
  if (!data) throw appError("Салон не найден", "NOT_FOUND", 404);
  return data;
}

async function loadOwner(organizationId) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();
  if (error) throw fail("manage:owner", error);
  if (!data?.user_id) throw appError("У салона нет владельца", "NOT_FOUND", 404);

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(data.user_id);
  if (userError || !userData?.user) throw fail("manage:owner-user", userError);
  return userData.user;
}

// -----------------------------------------------------------------------------
// 1. Редактирование
// -----------------------------------------------------------------------------

function cleanText(value, max) {
  const text = String(value ?? "").trim();
  return text.length > max ? null : text;
}

async function updateOrganization(organizationId, adminUserId, body = {}) {
  const before = await loadOrganization(organizationId);
  const patch = {};

  if (body.public_name !== undefined) {
    const v = cleanText(body.public_name, 80);
    if (!v || v.length < 2) throw appError("Название: от 2 до 80 символов", "VALIDATION_ERROR", 400);
    patch.public_name = v;
  }
  if (body.name !== undefined) {
    const v = cleanText(body.name, 120);
    if (!v || v.length < 2) throw appError("Юр. название: от 2 до 120 символов", "VALIDATION_ERROR", 400);
    patch.name = v;
  }
  if (body.slug !== undefined) {
    const v = String(body.slug || "").trim().toLowerCase();
    if (v.length < 3 || v.length > 60 || !SLUG_PATTERN.test(v)) {
      throw appError("Адрес страницы: латиница, цифры и дефисы, от 3 до 60 символов", "VALIDATION_ERROR", 400);
    }
    patch.slug = v;
  }
  if (body.phone !== undefined) {
    const v = cleanText(body.phone, 30);
    if (v === null) throw appError("Телефон слишком длинный", "VALIDATION_ERROR", 400);
    patch.phone = v || null;
  }
  if (body.address !== undefined) {
    const v = cleanText(body.address, 200);
    if (v === null) throw appError("Адрес слишком длинный", "VALIDATION_ERROR", 400);
    patch.address = v || null;
  }
  if (body.business_type !== undefined && body.business_type) {
    patch.business_type = String(body.business_type);
  }
  if (body.public_booking_enabled !== undefined) {
    patch.public_booking_enabled = Boolean(body.public_booking_enabled);
  }

  const changes = {};
  for (const [key, value] of Object.entries(patch)) {
    if ((before[key] ?? null) !== (value ?? null)) changes[key] = { from: before[key] ?? null, to: value ?? null };
  }
  if (!Object.keys(changes).length) return before;

  const { data, error } = await getSupabaseAdmin()
    .from("organizations")
    .update(patch)
    .eq("id", organizationId)
    .select("id, name, public_name, slug, phone, address, business_type, public_booking_enabled")
    .single();

  if (error) {
    if (error.code === "23505") throw appError("Такой адрес страницы уже занят", "SLUG_TAKEN", 409);
    if (error.code === "22P02") throw appError("Неизвестный тип бизнеса", "VALIDATION_ERROR", 400);
    throw fail("manage:update", error);
  }

  await audit(adminUserId, "ORGANIZATION_UPDATED", organizationId, { changes });
  return data;
}

// -----------------------------------------------------------------------------
// 2. Вход как владелец
// -----------------------------------------------------------------------------

async function ownerLoginLink(organizationId, adminUserId, baseUrl) {
  const owner = await loadOwner(organizationId);
  if (!owner.email) throw appError("У владельца нет почты", "VALIDATION_ERROR", 400);

  const { data, error } = await getSupabaseAdmin().auth.admin.generateLink({
    type: "magiclink",
    email: owner.email,
    options: { redirectTo: `${siteUrl(baseUrl)}/login` },
  });
  if (error || !data?.properties?.action_link) throw fail("manage:magiclink", error);

  await audit(adminUserId, "OWNER_LOGIN_LINK", organizationId, { email: owner.email });
  return { link: data.properties.action_link, email: owner.email };
}

// -----------------------------------------------------------------------------
// 3. Владелец: почта, сброс пароля, блокировка входа
// -----------------------------------------------------------------------------

async function changeOwnerEmail(organizationId, adminUserId, email) {
  const value = String(email || "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(value)) throw appError("Проверьте почту", "VALIDATION_ERROR", 400);

  const owner = await loadOwner(organizationId);
  const { error } = await getSupabaseAdmin().auth.admin.updateUserById(owner.id, {
    email: value,
    email_confirm: true,
  });
  if (error) {
    if (/already|exists|registered/i.test(error.message || "")) {
      throw appError("Эта почта уже занята другим аккаунтом", "EMAIL_TAKEN", 409);
    }
    throw fail("manage:email", error);
  }

  await audit(adminUserId, "OWNER_EMAIL_CHANGED", organizationId, { from: owner.email, to: value });
  return { email: value };
}

async function ownerPasswordLink(organizationId, adminUserId, baseUrl) {
  const owner = await loadOwner(organizationId);
  const { data, error } = await getSupabaseAdmin().auth.admin.generateLink({
    type: "recovery",
    email: owner.email,
    options: { redirectTo: `${siteUrl(baseUrl)}/reset-password` },
  });
  if (error || !data?.properties?.action_link) throw fail("manage:recovery", error);

  await audit(adminUserId, "OWNER_PASSWORD_LINK", organizationId, { email: owner.email });
  return { link: data.properties.action_link, email: owner.email };
}

async function setOwnerBlocked(organizationId, adminUserId, blocked, reason = "") {
  const owner = await loadOwner(organizationId);
  if (blocked && !String(reason).trim()) throw appError("Укажите причину", "VALIDATION_ERROR", 400);

  const { error } = await getSupabaseAdmin().auth.admin.updateUserById(owner.id, {
    ban_duration: blocked ? BAN_FOREVER : "none",
  });
  if (error) throw fail("manage:ban", error);

  await audit(adminUserId, blocked ? "OWNER_BLOCKED" : "OWNER_UNBLOCKED", organizationId, {
    email: owner.email,
    ...(blocked ? { reason: String(reason).trim().slice(0, 500) } : {}),
  });
  return { blocked };
}

async function ownerInfo(organizationId) {
  const owner = await loadOwner(organizationId);
  const bannedUntil = owner.banned_until ? new Date(owner.banned_until) : null;
  return {
    user_id: owner.id,
    email: owner.email || null,
    provider: owner.app_metadata?.provider || "email",
    email_confirmed: Boolean(owner.email_confirmed_at),
    created_at: owner.created_at,
    last_sign_in_at: owner.last_sign_in_at || null,
    blocked: Boolean(bannedUntil && bannedUntil > new Date()),
  };
}

// -----------------------------------------------------------------------------
// 4. Забрать Pro
// -----------------------------------------------------------------------------

async function revokePro(organizationId, adminUserId, reason) {
  const text = String(reason || "").trim();
  if (!text) throw appError("Укажите причину", "VALIDATION_ERROR", 400);

  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("organization_subscriptions")
    .update({ status: "expired", current_period_end: now, trial_ends_at: now, grace_period_ends_at: null })
    .eq("organization_id", organizationId)
    .neq("status", "suspended")
    .select("organization_id")
    .maybeSingle();

  if (error) throw fail("manage:revoke", error);
  if (!data) throw appError("Сначала верните салон из приостановки", "INVALID_STATUS", 400);

  // Мастера сверх лимита Free встают на паузу
  const { error: limitError } = await admin.rpc("_apply_free_plan_limits", { p_organization_id: organizationId });
  if (limitError) console.error("[platform-admin] apply free limits", limitError.code || "unknown");

  await audit(adminUserId, "SUBSCRIPTION_REVOKED", organizationId, { reason: text.slice(0, 500) });
  return { plan: "free" };
}

// -----------------------------------------------------------------------------
// 5. Удаление салона
// -----------------------------------------------------------------------------

async function deleteOrganization(organizationId, adminUserId, { confirmSlug, deleteOwner = false } = {}) {
  const org = await loadOrganization(organizationId);
  if (String(confirmSlug || "").trim().toLowerCase() !== String(org.slug || "").toLowerCase()) {
    throw appError("Для подтверждения введите адрес страницы салона точно", "CONFIRMATION_MISMATCH", 400);
  }

  const admin = getSupabaseAdmin();
  let owner = null;
  try {
    owner = await loadOwner(organizationId);
  } catch {
    owner = null;
  }

  // Журнал — до удаления: organization_id обнулится, но название и почта останутся.
  await audit(adminUserId, "ORGANIZATION_DELETED", organizationId, {
    name: org.public_name || org.name,
    slug: org.slug,
    owner_email: owner?.email || null,
    owner_deleted: Boolean(deleteOwner && owner),
  });

  // Приостановленный салон триггеры не дают трогать — снимаем статус перед удалением.
  await admin
    .from("organization_subscriptions")
    .update({ status: "expired" })
    .eq("organization_id", organizationId)
    .eq("status", "suspended");

  const { error } = await admin.from("organizations").delete().eq("id", organizationId);
  if (error) throw fail("manage:delete", error);

  if (deleteOwner && owner) {
    const { error: userError } = await admin.auth.admin.deleteUser(owner.id);
    if (userError) console.error("[platform-admin] delete owner", userError.code || "unknown");
  }

  return { deleted: true };
}

// -----------------------------------------------------------------------------
// 6. Мастера, услуги, записи
// -----------------------------------------------------------------------------

async function organizationContents(organizationId) {
  const admin = getSupabaseAdmin();
  const [staff, services, bookings] = await Promise.all([
    admin
      .from("staff")
      .select("id, name, position, phone, is_active, telegram_chat_id, created_at")
      .eq("organization_id", organizationId)
      .order("name"),
    admin
      .from("services")
      .select("id, name, price, duration_minutes, is_active")
      .eq("organization_id", organizationId)
      .order("name"),
    admin
      .from("bookings")
      .select(
        "id, booking_date, start_time, end_time, status, source, client_name, client_phone, price, paid_amount, created_at, services(name), staff(name)"
      )
      .eq("organization_id", organizationId)
      .order("booking_date", { ascending: false })
      .order("start_time", { ascending: false })
      .limit(50),
  ]);

  for (const result of [staff, services, bookings]) {
    if (result.error) throw fail("manage:contents", result.error);
  }

  return {
    staff: (staff.data || []).map(({ telegram_chat_id: chat, ...row }) => ({ ...row, telegram: Boolean(chat) })),
    services: services.data || [],
    bookings: bookings.data || [],
  };
}

module.exports = {
  updateOrganization,
  ownerLoginLink,
  changeOwnerEmail,
  ownerPasswordLink,
  setOwnerBlocked,
  ownerInfo,
  revokePro,
  deleteOrganization,
  organizationContents,
};
