/**
 * Валидация данных публичной записи
 */

const MAX_NAME = 100;
const MAX_PHONE = 30;
const MAX_EMAIL = 150;
const MAX_COMMENT = 500;
const PHONE_PATTERN = /^[+0-9()\-\s]{7,30}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

const FORBIDDEN_FIELDS = [
  "organization_id",
  "organizationId",
  "public_reference",
  "status",
  "source",
  "end_time",
  "endTime",
  "id",
  "created_at",
  "updated_at",
];

function validationError(message, code = "VALIDATION_ERROR") {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  return error;
}

function validatePublicBookingPayload(body = {}) {
  const errors = [];

  for (const field of FORBIDDEN_FIELDS) {
    if (body[field] !== undefined && body[field] !== null && body[field] !== "") {
      errors.push(`${field} нельзя передавать в запросе`);
    }
  }

  const clientName = String(body.client_name || "").trim();
  const clientPhone = String(body.client_phone || "").trim();
  const clientEmail = body.client_email == null ? "" : String(body.client_email).trim();
  const clientComment = body.client_comment == null ? "" : String(body.client_comment).trim();
  const serviceId = String(body.service_id || "").trim();
  const staffId = String(body.staff_id || "").trim();
  const bookingDate = String(body.booking_date || "").trim();
  const startTime = String(body.start_time || "").trim().slice(0, 5);

  if (!serviceId) errors.push("service_id обязателен");
  if (!staffId) errors.push("staff_id обязателен");
  if (!bookingDate || !DATE_PATTERN.test(bookingDate)) errors.push("booking_date обязателен");
  if (!startTime || !TIME_PATTERN.test(startTime)) errors.push("start_time обязателен");

  if (clientName.length < 2 || clientName.length > MAX_NAME) {
    errors.push("client_name должен содержать от 2 до 100 символов");
  }

  if (clientPhone.length < 7 || clientPhone.length > MAX_PHONE || !PHONE_PATTERN.test(clientPhone)) {
    errors.push("client_phone должен содержать от 7 до 30 символов");
  }

  if (clientEmail) {
    if (clientEmail.length > MAX_EMAIL || !EMAIL_PATTERN.test(clientEmail)) {
      errors.push("client_email некорректен");
    }
  }

  if (clientComment.length > MAX_COMMENT) {
    errors.push("client_comment слишком длинный");
  }

  if (errors.length) {
    throw validationError(errors.join("; "), "VALIDATION_ERROR");
  }

  return {
    service_id: serviceId,
    staff_id: staffId,
    booking_date: bookingDate,
    start_time: startTime,
    client_name: clientName,
    client_phone: clientPhone,
    client_email: clientEmail || null,
    client_comment: clientComment || null,
  };
}

module.exports = {
  validatePublicBookingPayload,
  validationError,
};
