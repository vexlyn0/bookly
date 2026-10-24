/**
 * Telegram-бот Jazyl
 *
 *   - уведомление сотрудника о новой онлайн-записи;
 *   - привязка сотрудника: /start <telegram_link_token> (ссылка из кабинета);
 *   - привязка владельца: /start o_<owner_telegram_link_token> (раздел «Уведомления»):
 *     оплаты Kaspi и, по настройке, копии новых записей, отмен и переносов клиентом;
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
const phoneVerification = require("./phone-verification-service");

const API_BASE = "https://api.telegram.org";
const REQUEST_TIMEOUT_MS = 8000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const OWNER_START_PATTERN = /^o_([0-9a-f]{32})$/;
const CALLBACK_PATTERN = /^bk:(confirm|reject|done|sum|noshow):([0-9a-f-]{36})$/i;
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
  organization_id,
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
  manage_token,
  client_phone_key,
  client_telegram_chat_id,
  services(name),
  staff(name),
  organizations(name, public_name, address, timezone, owner_telegram_chat_id)
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
 * @param {object} [options]
 * @param {string} [options.title]       заголовок (HTML), по умолчанию «Новая запись»
 * @param {string} [options.before]      прежние дата/время при переносе (текст)
 * @param {boolean} [options.showStatus] показывать строку статуса
 */
function formatBookingMessage(view, { title = "🔔 <b>Новая запись</b>", before = "", showStatus = true } = {}) {
  const lines = [`${title} · ${escapeHtml(view.organizationName)}`, ""];

  if (before) lines.push(`Было: <s>${escapeHtml(before)}</s>`);

  lines.push(
    `📅 <b>${escapeHtml(formatDate(view.bookingDate))}, ${escapeHtml(
      formatTimeForInput(view.startTime)
    )}–${escapeHtml(formatTimeForInput(view.endTime))}</b>`,
    `💼 ${escapeHtml(view.serviceName)}`,
    `👤 Мастер: ${escapeHtml(view.staffName)}`,
    "",
    `🙋 ${escapeHtml(view.clientName)}`
  );

  if (view.clientPhone) lines.push(`📞 ${escapeHtml(view.clientPhone)}`);
  if (view.clientEmail) lines.push(`✉️ ${escapeHtml(view.clientEmail)}`);
  if (view.clientComment) lines.push(`💬 <i>${escapeHtml(view.clientComment)}</i>`);

  if (view.reference || showStatus) lines.push("");
  if (view.reference) lines.push(`🔖 ${escapeHtml(view.reference)}`);
  if (showStatus) lines.push(`Статус: ${STATUS_LABELS[view.status] || escapeHtml(view.status)}`);

  return lines.join("\n");
}

const ACTIVE_STATUSES = new Set(["pending", "confirmed"]);

/**
 * Кому и что сообщить после изменения записи в кабинете.
 *
 * @param {object} input
 * @param {"created"|"updated"|"deleted"} input.event
 * @param {object|null} input.booking   запись после изменения (нет для deleted)
 * @param {object|null} input.previous  запись до изменения (нет для created)
 * @returns {{ staffId: string, kind: "new"|"rescheduled"|"canceled"|"reassigned"|"deleted" }[]}
 */
function planBookingChangeNotifications({ event, booking, previous }) {
  if (event === "created") {
    return booking && ACTIVE_STATUSES.has(booking.status)
      ? [{ staffId: booking.staff_id, kind: "new" }]
      : [];
  }

  if (event === "deleted") {
    return previous && ACTIVE_STATUSES.has(previous.status)
      ? [{ staffId: previous.staff_id, kind: "deleted" }]
      : [];
  }

  if (event !== "updated" || !booking || !previous) return [];

  const wasActive = ACTIVE_STATUSES.has(previous.status);
  const isActive = ACTIVE_STATUSES.has(booking.status);

  if (wasActive && booking.status === "canceled") {
    return [{ staffId: previous.staff_id, kind: "canceled" }];
  }

  // Отменённую запись вернули — для мастера это новая запись.
  if (!wasActive && isActive) {
    return [{ staffId: booking.staff_id, kind: "new" }];
  }

  if (!wasActive || !isActive) return [];

  if (previous.staff_id !== booking.staff_id) {
    return [
      { staffId: previous.staff_id, kind: "reassigned" },
      { staffId: booking.staff_id, kind: "new" },
    ];
  }

  const timeChanged =
    String(previous.booking_date) !== String(booking.booking_date) ||
    formatTimeForInput(previous.start_time) !== formatTimeForInput(booking.start_time);

  return timeChanged ? [{ staffId: booking.staff_id, kind: "rescheduled" }] : [];
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
 * Отправляет сотруднику (и копию владельцу) уведомление о новой записи. Никогда не бросает.
 */
async function notifyNewBooking({ organization, service, staff, booking, client }) {
  try {
    if (!isEnabled() || !booking?.id) return;

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

    const extra = { reply_markup: bookingKeyboard(booking.id, booking.status) };
    if (staff?.telegram_chat_id) await sendToStaff(staff, text, extra);

    // Копия владельцу (если он не этот же мастер в том же чате).
    const owner = await loadOwner(organization.id);
    if (owner?.owner_notify_bookings && !sameChat(owner.owner_telegram_chat_id, staff?.telegram_chat_id)) {
      await sendToOwner(owner, text, extra);
    }
  } catch (error) {
    logTelegramError("notifyNewBooking", error);
  }
}

function sameChat(a, b) {
  return Boolean(a) && String(a) === String(b || "");
}

/** Telegram владельца и его настройки уведомлений. null — не подключён. Никогда не бросает. */
async function loadOwner(organizationId) {
  if (!isEnabled() || !organizationId) return null;
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("organizations")
      .select("id, owner_telegram_chat_id, owner_notify_bookings, owner_notify_changes")
      .eq("id", organizationId)
      .maybeSingle();
    if (error) throw error;
    return data?.owner_telegram_chat_id ? data : null;
  } catch (error) {
    logTelegramError("loadOwner", error);
    return null;
  }
}

/**
 * Сообщение владельцу салона. owner — строка organizations с id и owner_telegram_chat_id.
 * Возвращает true при успехе, никогда не бросает.
 */
async function sendToOwner(owner, text, extra = {}) {
  if (!isEnabled() || !owner?.owner_telegram_chat_id) return false;

  try {
    await sendMessage(owner.owner_telegram_chat_id, text, extra);
    return true;
  } catch (error) {
    logTelegramError("sendToOwner", error);

    if (error?.code === 403 && owner?.id) {
      try {
        await getSupabaseAdmin()
          .from("organizations")
          .update({ owner_telegram_chat_id: null })
          .eq("id", owner.id)
          .eq("owner_telegram_chat_id", owner.owner_telegram_chat_id);
      } catch {
        // ignore
      }
    }
    return false;
  }
}

/**
 * Отправляет сообщение привязанному сотруднику. Возвращает true при успехе, никогда не бросает.
 */
async function sendToStaff(staff, text, extra = {}) {
  if (!isEnabled() || !staff?.telegram_chat_id) return false;

  try {
    await sendMessage(staff.telegram_chat_id, text, extra);
    return true;
  } catch (error) {
    logTelegramError("sendToStaff", error);

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
    return false;
  }
}

// -----------------------------------------------------------------------------
// Входящие обновления (webhook)
// -----------------------------------------------------------------------------

const HELP_TEXT = [
  "🤖 <b>Jazyl</b> — онлайн-запись.",
  "",
  "<b>Клиентам:</b> поделитесь номером телефона — и здесь будут ваши записи, изменения и напоминания. Кнопка «📋 Мои записи» покажет предстоящие визиты.",
  "",
  "<b>Мастерам:</b> чтобы получать записи, откройте ссылку из кабинета Jazyl (раздел «Сотрудники» → «Telegram»).",
  "",
  "<b>Владельцу салона:</b> оплаты Kaspi и копии записей — кабинет Jazyl → «Уведомления» → «Подключить Telegram».",
  "",
  "/stop — отключить уведомления салона в этом чате",
].join("\n");

/** Ленивая загрузка: client-bot-service сам зависит от telegram-service. */
function clientBot() {
  return require("./client-bot-service");
}

function visitCheck() {
  return require("./visit-check-service");
}

function adminBot() {
  return require("./admin-bot-service");
}

async function linkStaff(chatId, token) {
  if (!LINK_TOKEN_PATTERN.test(token)) {
    return "❌ Ссылка недействительна. Откройте свежую ссылку в кабинете Jazyl.";
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
    return "❌ Ссылка недействительна или уже использована. Откройте свежую ссылку в кабинете Jazyl.";
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

  const orgName = staff.organizations?.public_name || staff.organizations?.name || "Jazyl";
  return [
    `✅ Готово, ${escapeHtml(staff.name)}!`,
    `Уведомления о записях (новые, переносы, отмены) в «${escapeHtml(orgName)}» будут приходить сюда.`,
    "",
    "/stop — отключить уведомления",
  ].join("\n");
}

async function linkOwner(chatId, token) {
  const supabase = getSupabaseAdmin();
  const { data: org, error } = await supabase
    .from("organizations")
    .select("id, name, public_name")
    .eq("owner_telegram_link_token", token)
    .maybeSingle();

  if (error) {
    logTelegramError("linkOwner:select", error);
    return "⚠️ Не удалось подключить Telegram. Попробуйте позже.";
  }

  if (!org) {
    return "❌ Ссылка недействительна или уже использована. Откройте свежую ссылку в кабинете Jazyl → «Уведомления».";
  }

  // Ссылка одноразовая: после привязки токен меняется.
  const { error: updateError } = await supabase
    .from("organizations")
    .update({ owner_telegram_chat_id: String(chatId), owner_telegram_link_token: generateLinkToken() })
    .eq("id", org.id)
    .eq("owner_telegram_link_token", token);

  if (updateError) {
    logTelegramError("linkOwner:update", updateError);
    return "⚠️ Не удалось подключить Telegram. Попробуйте позже.";
  }

  const orgName = org.public_name || org.name || "Jazyl";
  return [
    `✅ Готово! Этот чат подключён как Telegram владельца «${escapeHtml(orgName)}».`,
    "",
    "Сюда будут приходить:",
    "💳 оплаты Kaspi — с кнопками «Деньги пришли» / «Не пришли»;",
    "🔔 новые записи по всем мастерам;",
    "❌ отмены и переносы клиентами.",
    "",
    "Что присылать, можно выбрать в кабинете → «Уведомления».",
    "/stop — отключить",
  ].join("\n");
}

async function unlinkChat(chatId) {
  const supabase = getSupabaseAdmin();
  const [staffResult, ownerResult] = await Promise.all([
    supabase.from("staff").update({ telegram_chat_id: null }).eq("telegram_chat_id", String(chatId)).select("id"),
    supabase
      .from("organizations")
      .update({ owner_telegram_chat_id: null })
      .eq("owner_telegram_chat_id", String(chatId))
      .select("id"),
  ]);

  const error = staffResult.error || ownerResult.error;
  if (error) {
    logTelegramError("unlinkChat", error);
    return "⚠️ Не удалось отключить уведомления. Попробуйте позже.";
  }

  // Чат администратора платформы (заявки на оплату Pro)
  let adminUnlinked = false;
  try {
    adminUnlinked = await adminBot().unlinkChat(chatId);
  } catch (adminError) {
    logTelegramError("unlinkChat:admin", adminError);
  }

  if (!staffResult.data?.length && !ownerResult.data?.length && !adminUnlinked) {
    return "К этому чату не привязан ни мастер, ни владелец салона.";
  }

  return "🔕 Уведомления отключены. Чтобы включить снова, используйте ссылку из кабинета Jazyl.";
}

const SHARE_PHONE_KEYBOARD = {
  keyboard: [[{ text: "📱 Поделиться номером", request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

const SHARE_PHONE_KEYBOARD_WITH_LIST = {
  keyboard: [[{ text: "📋 Мои записи" }], [{ text: "📱 Поделиться номером", request_contact: true }]],
  resize_keyboard: true,
};

/** /start v_<token> — клиент пришёл подтвердить номер для онлайн-записи. */
async function startPhoneVerification(chatId, token) {
  let verification = null;
  try {
    verification = await phoneVerification.attachChat(token, chatId);
  } catch (error) {
    logTelegramError("startPhoneVerification", error);
  }

  if (!verification) {
    await sendMessage(
      chatId,
      "⌛ Ссылка устарела. Вернитесь на страницу записи и нажмите «Подтвердить номер» ещё раз."
    );
    return;
  }

  const orgName = verification.organizations?.public_name || verification.organizations?.name || "";
  await sendMessage(
    chatId,
    [
      `📲 Подтверждение номера для записи${orgName ? ` в «${escapeHtml(orgName)}»` : ""}.`,
      "",
      "Нажмите кнопку <b>«Поделиться номером»</b> внизу 👇",
    ].join("\n"),
    { reply_markup: SHARE_PHONE_KEYBOARD }
  );
}

/** Клиент поделился контактом — сверяем с заявкой. */
async function handleContact(message) {
  const chatId = message.chat.id;
  const contact = message.contact;

  // Только собственный контакт: чужой номер из записной книжки не принимаем.
  if (!contact?.user_id || contact.user_id !== message.from?.id) {
    await sendMessage(chatId, "Отправьте свой номер кнопкой «📱 Поделиться номером».", {
      reply_markup: SHARE_PHONE_KEYBOARD,
    });
    return;
  }

  let result = "none";
  try {
    result = await phoneVerification.confirmContact(chatId, contact.phone_number);
  } catch (error) {
    logTelegramError("handleContact", error);
    await sendMessage(chatId, "⚠️ Не удалось проверить номер. Попробуйте ещё раз.");
    return;
  }

  const removeKeyboard = { reply_markup: { remove_keyboard: true } };

  if (result === "none") {
    // Не подтверждение записи — клиент просто подключает бота.
    await clientBot().handleSharedContact(chatId, message.from?.id, contact.phone_number);
    return;
  }

  if (result === "verified") {
    await clientBot().linkClient(chatId, message.from?.id, contact.phone_number);
    await sendMessage(
      chatId,
      "✅ Номер подтверждён!\n\nВернитесь на страницу записи — она завершится автоматически. Сюда придёт подтверждение записи.",
      { reply_markup: clientBot().CLIENT_KEYBOARD }
    );
  } else if (result === "mismatch") {
    await sendMessage(
      chatId,
      "❌ Номер этого Telegram не совпадает с номером, указанным в записи.\n\nВернитесь на страницу записи и укажите номер, к которому привязан ваш Telegram.",
      removeKeyboard
    );
  }
}

/** Подтверждение записи клиенту (если номер подтверждён через бота). Никогда не бросает. */
async function sendClientBookingConfirmation(chatId, view, manageUrl) {
  if (!isEnabled() || !chatId) return;
  const lines = [
    `✅ <b>Вы записаны</b> · ${escapeHtml(view.organizationName)}`,
    "",
    `📅 <b>${escapeHtml(formatDate(view.bookingDate))}, ${escapeHtml(formatTimeForInput(view.startTime))}–${escapeHtml(
      formatTimeForInput(view.endTime)
    )}</b>`,
    `💼 ${escapeHtml(view.serviceName)}`,
    `👤 Мастер: ${escapeHtml(view.staffName)}`,
  ];
  if (view.status === "pending") lines.push("", "⏳ Салон подтвердит запись.");
  if (manageUrl) lines.push("", `Перенести или отменить: ${escapeHtml(manageUrl)}`);

  try {
    await sendMessage(chatId, lines.join("\n"));
  } catch (error) {
    logTelegramError("sendClientBookingConfirmation", error);
  }
}

async function handleMessage(message) {
  const chatId = message.chat?.id;
  if (!chatId) return;

  // Данные клиентов отправляем только в личные чаты.
  if (message.chat.type !== "private") return;

  if (message.contact) {
    await handleContact(message);
    return;
  }

  const parsed = parseCommand(message.text);
  let reply = HELP_TEXT;

  if (message.text?.trim() === clientBot().MY_BOOKINGS_TEXT || parsed?.command === "my") {
    await clientBot().showMyBookings(chatId);
    return;
  }

  // Мастер нажал «Другая сумма» и прислал число.
  if (!parsed && message.text && (await visitCheck().handleAmountMessage(chatId, message.text))) {
    return;
  }

  if (parsed?.command === "start" && /^v_[0-9a-f]{32}$/.test(parsed.args)) {
    await startPhoneVerification(chatId, parsed.args.slice(2));
    return;
  }

  // Администратор платформы: заявки на оплату Pro
  if (parsed?.command === "pay" && (await adminBot().showPending(chatId))) {
    return;
  }

  const adminStart = parsed?.command === "start" ? parsed.args.match(adminBot().START_PATTERN) : null;
  const ownerStart = parsed?.command === "start" ? parsed.args.match(OWNER_START_PATTERN) : null;

  if (adminStart) {
    reply = await adminBot().link(chatId, adminStart[1]);
  } else if (ownerStart) {
    reply = await linkOwner(chatId, ownerStart[1]);
  } else if (parsed?.command === "start" && parsed.args) {
    reply = await linkStaff(chatId, parsed.args);
  } else if (parsed?.command === "stop") {
    reply = await unlinkChat(chatId);
  } else {
    // Приветствие / непонятный текст: подсказка и кнопки для клиентов.
    await sendMessage(chatId, reply, { reply_markup: SHARE_PHONE_KEYBOARD_WITH_LIST });
    return;
  }

  await sendMessage(chatId, reply);
}

async function handleCallback(callbackQuery) {
  if (String(callbackQuery?.data || "").startsWith("cl:")) {
    await clientBot().handleClientCallback(callbackQuery);
    return;
  }

  if (String(callbackQuery?.data || "").startsWith("sub:")) {
    await adminBot().handleCallback({
      callbackId: callbackQuery.id,
      chatId: callbackQuery.message?.chat?.id,
      messageId: callbackQuery.message?.message_id,
      data: callbackQuery.data,
    });
    return;
  }

  if (String(callbackQuery?.data || "").startsWith("pp:")) {
    await require("./prepay-service").handleCallback({
      callbackId: callbackQuery.id,
      chatId: callbackQuery.message?.chat?.id,
      messageId: callbackQuery.message?.message_id,
      data: callbackQuery.data,
    });
    return;
  }

  const { id: callbackId, data, message } = callbackQuery;
  const chatId = message?.chat?.id;
  const parsed = parseCallbackData(data);

  if (!parsed || !chatId) {
    await answerCallback(callbackId, "Неизвестное действие");
    return;
  }

  if (["done", "sum", "noshow"].includes(parsed.action)) {
    await visitCheck().handleVisitCallback({
      callbackId,
      chatId,
      messageId: message.message_id,
      action: parsed.action,
      bookingId: parsed.bookingId,
    });
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

  // Действовать можно только с записями мастера, привязанного к этому чату, или владельцу салона.
  const allowed =
    booking &&
    (linkedStaffIds.includes(booking.staff_id) || sameChat(booking.organizations?.owner_telegram_chat_id, chatId));
  if (!allowed) {
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

  const previous = { ...booking, status: "pending" };
  booking.status = updated.status;
  await answerCallback(callbackId, nextStatus === "confirmed" ? "Запись подтверждена" : "Запись отклонена");
  await editMessage(chatId, message.message_id, formatBookingMessage(viewFromBookingRow(booking)));

  // Клиенту в Telegram (если он подключён): «подтверждена» / «отменена салоном».
  await clientBot().notifyClientOfChange({
    organization: booking.organizations || {},
    event: "updated",
    booking,
    previous,
  });
}

async function handleUpdate(update) {
  if (update?.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

  if (update?.message?.text || update?.message?.contact) {
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
  sendToStaff,
  sendToOwner,
  loadOwner,
  sameChat,
  sendClientBookingConfirmation,
  sendMessage,
  editMessage,
  answerCallback,
  logTelegramError,
  SHARE_PHONE_KEYBOARD,
  handleUpdate,
  planBookingChangeNotifications,
  viewFromBookingRow,
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
