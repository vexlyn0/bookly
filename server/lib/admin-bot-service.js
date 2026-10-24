/**
 * Jazyl — Telegram администратора платформы: заявки на оплату Pro.
 *
 *   - привязка: /start pa_<telegram_link_token> (ссылка из /admin → «Оплаты»);
 *   - новая заявка из кабинета салона → всем подключённым администраторам
 *     «💰 Заявка на Pro» с кнопками «Оплата пришла» / «Отклонить»;
 *   - «Оплата пришла» → admin_approve_manual_payment (как кнопка в админке): Pro продлевается;
 *     «Отклонить» → причина кнопкой → admin_reject_manual_payment;
 *   - владельцу салона (если подключил Telegram) — итог;
 *   - /pay — список заявок, ждущих проверки.
 *
 * Ошибки Telegram не ломают создание заявки и работу админки.
 */

const { getSupabaseAdmin } = require("./supabase-admin");
const config = require("../config");

const CALLBACK_PATTERN = /^sub:(ok|no|r1|r2|back):([0-9a-f-]{36})$/i;
const START_PATTERN = /^pa_([0-9a-f]{32})$/;
const REASONS = {
  r1: "Перевод не найден в Kaspi",
  r2: "Сумма перевода не совпадает с тарифом",
};

const REQUEST_SELECT = `
  id,
  organization_id,
  amount,
  currency,
  billing_months,
  payer_name,
  payer_phone,
  payment_reference,
  payment_date,
  customer_note,
  status,
  admin_note,
  approved_period_end,
  created_at,
  organizations ( id, name, public_name, slug, owner_telegram_chat_id )
`;

function telegram() {
  return require("./telegram-service");
}

function platformAdmin() {
  return require("./platform-admin-service");
}

// -----------------------------------------------------------------------------
// Форматирование
// -----------------------------------------------------------------------------

function money(value, currency = "KZT") {
  const amount = `${Math.round(Number(value) || 0)}`.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return currency === "KZT" ? `${amount} ₸` : `${amount} ${currency}`;
}

function formatDate(value, withTime = false) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", {
    timeZone: "Asia/Almaty",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function orgOf(row) {
  return (Array.isArray(row.organizations) ? row.organizations[0] : row.organizations) || {};
}

function requestText(row) {
  const e = telegram().escapeHtml;
  const org = orgOf(row);
  const lines = [
    "💰 <b>Заявка на Pro</b>",
    "",
    `🏠 <b>${e(org.public_name || org.name || "Салон")}</b>${org.slug ? ` · ${e(org.slug)}` : ""}`,
    `💵 <b>${money(row.amount, row.currency)}</b> · ${row.billing_months} мес.`,
    `👤 Отправитель: ${e(row.payer_name || "—")}${row.payer_phone ? ` · ${e(row.payer_phone)}` : ""}`,
  ];
  if (row.payment_reference) lines.push(`🧾 Комментарий платежа: ${e(row.payment_reference)}`);
  if (row.payment_date) lines.push(`📅 Перевод: ${formatDate(row.payment_date, true)}`);
  if (row.customer_note) lines.push(`💬 <i>${e(row.customer_note)}</i>`);
  lines.push(`🕓 Заявка: ${formatDate(row.created_at, true)}`);
  return lines.join("\n");
}

function statusFooter(row) {
  if (row.status === "approved") {
    return `\n\n✅ <b>Оплата подтверждена</b>${row.approved_period_end ? ` — Pro до ${formatDate(row.approved_period_end)}` : ""}`;
  }
  if (row.status === "rejected") {
    return `\n\n❌ <b>Отклонена</b>${row.admin_note ? `: ${telegram().escapeHtml(row.admin_note)}` : ""}`;
  }
  if (row.status === "canceled") return "\n\n↩️ Салон отменил заявку";
  return "\n\nПроверьте Kaspi и нажмите кнопку:";
}

function mainKeyboard(id) {
  return {
    inline_keyboard: [
      [{ text: "✅ Оплата пришла", callback_data: `sub:ok:${id}` }],
      [{ text: "❌ Отклонить", callback_data: `sub:no:${id}` }],
    ],
  };
}

function rejectKeyboard(id) {
  return {
    inline_keyboard: [
      [{ text: `❌ ${REASONS.r1}`, callback_data: `sub:r1:${id}` }],
      [{ text: `❌ ${REASONS.r2}`, callback_data: `sub:r2:${id}` }],
      [{ text: "← Назад", callback_data: `sub:back:${id}` }],
    ],
  };
}

// -----------------------------------------------------------------------------
// Данные
// -----------------------------------------------------------------------------

async function loadRequest(id) {
  const { data, error } = await getSupabaseAdmin().from("manual_payment_requests").select(REQUEST_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

async function adminByChat(chatId) {
  const { data, error } = await getSupabaseAdmin()
    .from("platform_admins")
    .select("user_id, telegram_chat_id")
    .eq("telegram_chat_id", String(chatId))
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function connectedAdmins() {
  const { data, error } = await getSupabaseAdmin()
    .from("platform_admins")
    .select("user_id, telegram_chat_id")
    .not("telegram_chat_id", "is", null);
  if (error) throw error;
  return data || [];
}

// -----------------------------------------------------------------------------
// Уведомления
// -----------------------------------------------------------------------------

/** Новая заявка из кабинета салона → администраторам. Никогда не бросает. */
async function notifyNewPaymentRequest(requestId) {
  const tg = telegram();
  if (!tg.isEnabled() || !requestId) return 0;
  try {
    const [row, admins] = await Promise.all([loadRequest(requestId), connectedAdmins()]);
    if (!row || row.status !== "pending") return 0;
    let sent = 0;
    for (const admin of admins) {
      try {
        await tg.sendMessage(admin.telegram_chat_id, requestText(row) + statusFooter(row), { reply_markup: mainKeyboard(row.id) });
        sent += 1;
      } catch (error) {
        tg.logTelegramError("admin-bot:notify", error);
      }
    }
    return sent;
  } catch (error) {
    tg.logTelegramError("admin-bot:notify", error);
    return 0;
  }
}

/** Итог — владельцу салона, если он подключил Telegram. */
async function notifyOwner(row) {
  const org = orgOf(row);
  if (!org.owner_telegram_chat_id) return;
  const text =
    row.status === "approved"
      ? `✅ <b>Оплата подтверждена</b>\n\nPro подключён${row.approved_period_end ? ` до ${formatDate(row.approved_period_end)}` : ""}. Спасибо, что вы с Jazyl!`
      : `❌ <b>Заявка на Pro отклонена</b>${row.admin_note ? `\n\nПричина: ${telegram().escapeHtml(row.admin_note)}` : ""}\n\nЕсли вы уже перевели деньги — откройте кабинет → «Тариф и оплата» и отправьте заявку ещё раз с данными перевода.`;
  await telegram().sendToOwner({ id: org.id, owner_telegram_chat_id: org.owner_telegram_chat_id }, text);
}

// -----------------------------------------------------------------------------
// Кнопки и команды
// -----------------------------------------------------------------------------

async function handleCallback({ callbackId, chatId, messageId, data }) {
  const tg = telegram();
  const match = String(data || "").match(CALLBACK_PATTERN);
  if (!match) {
    await tg.answerCallback(callbackId, "Неизвестное действие");
    return;
  }
  const [, action, requestId] = match;

  let admin = null;
  let row = null;
  try {
    [admin, row] = await Promise.all([adminByChat(chatId), loadRequest(requestId)]);
  } catch (error) {
    tg.logTelegramError("admin-bot:callback", error);
    await tg.answerCallback(callbackId, "Не удалось выполнить действие. Попробуйте позже", true);
    return;
  }

  // Только администратор платформы, привязанный к этому чату
  if (!admin) {
    await tg.answerCallback(callbackId, "Недоступно", true);
    return;
  }
  if (!row) {
    await tg.answerCallback(callbackId, "Заявка не найдена", true);
    return;
  }

  if (row.status !== "pending") {
    await tg.answerCallback(callbackId, "Заявка уже обработана");
    await tg.editMessage(chatId, messageId, requestText(row) + statusFooter(row));
    return;
  }

  if (action === "no") {
    await tg.answerCallback(callbackId, "Выберите причину");
    await tg.editMessage(chatId, messageId, `${requestText(row)}\n\nПочему отклоняем?`, rejectKeyboard(row.id));
    return;
  }
  if (action === "back") {
    await tg.answerCallback(callbackId, "");
    await tg.editMessage(chatId, messageId, requestText(row) + statusFooter(row), mainKeyboard(row.id));
    return;
  }

  try {
    if (action === "ok") {
      await platformAdmin().approvePaymentRequest(row.id, admin.user_id, "Подтверждено в Telegram");
    } else {
      await platformAdmin().rejectPaymentRequest(row.id, admin.user_id, REASONS[action]);
    }
  } catch (error) {
    if (error?.code === "PAYMENT_ALREADY_PROCESSED" || error?.code === "INVALID_STATUS") {
      const fresh = await loadRequest(row.id).catch(() => row);
      await tg.answerCallback(callbackId, "Заявка уже обработана");
      await tg.editMessage(chatId, messageId, requestText(fresh) + statusFooter(fresh));
      return;
    }
    tg.logTelegramError("admin-bot:decide", error);
    await tg.answerCallback(callbackId, error?.message || "Не удалось выполнить действие", true);
    return;
  }

  const fresh = await loadRequest(row.id).catch(() => null);
  const result = fresh || row;
  await tg.answerCallback(callbackId, action === "ok" ? "Pro подключён" : "Заявка отклонена");
  await tg.editMessage(chatId, messageId, requestText(result) + statusFooter(result));
  try {
    await notifyOwner(result);
  } catch (error) {
    tg.logTelegramError("admin-bot:owner", error);
  }
}

/** /pay — заявки, ждущие проверки (до 10). true — команда обработана. */
async function showPending(chatId) {
  const tg = telegram();
  const admin = await adminByChat(chatId).catch(() => null);
  if (!admin) return false;

  const { data, error } = await getSupabaseAdmin()
    .from("manual_payment_requests")
    .select(REQUEST_SELECT)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) {
    tg.logTelegramError("admin-bot:pending", error);
    await tg.sendMessage(chatId, "⚠️ Не удалось загрузить заявки. Попробуйте позже.");
    return true;
  }
  if (!data?.length) {
    await tg.sendMessage(chatId, "✅ Новых заявок на оплату нет.");
    return true;
  }
  for (const row of data) {
    await tg.sendMessage(chatId, requestText(row) + statusFooter(row), { reply_markup: mainKeyboard(row.id) });
  }
  return true;
}

/** /start pa_<токен>. Возвращает текст ответа. */
async function link(chatId, token) {
  const supabase = getSupabaseAdmin();
  const { data: admin, error } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("telegram_link_token", token)
    .maybeSingle();
  if (error) {
    telegram().logTelegramError("admin-bot:link", error);
    return "⚠️ Не удалось подключить. Попробуйте позже.";
  }
  if (!admin) return "❌ Ссылка недействительна или уже использована. Откройте свежую ссылку в админке Jazyl → «Оплаты».";

  const { error: updateError } = await supabase
    .from("platform_admins")
    .update({ telegram_chat_id: String(chatId), telegram_link_token: telegram().generateLinkToken() })
    .eq("user_id", admin.user_id)
    .eq("telegram_link_token", token);
  if (updateError) {
    telegram().logTelegramError("admin-bot:link", updateError);
    return "⚠️ Не удалось подключить. Попробуйте позже.";
  }

  return [
    "✅ <b>Готово! Это ваш чат администратора Jazyl.</b>",
    "",
    "Сюда будут приходить заявки салонов на оплату Pro — с кнопками «Оплата пришла» и «Отклонить».",
    "",
    "/pay — заявки, которые ждут проверки",
    "/stop — отключить",
  ].join("\n");
}

/** /stop: отвязать чат администратора. true — что-то отвязали. */
async function unlinkChat(chatId) {
  const { data, error } = await getSupabaseAdmin()
    .from("platform_admins")
    .update({ telegram_chat_id: null })
    .eq("telegram_chat_id", String(chatId))
    .select("user_id");
  if (error) throw error;
  return Boolean(data?.length);
}

// -----------------------------------------------------------------------------
// Для админки (/api/admin/telegram)
// -----------------------------------------------------------------------------

async function getStatus(userId) {
  const { data, error } = await getSupabaseAdmin()
    .from("platform_admins")
    .select("telegram_chat_id, telegram_link_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const bot = config.telegram?.isConfigured ? config.telegram.botUsername : "";
  return {
    connected: Boolean(data?.telegram_chat_id),
    link: bot && data?.telegram_link_token ? `https://t.me/${bot}?start=pa_${data.telegram_link_token}` : null,
    bot_configured: Boolean(bot),
  };
}

async function disconnect(userId) {
  const { error } = await getSupabaseAdmin().from("platform_admins").update({ telegram_chat_id: null }).eq("user_id", userId);
  if (error) throw error;
  return getStatus(userId);
}

module.exports = {
  START_PATTERN,
  notifyNewPaymentRequest,
  handleCallback,
  showPending,
  link,
  unlinkChat,
  getStatus,
  disconnect,
  // для тестов
  requestText,
  mainKeyboard,
  rejectKeyboard,
  REASONS,
};
