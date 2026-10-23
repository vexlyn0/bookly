/**
 * Telegram-бот Bookly
 *
 *   - уведомление сотрудника о новой онлайн-записи;
 *   - привязка сотрудника: /start <telegram_link_token> (ссылка из кабинета);
 *   - отвязка: /stop;
 *   - подтверждение / отклонение записи inline-кнопками (только pending).
 *
 * Ошибки Telegram никогда не пробрасываются в бизнес-логику записи.
 * Токен бота не попадает в логи.
 */

const crypto = require("crypto");
const config = require("../config");
const { getSupabaseAdmin } = require("./supabase-admin");
const { formatTimeForInput } = require("./slots");
const { mapSubscriptionError } = require("./subscription-service");

const API_BASE = "https://api.telegram.org";
const REQUEST_TIMEOUT_MS = 8000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const CALLBACK_PATTERN = /^bk:(confirm|reject):([0-9a-f-]{36})$/i;
const COMMAND_PATTERN = /^\/([a-z_]+)(?:@\w+)?(?:\s+(.+))?$/i;

const STATUS_LABELS = {
  pending: "⏳ Ожидает подтверждения",
  confirmed: "✅ Подтверждена",
  canceled: "❌ Отменена",
  completed: "✔️ Завершена",
  no_show: "🚫 Клиент не пришёл",
};

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

const BOOKING_SELECT = `
  id,
  status,
  staff_id,
  booking_date,
  start_time,
  end_time,
  client_name,
  client_phone,
  client_email,
  client_comment,
  public_reference,
  services(name),
  staff(name),
  organizations(name, public_name)
`;

// -----------------------------------------------------------------------------
// Конфигурация и Bot API
// -----------------------------------------------------------------------------

function isEnabled() {
  return Boolean(config.telegram.isConfigured);
}

function isWebhookEnabled() {
  return isEnabled() && Boolean(config.telegram.webhookSecret);
}

function verifyWebhookSecret(headerValue) {
  const expected = String(config.telegram.webhookSecret || "");
  const received = String(headerValue || "");
  if (!expected || !received) return false;

  const a = crypto.createHash("sha256").update(expected).digest();
  const b = crypto.createHash("sha256").update(received).digest();
  return crypto.timingSafeEqual(a, b);
}

async function callApi(method, payload = {}) {
  if (!isEnabled()) {
    const error = new Error("Telegram is not configured");
    error.code = "TELEGRAM_NOT_CONFIGURED";
    throw error;
  }

  const response = await fetch(`${API_BASE}/bot${config.telegram.token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok || !data?.ok) {
    const error = new Error(`Telegram ${method} failed`);
    error.code = data?.error_code || response.status;
    error.description = String(data?.description || "");
    throw error;
  }

  return data.result;
}

function logTelegramError(context, error) {
  const details = [error?.code, error?.description].filter(Boolean).join(" ");
  console.error(`[telegram] ${context} failed:`, details || error?.name || "unknown");
}

function sendMessage(chatId, text, extra = {}) {
  return callApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

async function answerCallback(callbackQueryId, text, showAlert = false) {
  try {
    await callApi("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert,
    });
  } catch (error) {
    logTelegramError("answerCallbackQuery", error);
  }
}

async function editMessage(chatId, messageId, text, replyMarkup) {
  try {
    await callApi("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: replyMarkup || { inline_keyboard: [] },
    });
  } catch (error) {
    if (error.description.includes("message is not modified")) return;
    logTelegramError("editMessageText", error);
  }
}

/**
 * Вызывается при старте сервера: подтягивает username бота, если он не задан в env.
 */
async function init() {
  if (!isEnabled()) {
    console.warn("[warn] Telegram не настроен (TELEGRAM_BOT_TOKEN) — уведомления отключены");
    return;
  }

  if (!config.telegram.webhookSecret) {
    console.warn("[warn] TELEGRAM_WEBHOOK_SECRET не задан — webhook бота отключён");
  }

  if (config.telegram.botUsername) {
    console.log("[telegram] configured");
    return;
  }

  try {
    const me = await callApi("getMe");
    config.telegram.botUsername = me.username || "";
    console.log("[telegram] configured (username from getMe)");
  } catch (error) {
    logTelegramError("getMe", error);
  }
}

// -----------------------------------------------------------------------------
// Форматирование
// -----------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(dateStr) {
  const match = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(dateStr || "");
  const [, y, m, d] = match;
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).getUTCDay()];
  return `${d}.${m}.${y} (${weekday})`;
}

/**
 * @param {object} view
 * @param {string} view.organizationName
 * @param {string} view.serviceName
 * @param {string} view.staffName
 * @param {string} view.bookingDate  YYYY-MM-DD
 * @param {string} view.startTime
 * @param {string} view.endTime
 * @param {string} view.clientName
 * @param {string} [view.clientPhone]
 * @param {string} [view.clientEmail]
 * @param {string} [view.clientComment]
 * @param {string} [view.reference]
 * @param {string} view.status
 */
function formatBookingMessage(view) {
  const lines = [
    `🔔 <b>Новая запись</b> · ${escapeHtml(view.organizationName)}`,
    "",
    `📅 <b>${escapeHtml(formatDate(view.bookingDate))}, ${escapeHtml(
      formatTimeForInput(view.startTime)
    )}–${escapeHtml(formatTimeForInput(view.endTime))}</b>`,
    `💼 ${escapeHtml(view.serviceName)}`,
    `👤 Мастер: ${escapeHtml(view.staffName)}`,
    "",
    `🙋 ${escapeHtml(view.clientName)}`,
  ];

  if (view.clientPhone) lines.push(`📞 ${escapeHtml(view.clientPhone)}`);
  if (view.clientEmail) lines.push(`✉️ ${escapeHtml(view.clientEmail)}`);
  if (view.clientComment) lines.push(`💬 <i>${escapeHtml(view.clientComment)}</i>`);

  lines.push("");
  if (view.reference) lines.push(`🔖 ${escapeHtml(view.reference)}`);
  lines.push(`Статус: ${STATUS_LABELS[view.status] || escapeHtml(view.status)}`);

  return lines.join("\n");
}

function bookingKeyboard(bookingId, status) {
  if (status !== "pending") return { inline_keyboard: [] };
  return {
    inline_keyboard: [
      [
        { text: "✅ Подтвердить", callback_data: `bk:confirm:${bookingId}` },
        { text: "❌ Отклонить", callback_data: `bk:reject:${bookingId}` },
      ],
    ],
  };
}

function viewFromBookingRow(row) {
  return {
    organizationName: row.organizations?.public_name || row.organizations?.name || "",
    serviceName: row.services?.name || "",
    staffName: row.staff?.name || "",
    bookingDate: row.booking_date,
    startTime: row.start_time,
    endTime: row.end_time,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    clientEmail: row.client_email,
    clientComment: row.client_comment,
    reference: row.public_reference,
    status: row.status,
  };
}

function parseCallbackData(data) {
  const match = String(data || "").match(CALLBACK_PATTERN);
  if (!match || !UUID_PATTERN.test(match[2])) return null;
  return { action: match[1].toLowerCase(), bookingId: match[2].toLowerCase() };
}

function parseCommand(text) {
  const match = String(text || "").trim().match(COMMAND_PATTERN);
  if (!match) return null;
  return { command: match[1].toLowerCase(), args: String(match[2] || "").trim() };
}

function generateLinkToken() {
  return crypto.randomBytes(16).toString("hex");
}

// -----------------------------------------------------------------------------
// Уведомления
// -----------------------------------------------------------------------------

/**
 * Отправляет сотруднику уведомление о новой записи. Никогда не бросает.
 */
async function notifyNewBooking({ organization, service, staff, booking, client }) {
  try {
    if (!isEnabled() || !staff?.telegram_chat_id || !booking?.id) return;

    const text = formatBookingMessage({
      organizationName: organization.public_name || organization.name,
      serviceName: service.name,
      staffName: staff.name,
      bookingDate: booking.booking_date,
      startTime: booking.start_time,
      endTime: booking.end_time,
      clientName: client.client_name,
      clientPhone: client.client_phone,
      clientEmail: client.client_email,
      clientComment: client.client_comment,
      reference: booking.public_reference,
      status: booking.status,
    });

    await sendMessage(staff.telegram_chat_id, text, {
      reply_markup: bookingKeyboard(booking.id, booking.status),
    });
  } catch (error) {
    logTelegramError("notifyNewBooking", error);

    // Пользователь заблокировал бота / удалил чат — отвязываем, чтобы не слать впустую.
    if (error?.code === 403 && staff?.id) {
      try {
        await getSupabaseAdmin()
          .from("staff")
          .update({ telegram_chat_id: null })
          .eq("id", staff.id)
          .eq("telegram_chat_id", staff.telegram_chat_id);
      } catch {
        // ignore
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Входящие обновления (webhook)
// -----------------------------------------------------------------------------

const HELP_TEXT = [
  "🤖 <b>Bookly</b> — уведомления о записях.",
  "",
  "Чтобы подключить уведомления, откройте кабинет Bookly → «Сотрудники» → «Telegram» и перейдите по ссылке.",
  "",
  "/stop — отключить уведомления в этом чате",
].join("\n");

async function linkStaff(chatId, token) {
  if (!LINK_TOKEN_PATTERN.test(token)) {
    return "❌ Ссылка недействительна. Откройте свежую ссылку в кабинете Bookly.";
  }

  const supabase = getSupabaseAdmin();
  const { data: staff, error } = await supabase
    .from("staff")
    .select("id, name, organizations(name, public_name)")
    .eq("telegram_link_token", token)
    .maybeSingle();

  if (error) {
    logTelegramError("linkStaff:select", error);
    return "⚠️ Не удалось привязать аккаунт. Попробуйте позже.";
  }

  if (!staff) {
    return "❌ Ссылка недействительна или уже использована. Откройте свежую ссылку в кабинете Bookly.";
  }

  // Ссылка одноразовая: после привязки токен меняется.
  const { error: updateError } = await supabase
    .from("staff")
    .update({ telegram_chat_id: String(chatId), telegram_link_token: generateLinkToken() })
    .eq("id", staff.id)
    .eq("telegram_link_token", token);

  if (updateError) {
    logTelegramError("linkStaff:update", updateError);
    return "⚠️ Не удалось привязать аккаунт. Попробуйте позже.";
  }

  const orgName = staff.organizations?.public_name || staff.organizations?.name || "Bookly";
  return [
    `✅ Готово, ${escapeHtml(staff.name)}!`,
    `Уведомления о новых записях в «${escapeHtml(orgName)}» будут приходить сюда.`,
    "",
    "/stop — отключить уведомления",
  ].join("\n");
}

async function unlinkChat(chatId) {
  const { data, error } = await getSupabaseAdmin()
    .from("staff")
    .update({ telegram_chat_id: null })
    .eq("telegram_chat_id", String(chatId))
    .select("id");

  if (error) {
    logTelegramError("unlinkChat", error);
    return "⚠️ Не удалось отключить уведомления. Попробуйте позже.";
  }

  if (!data?.length) {
    return "К этому чату не привязан ни один сотрудник.";
  }

  return "🔕 Уведомления отключены. Чтобы включить снова, используйте ссылку из кабинета Bookly.";
}

async function handleMessage(message) {
  const chatId = message.chat?.id;
  if (!chatId) return;

  // Данные клиентов отправляем только в личные чаты.
  if (message.chat.type !== "private") return;

  const parsed = parseCommand(message.text);
  let reply = HELP_TEXT;

  if (parsed?.command === "start" && parsed.args) {
    reply = await linkStaff(chatId, parsed.args);
  } else if (parsed?.command === "stop") {
    reply = await unlinkChat(chatId);
  }

  await sendMessage(chatId, reply);
}

async function handleCallback(callbackQuery) {
  const { id: callbackId, data, message } = callbackQuery;
  const chatId = message?.chat?.id;
  const parsed = parseCallbackData(data);

  if (!parsed || !chatId) {
    await answerCallback(callbackId, "Неизвестное действие");
    return;
  }

  const supabase = getSupabaseAdmin();

  const [staffResult, bookingResult] = await Promise.all([
    supabase.from("staff").select("id").eq("telegram_chat_id", String(chatId)),
    supabase.from("bookings").select(BOOKING_SELECT).eq("id", parsed.bookingId).maybeSingle(),
  ]);

  if (staffResult.error || bookingResult.error) {
    logTelegramError("handleCallback:select", staffResult.error || bookingResult.error);
    await answerCallback(callbackId, "Не удалось выполнить действие. Попробуйте позже", true);
    return;
  }

  const linkedStaffIds = (staffResult.data || []).map((row) => row.id);
  const booking = bookingResult.data;

  // Действовать можно только с записями сотрудника, привязанного к этому чату.
  if (!booking || !linkedStaffIds.includes(booking.staff_id)) {
    await answerCallback(callbackId, "Запись не найдена или недоступна", true);
    await editMessage(chatId, message.message_id, message.text ? escapeHtml(message.text) : "Запись недоступна");
    return;
  }

  if (booking.status !== "pending") {
    await answerCallback(callbackId, `Запись уже обработана: ${STATUS_LABELS[booking.status] || booking.status}`);
    await editMessage(chatId, message.message_id, formatBookingMessage(viewFromBookingRow(booking)));
    return;
  }

  const nextStatus = parsed.action === "confirm" ? "confirmed" : "canceled";

  const { data: updated, error: updateError } = await supabase
    .from("bookings")
    .update({ status: nextStatus })
    .eq("id", booking.id)
    .eq("status", "pending")
    .select("status")
    .maybeSingle();

  if (updateError) {
    const subscriptionError = mapSubscriptionError(updateError);
    if (!subscriptionError) logTelegramError("handleCallback:update", updateError);
    await answerCallback(
      callbackId,
      subscriptionError
        ? "Подписка организации неактивна — изменить запись нельзя"
        : "Не удалось изменить запись. Попробуйте позже",
      true
    );
    return;
  }

  // Статус успели изменить параллельно (в кабинете или другим нажатием).
  if (!updated) {
    const { data: fresh } = await supabase
      .from("bookings")
      .select(BOOKING_SELECT)
      .eq("id", booking.id)
      .maybeSingle();
    const current = fresh || booking;
    await answerCallback(callbackId, `Запись уже обработана: ${STATUS_LABELS[current.status] || current.status}`);
    await editMessage(chatId, message.message_id, formatBookingMessage(viewFromBookingRow(current)));
    return;
  }

  booking.status = updated.status;
  await answerCallback(callbackId, nextStatus === "confirmed" ? "Запись подтверждена" : "Запись отклонена");
  await editMessage(chatId, message.message_id, formatBookingMessage(viewFromBookingRow(booking)));
}

async function handleUpdate(update) {
  if (update?.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

  if (update?.message?.text) {
    await handleMessage(update.message);
  }
}

module.exports = {
  init,
  isEnabled,
  isWebhookEnabled,
  verifyWebhookSecret,
  callApi,
  notifyNewBooking,
  handleUpdate,
  // для тестов
  escapeHtml,
  formatDate,
  formatBookingMessage,
  bookingKeyboard,
  parseCallbackData,
  parseCommand,
  generateLinkToken,
  STATUS_LABELS,
};
