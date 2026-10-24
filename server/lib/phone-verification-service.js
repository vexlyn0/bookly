/**
 * Подтверждение номера клиента через Telegram-бота.
 *
 *   1. Страница записи создаёт заявку (token) и открывает t.me/<bot>?start=v_<token>.
 *   2. Бот просит «Поделиться номером»: Telegram передаёт номер, привязанный
 *      к аккаунту (подделать нельзя — проверяем contact.user_id === from.id).
 *   3. Номер совпал — заявка verified; страница видит это и создаёт запись
 *      с verification_token. После записи заявка помечается used.
 */

const crypto = require("crypto");
const config = require("../config");
const { getSupabaseAdmin } = require("./supabase-admin");

const TOKEN_PATTERN = /^[0-9a-f]{32}$/;
/** Сколько подтверждённый номер действует для создания записи. */
const VERIFIED_TTL_MINUTES = 60;

function appError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function internalError(context, error) {
  console.error("[phone-verify]", context, error?.code || "unknown");
  return appError("Не удалось выполнить запрос. Попробуйте позже", "INTERNAL_ERROR", 500);
}

/** Номер в едином виде — та же логика, что public.phone_key() в базе. */
function phoneKey(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
}

function isAvailable() {
  return Boolean(config.telegram.isConfigured && config.telegram.webhookSecret && config.telegram.botUsername);
}

/** Проверка включена владельцем и бот работает (иначе запись не блокируем). */
function isRequired(organization) {
  return organization?.require_phone_verification === true && isAvailable();
}

/**
 * Номер, которому верим без проверки: клиент уже подтверждал его в нашем
 * Telegram-боте или у него есть состоявшийся визит в этом салоне.
 * @returns {Promise<{ trusted: boolean, chatIds: string[] }>}
 */
async function trustInfo(organization, clientPhone) {
  const key = phoneKey(clientPhone);
  if (key.length < 10) return { trusted: false, chatIds: [] };

  const supabase = getSupabaseAdmin();
  const [clientsResult, visitResult] = await Promise.all([
    supabase.from("telegram_clients").select("chat_id").eq("phone_key", key),
    supabase
      .from("bookings")
      .select("id")
      .eq("organization_id", organization.id)
      .eq("client_phone_key", key)
      .eq("status", "completed")
      .limit(1),
  ]);

  if (clientsResult.error) console.error("[phone-verify] trust:clients", clientsResult.error.code || "unknown");
  if (visitResult.error) console.error("[phone-verify] trust:visits", visitResult.error.code || "unknown");

  const chatIds = (clientsResult.data || []).map((row) => String(row.chat_id));
  return { trusted: chatIds.length > 0 || (visitResult.data || []).length > 0, chatIds };
}

async function create(organization, clientPhone) {
  if (!isAvailable()) {
    throw appError("Подтверждение номера временно недоступно", "VERIFICATION_UNAVAILABLE", 503);
  }

  const key = phoneKey(clientPhone);
  if (key.length < 10 || key.length > 15) {
    throw appError("Укажите номер телефона полностью", "VALIDATION_ERROR", 400);
  }

  const token = crypto.randomBytes(16).toString("hex");
  const { error } = await getSupabaseAdmin()
    .from("phone_verifications")
    .insert({ token, organization_id: organization.id, phone_key: key });

  if (error) throw internalError("create", error);

  return {
    token,
    bot_url: `https://t.me/${config.telegram.botUsername}?start=v_${token}`,
  };
}

/** Публичный статус: pending | verified | mismatch | expired */
async function getStatus(token) {
  const value = String(token || "");
  if (!TOKEN_PATTERN.test(value)) {
    throw appError("Заявка не найдена", "VERIFICATION_NOT_FOUND", 404);
  }

  const { data, error } = await getSupabaseAdmin()
    .from("phone_verifications")
    .select("status, expires_at")
    .eq("token", value)
    .maybeSingle();

  if (error) throw internalError("status", error);
  if (!data) throw appError("Заявка не найдена", "VERIFICATION_NOT_FOUND", 404);

  if (data.status === "pending" && new Date(data.expires_at) < new Date()) {
    return { status: "expired" };
  }
  return { status: data.status === "used" ? "verified" : data.status };
}

/**
 * Для создания записи: заявка этой организации, подтверждена, номер совпадает.
 * @returns {Promise<{ id: string, chat_id: string }>}
 */
async function requireVerified(organization, token, clientPhone) {
  const value = String(token || "");
  const fail = () =>
    appError("Подтвердите номер телефона через Telegram", "PHONE_NOT_VERIFIED", 403);

  if (!TOKEN_PATTERN.test(value)) throw fail();

  const { data, error } = await getSupabaseAdmin()
    .from("phone_verifications")
    .select("id, organization_id, phone_key, chat_id, status, verified_at")
    .eq("token", value)
    .maybeSingle();

  if (error) throw internalError("require", error);

  const fresh =
    data?.verified_at &&
    Date.now() - new Date(data.verified_at).getTime() < VERIFIED_TTL_MINUTES * 60000;

  if (
    !data ||
    data.organization_id !== organization.id ||
    data.status !== "verified" ||
    !fresh ||
    data.phone_key !== phoneKey(clientPhone)
  ) {
    throw fail();
  }

  return data;
}

async function markUsed(id) {
  const { error } = await getSupabaseAdmin()
    .from("phone_verifications")
    .update({ status: "used" })
    .eq("id", id);
  if (error) console.error("[phone-verify] markUsed failed", error.code || "unknown");
}

// -----------------------------------------------------------------------------
// Сторона бота
// -----------------------------------------------------------------------------

/** /start v_<token>: привязать заявку к чату. Возвращает заявку или null. */
async function attachChat(token, chatId) {
  if (!TOKEN_PATTERN.test(String(token || ""))) return null;
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("phone_verifications")
    .select("id, status, expires_at, organizations(name, public_name)")
    .eq("token", token)
    .maybeSingle();

  if (error) throw internalError("attach:select", error);
  if (!data || data.status !== "pending" || new Date(data.expires_at) < new Date()) return null;

  const { error: updateError } = await supabase
    .from("phone_verifications")
    .update({ chat_id: String(chatId) })
    .eq("id", data.id)
    .eq("status", "pending");

  if (updateError) throw internalError("attach:update", updateError);
  return data;
}

/**
 * Контакт из Telegram: сверить номер с последней активной заявкой этого чата.
 * @returns {Promise<"verified"|"mismatch"|"none">}
 */
async function confirmContact(chatId, contactPhone) {
  const supabase = getSupabaseAdmin();
  const { data: rows, error } = await supabase
    .from("phone_verifications")
    .select("id, phone_key, expires_at")
    .eq("chat_id", String(chatId))
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw internalError("contact:select", error);

  const row = rows?.[0];
  if (!row || new Date(row.expires_at) < new Date()) return "none";

  const matched = phoneKey(contactPhone) === row.phone_key;
  const { error: updateError } = await supabase
    .from("phone_verifications")
    .update(
      matched
        ? { status: "verified", verified_at: new Date().toISOString() }
        : { status: "mismatch" }
    )
    .eq("id", row.id)
    .eq("status", "pending");

  if (updateError) throw internalError("contact:update", updateError);
  return matched ? "verified" : "mismatch";
}

module.exports = {
  isAvailable,
  isRequired,
  trustInfo,
  create,
  getStatus,
  requireVerified,
  markUsed,
  attachChat,
  confirmContact,
  phoneKey,
  TOKEN_PATTERN,
};
