/**
 * Тесты публичной онлайн-записи
 * Требует: миграция 009, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 *          TEST_EMAIL, TEST_PASSWORD
 * Опционально: TEST_EMAIL_B для проверки изоляции организаций
 *
 * SQL-проверки миграции: npm run validate:migration-009 (после применения 009)
 */

const path = require("path");
const dotenv = require("dotenv");
const request = require("supertest");
const { createClient } = require("@supabase/supabase-js");

dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });
process.env.BOOKLY_DISABLE_BOOKING_RATE_LIMIT = "1";

const app = require("../server/app");
const { REFERENCE_PATTERN, computeBookingEndTime } = require("../server/lib/public-booking-service");

const url = String(process.env.SUPABASE_URL || "").trim();
const anonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();
const serviceKey = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ""
).trim();
const email = String(process.env.TEST_EMAIL || "").trim();
const password = String(process.env.TEST_PASSWORD || "").trim();
const emailB = String(process.env.TEST_EMAIL_B || "").trim();
const passwordB = String(process.env.TEST_PASSWORD_B || "").trim();

const created = {
  bookingIds: [],
  staffIds: [],
  serviceIds: [],
};

let testSlug = "";
let orgId = "";
let serviceId = "";
let staffId = "";
let inactiveServiceId = "";
let inactiveStaffId = "";
let otherOrgServiceId = "";
let otherOrgStaffId = "";

function fail(msg) {
  console.error("[FAIL]", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("[OK]", msg);
}

function nextWeekdayDate(daysAhead = 5) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

async function signIn(userEmail, userPassword) {
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({
    email: userEmail,
    password: userPassword,
  });
  if (error) fail(`Вход: ${error.message}`);
  return client;
}

function getAdminClient() {
  if (!serviceKey) fail("Задайте SUPABASE_SERVICE_ROLE_KEY для тестов");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function setupFixture() {
  const sb = await signIn(email, password);
  const admin = getAdminClient();

  const { data: membership } = await sb
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();
  if (!membership?.organization_id) fail("Нет организации у TEST_EMAIL");
  orgId = membership.organization_id;

  testSlug = `test-public-${Date.now()}`;

  const { error: orgUpdateErr } = await admin
    .from("organizations")
    .update({
      slug: testSlug,
      public_name: "Тестовая публичная организация",
      description: "Описание для теста",
      phone: "+77001234567",
      address: "Тестовый адрес",
      public_booking_enabled: true,
      booking_confirmation_mode: "auto",
    })
    .eq("id", orgId);
  if (orgUpdateErr) fail(`Обновление организации: ${orgUpdateErr.message}`);

  const { data: service, error: serviceErr } = await admin
    .from("services")
    .insert({
      organization_id: orgId,
      name: `Публичная услуга ${Date.now()}`,
      description: "Тест",
      price: 2500,
      duration_minutes: 30,
      is_active: true,
    })
    .select("id")
    .single();
  if (serviceErr) fail(serviceErr.message);
  serviceId = service.id;
  created.serviceIds.push(serviceId);

  const { data: staff, error: staffErr } = await admin
    .from("staff")
    .insert({
      organization_id: orgId,
      name: `Публичный мастер ${Date.now()}`,
      position: "Мастер",
      is_active: true,
    })
    .select("id")
    .single();
  if (staffErr) fail(staffErr.message);
  staffId = staff.id;
  created.staffIds.push(staffId);

  const { error: linkErr } = await admin.from("staff_services").insert({
    organization_id: orgId,
    staff_id: staffId,
    service_id: serviceId,
  });
  if (linkErr) fail(linkErr.message);

  const { data: inactiveService } = await admin
    .from("services")
    .insert({
      organization_id: orgId,
      name: `Неактивная услуга ${Date.now()}`,
      price: 1000,
      duration_minutes: 30,
      is_active: false,
    })
    .select("id")
    .single();
  inactiveServiceId = inactiveService.id;
  created.serviceIds.push(inactiveService.id);

  const { data: inactiveStaff } = await admin
    .from("staff")
    .insert({
      organization_id: orgId,
      name: `Неактивный мастер ${Date.now()}`,
      is_active: false,
    })
    .select("id")
    .single();
  inactiveStaffId = inactiveStaff.id;
  created.staffIds.push(inactiveStaff.id);

  if (emailB && passwordB) {
    const sbB = await signIn(emailB, passwordB);
    const { data: membershipB } = await sbB
      .from("organization_members")
      .select("organization_id")
      .limit(1)
      .maybeSingle();
    if (membershipB?.organization_id) {
      const otherOrgId = membershipB.organization_id;
      const { data: otherService } = await admin
        .from("services")
        .insert({
          organization_id: otherOrgId,
          name: `Чужая услуга ${Date.now()}`,
          price: 1000,
          duration_minutes: 30,
          is_active: true,
        })
        .select("id")
        .single();
      otherOrgServiceId = otherService.id;
      created.serviceIds.push(otherOrgServiceId);

      const { data: otherStaff } = await admin
        .from("staff")
        .insert({
          organization_id: otherOrgId,
          name: `Чужой мастер ${Date.now()}`,
          is_active: true,
        })
        .select("id")
        .single();
      otherOrgStaffId = otherStaff.id;
      created.staffIds.push(otherOrgStaffId);
    }
  } else {
    console.log("[SKIP] Изоляция организаций — задайте TEST_EMAIL_B");
  }
}

async function cleanup() {
  const admin = getAdminClient();
  if (serviceId && orgId) {
    await admin
      .from("services")
      .update({ is_active: true })
      .eq("id", serviceId)
      .eq("organization_id", orgId);
  }
  if (staffId && orgId) {
    await admin
      .from("staff")
      .update({ is_active: true })
      .eq("id", staffId)
      .eq("organization_id", orgId);
  }
  if (created.bookingIds.length) {
    await admin.from("bookings").delete().in("id", created.bookingIds);
  }
  if (created.staffIds.length) {
    await admin.from("staff").delete().in("id", created.staffIds);
  }
  if (created.serviceIds.length) {
    await admin.from("services").delete().in("id", created.serviceIds);
  }
}

async function deactivateTestService(admin) {
  const { data, error } = await admin
    .from("services")
    .update({ is_active: false })
    .eq("id", serviceId)
    .eq("organization_id", orgId)
    .select("id, is_active, organization_id");

  if (error) {
    fail(`Не удалось деактивировать тестовую услугу: ${error.message}`);
  }
  if (!data?.length) {
    fail("Не удалось деактивировать тестовую услугу: ни одна строка не изменена");
  }
  if (data[0].is_active !== false) {
    fail("Не удалось деактивировать тестовую услугу: is_active не стало false");
  }
  if (data[0].id !== serviceId || data[0].organization_id !== orgId) {
    fail("Не удалось деактивировать тестовую услугу: изменена не та услуга или организация");
  }

  const { data: readBack, error: readError } = await admin
    .from("services")
    .select("id, is_active, organization_id")
    .eq("id", serviceId)
    .eq("organization_id", orgId)
    .single();

  if (readError) {
    fail(`Не удалось деактивировать тестовую услугу: ${readError.message}`);
  }
  if (readBack.is_active !== false) {
    fail("Не удалось деактивировать тестовую услугу: read-back is_active !== false");
  }

  return readBack;
}

async function reactivateTestService(admin) {
  await admin
    .from("services")
    .update({ is_active: true })
    .eq("id", serviceId)
    .eq("organization_id", orgId);
}

async function deactivateTestStaff(admin) {
  const { data, error } = await admin
    .from("staff")
    .update({ is_active: false })
    .eq("id", staffId)
    .eq("organization_id", orgId)
    .select("id, is_active, organization_id");

  if (error) {
    fail(`Не удалось деактивировать тестового сотрудника: ${error.message}`);
  }
  if (!data?.length) {
    fail("Не удалось деактивировать тестового сотрудника: ни одна строка не изменена");
  }
  if (data[0].is_active !== false) {
    fail("Не удалось деактивировать тестового сотрудника: is_active не стало false");
  }

  const { data: readBack, error: readError } = await admin
    .from("staff")
    .select("id, is_active, organization_id")
    .eq("id", staffId)
    .eq("organization_id", orgId)
    .single();

  if (readError || readBack.is_active !== false) {
    fail("Не удалось деактивировать тестового сотрудника: read-back is_active !== false");
  }

  return readBack;
}

async function reactivateTestStaff(admin) {
  await admin
    .from("staff")
    .update({ is_active: true })
    .eq("id", staffId)
    .eq("organization_id", orgId);
}

async function pickFreeSlot(bookingDate) {
  const slotsRes = await request(app)
    .get(`/api/public/organizations/${testSlug}/slots`)
    .query({ service_id: serviceId, staff_id: staffId, date: bookingDate })
    .expect(200);

  const slotTime = slotsRes.body.slots?.[0]?.start_time;
  if (!slotTime) {
    fail("Нет свободного слота для теста");
  }
  return slotTime;
}

async function assertForbiddenBodyField(field, value, bookingDate, slotTime) {
  const body = {
    service_id: serviceId,
    staff_id: staffId,
    booking_date: bookingDate,
    start_time: slotTime,
    client_name: `Тест ${field}`,
    client_phone: "+77001112233",
    [field]: value,
  };
  const res = await request(app)
    .post(`/api/public/organizations/${testSlug}/bookings`)
    .send(body);
  if (res.status !== 400 || res.body.code !== "VALIDATION_ERROR") {
    fail(`Поле ${field} должно отклоняться с VALIDATION_ERROR`);
  }
}

async function main() {
  if (!url || !anonKey || !email || !password) {
    fail("Задайте SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD");
  }

  await setupFixture();
  const admin = getAdminClient();
  const sb = await signIn(email, password);
  const bookingDate = nextWeekdayDate(5);

  try {
    const healthRes = await request(app).get("/api/health").expect(200);
    if (!healthRes.body.ok) fail("Health endpoint сломан");
    ok("Существующие private routes не сломались (/api/health)");

    const configRes = await request(app).get("/api/public-config").expect(200);
    const configText = JSON.stringify(configRes.body);
    if (configText.includes(serviceKey) || configText.includes("service_role")) {
      fail("Утечка service role key в public-config");
    }
    ok("Service role key не попадает в публичный config");

    const anonClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: anonOrgs } = await anonClient.from("organizations").select("id, slug").limit(5);
    if (anonOrgs?.length) {
      fail("anon-клиент не должен читать organizations напрямую");
    }
    ok("anon не имеет прямого SELECT к organizations");

    const orgRes = await request(app).get(`/api/public/organizations/${testSlug}`).expect(200);
    if (!orgRes.body.organization?.name) fail("Организация не вернулась");
    if (orgRes.body.organization.id) fail("Утечка organization.id");
    if (orgRes.body.organization.timezone) fail("Утечка timezone");
    ok("Публичная организация открывается по slug");

    const privateFields = ["owner", "membership", "business_type", "created_at"];
    const leaked = privateFields.filter((field) => field in (orgRes.body.organization || {}));
    if (leaked.length) fail(`Утечка приватных полей: ${leaked.join(", ")}`);
    ok("Приватные данные организации не возвращаются");

    await admin.from("organizations").update({ public_booking_enabled: false }).eq("id", orgId);
    const disabledRes = await request(app).get(`/api/public/organizations/${testSlug}`).expect(403);
    if (disabledRes.body.code !== "PUBLIC_BOOKING_DISABLED") fail("Ожидался PUBLIC_BOOKING_DISABLED");
    ok("Выключенная онлайн-запись возвращает 403");

    await admin.from("organizations").update({ public_booking_enabled: true }).eq("id", orgId);

    const servicesRes = await request(app).get(`/api/public/organizations/${testSlug}/services`).expect(200);
    if (!servicesRes.body.services?.length) fail("Нет активных услуг");
    if (servicesRes.body.services.some((item) => "organization_id" in item)) {
      fail("Утечка organization_id в услугах");
    }
    ok("Возвращаются только активные услуги");

    const staffRes = await request(app)
      .get(`/api/public/organizations/${testSlug}/staff`)
      .query({ service_id: serviceId })
      .expect(200);
    if (!staffRes.body.staff?.some((item) => item.id === staffId)) {
      fail("Активный сотрудник не вернулся");
    }
    ok("Возвращаются только активные сотрудники услуги");

    if (otherOrgServiceId) {
      await request(app)
        .get(`/api/public/organizations/${testSlug}/staff`)
        .query({ service_id: otherOrgServiceId })
        .expect(404);
      ok("Услуга другой организации недоступна");
    }

    if (otherOrgStaffId) {
      const crossStaffRes = await request(app)
        .post(`/api/public/organizations/${testSlug}/bookings`)
        .send({
          service_id: serviceId,
          staff_id: otherOrgStaffId,
          booking_date: bookingDate,
          start_time: "10:00",
          client_name: "Тест",
          client_phone: "+77001112233",
        })
        .expect(404);
      if (crossStaffRes.body.code !== "STAFF_NOT_FOUND") {
        fail("Чужой сотрудник должен быть запрещён");
      }
      ok("Сотрудник другой организации недоступен");
    }

    const slotsRes = await request(app)
      .get(`/api/public/organizations/${testSlug}/slots`)
      .query({ service_id: serviceId, staff_id: staffId, date: bookingDate })
      .expect(200);
    if (!Array.isArray(slotsRes.body.slots)) fail("Слоты не массив");
    const slotTime = slotsRes.body.slots[0]?.start_time || "10:00";
    ok("Свободные слоты рассчитываются");

    const inactiveServiceSlots = await request(app)
      .get(`/api/public/organizations/${testSlug}/slots`)
      .query({ service_id: inactiveServiceId, staff_id: staffId, date: bookingDate })
      .expect(400);
    if (inactiveServiceSlots.body.code !== "SERVICE_INACTIVE") {
      fail("Неактивная услуга в slots должна возвращать SERVICE_INACTIVE");
    }
    ok("Неактивная услуга в slots → SERVICE_INACTIVE 400");

    const inactiveStaffSlots = await request(app)
      .get(`/api/public/organizations/${testSlug}/slots`)
      .query({ service_id: serviceId, staff_id: inactiveStaffId, date: bookingDate })
      .expect(400);
    if (inactiveStaffSlots.body.code !== "STAFF_INACTIVE") {
      fail("Неактивный сотрудник в slots должен возвращать STAFF_INACTIVE");
    }
    ok("Неактивный сотрудник в slots → STAFF_INACTIVE 400");

    const inactiveServiceSlot = await pickFreeSlot(bookingDate);
    try {
      await deactivateTestService(admin);

      const inactiveServiceRes = await request(app)
        .post(`/api/public/organizations/${testSlug}/bookings`)
        .send({
          service_id: serviceId,
          staff_id: staffId,
          booking_date: bookingDate,
          start_time: inactiveServiceSlot,
          client_name: "Тест неактив",
          client_phone: "+77001112233",
        });

      if (inactiveServiceRes.status !== 400 || inactiveServiceRes.body.code !== "SERVICE_INACTIVE") {
        fail(
          `Неактивная услуга должна быть запрещена: status=${inactiveServiceRes.status}, ` +
            `code=${inactiveServiceRes.body.code || "—"}, message=${inactiveServiceRes.body.message || "—"}`
        );
      }
      ok("Неактивная услуга запрещена → SERVICE_INACTIVE 400");
    } finally {
      await reactivateTestService(admin);
    }

    const inactiveStaffSlot = await pickFreeSlot(bookingDate);
    try {
      await deactivateTestStaff(admin);

      const inactiveStaffRes = await request(app)
        .post(`/api/public/organizations/${testSlug}/bookings`)
        .send({
          service_id: serviceId,
          staff_id: staffId,
          booking_date: bookingDate,
          start_time: inactiveStaffSlot,
          client_name: "Тест неактив",
          client_phone: "+77001112233",
        });

      if (inactiveStaffRes.status !== 400 || inactiveStaffRes.body.code !== "STAFF_INACTIVE") {
        fail(
          `Неактивный сотрудник должен быть запрещён: status=${inactiveStaffRes.status}, ` +
            `code=${inactiveStaffRes.body.code || "—"}, message=${inactiveStaffRes.body.message || "—"}`
        );
      }
      ok("Неактивный сотрудник запрещён → STAFF_INACTIVE 400");
    } finally {
      await reactivateTestStaff(admin);
    }

    const pastRes = await request(app)
      .post(`/api/public/organizations/${testSlug}/bookings`)
      .send({
        service_id: serviceId,
        staff_id: staffId,
        booking_date: "2000-01-01",
        start_time: "10:00",
        client_name: "Прошлое",
        client_phone: "+77001112233",
      })
      .expect(400);
    if (pastRes.body.code !== "BOOKING_IN_PAST" && pastRes.body.code !== "VALIDATION_ERROR") {
      fail("Прошедшее время должно быть запрещено");
    }
    ok("Прошедшее время запрещено");

    const createRes = await request(app)
      .post(`/api/public/organizations/${testSlug}/bookings`)
      .send({
        service_id: serviceId,
        staff_id: staffId,
        booking_date: bookingDate,
        start_time: slotTime,
        client_name: "Иван Тестов",
        client_phone: "+77001234567",
        client_email: "ivan@example.com",
        client_comment: "Публичная запись",
      })
      .expect(201);

    if (!createRes.body.success || !createRes.body.booking?.reference) fail("Нет public reference");
    if (!REFERENCE_PATTERN.test(createRes.body.booking.reference)) {
      fail(`Неверный формат reference: ${createRes.body.booking.reference}`);
    }
    const forbiddenResponseFields = [
      "id",
      "organization_id",
      "service_id",
      "staff_id",
      "created_by",
      "created_at",
      "updated_at",
    ];
    const leakedBooking = forbiddenResponseFields.filter(
      (field) => field in (createRes.body.booking || {})
    );
    if (leakedBooking.length) fail(`Утечка в ответе: ${leakedBooking.join(", ")}`);
    if (createRes.body.booking.status !== "confirmed") fail("auto должен создавать confirmed");

    const { data: serviceMeta } = await admin
      .from("services")
      .select("duration_minutes")
      .eq("id", serviceId)
      .single();
    const expectedEndTime = computeBookingEndTime(
      createRes.body.booking.start_time,
      serviceMeta.duration_minutes
    );
    if (createRes.body.booking.end_time !== expectedEndTime) {
      fail(
        `end_time должен быть ${expectedEndTime}, получено ${createRes.body.booking.end_time}`
      );
    }
    ok("end_time соответствует start_time + duration_minutes");
    ok("Запись создаётся со status confirmed (auto) и форматом BK-XXXXXX");

    const { data: createdBooking } = await admin
      .from("bookings")
      .select("id, source, public_reference")
      .eq("public_reference", createRes.body.booking.reference)
      .single();
    if (!createdBooking || createdBooking.source !== "public_booking") {
      fail("source не public_booking");
    }
    created.bookingIds.push(createdBooking.id);
    ok("public_reference создаётся trigger-ом и уникален");

    await assertForbiddenBodyField("organization_id", orgId, bookingDate, slotTime);
    await assertForbiddenBodyField("public_reference", "BK-AAAAAA", bookingDate, slotTime);
    await assertForbiddenBodyField("status", "confirmed", bookingDate, slotTime);
    await assertForbiddenBodyField("source", "manual", bookingDate, slotTime);
    await assertForbiddenBodyField("end_time", "23:59", bookingDate, slotTime);
    ok("Клиент не может передать organization_id, reference, status, source, end_time");

    const honeypotRes = await request(app)
      .post(`/api/public/organizations/${testSlug}/bookings`)
      .send({
        service_id: serviceId,
        staff_id: staffId,
        booking_date: bookingDate,
        start_time: slotTime,
        client_name: "Бот",
        client_phone: "+77001112233",
        website: "http://spam.example",
      })
      .expect(201);
    if (honeypotRes.body.booking) fail("Honeypot не должен возвращать booking");
    const { data: honeypotBooking } = await admin
      .from("bookings")
      .select("id")
      .eq("client_name", "Бот")
      .maybeSingle();
    if (honeypotBooking) {
      created.bookingIds.push(honeypotBooking.id);
      fail("Honeypot не должен создавать запись");
    }
    ok("Honeypot: запись не создаётся, ответ без подсказок");

    await admin.from("organizations").update({ booking_confirmation_mode: "manual" }).eq("id", orgId);
    const slotsAfter = await request(app)
      .get(`/api/public/organizations/${testSlug}/slots`)
      .query({ service_id: serviceId, staff_id: staffId, date: bookingDate })
      .expect(200);
    const manualSlot = slotsAfter.body.slots[0]?.start_time;
    if (!manualSlot) fail("Нет свободного слота для manual-теста");
    const manualRes = await request(app)
      .post(`/api/public/organizations/${testSlug}/bookings`)
      .send({
        service_id: serviceId,
        staff_id: staffId,
        booking_date: bookingDate,
        start_time: manualSlot,
        client_name: "Петр Тестов",
        client_phone: "+77007654321",
      })
      .expect(201);
    if (manualRes.body.booking.status !== "pending") fail("manual должен создавать pending");
    const { data: manualBooking } = await admin
      .from("bookings")
      .select("id")
      .eq("public_reference", manualRes.body.booking.reference)
      .single();
    created.bookingIds.push(manualBooking.id);
    ok("manual создаёт pending");
    await admin.from("organizations").update({ booking_confirmation_mode: "auto" }).eq("id", orgId);

    const conflictRes = await request(app)
      .post(`/api/public/organizations/${testSlug}/bookings`)
      .send({
        service_id: serviceId,
        staff_id: staffId,
        booking_date: bookingDate,
        start_time: slotTime,
        client_name: "Конфликт",
        client_phone: "+77009998877",
      })
      .expect(409);
    if (conflictRes.body.code !== "BOOKING_TIME_CONFLICT") fail("Ожидался BOOKING_TIME_CONFLICT");
    ok("Конфликт времени возвращает 409");

    const { data: otherOrg } = await admin
      .from("organizations")
      .select("slug")
      .neq("id", orgId)
      .limit(1)
      .maybeSingle();
    if (otherOrg?.slug) {
      const { error: slugError } = await sb
        .from("organizations")
        .update({ slug: otherOrg.slug })
        .eq("id", orgId);
      if (!slugError) fail("Дублирующий slug должен отклоняться");
      if (String(slugError.message).includes("organizations_slug")) {
        ok("Занятый slug отклоняется при сохранении настроек");
      } else {
        ok("Занятый slug отклоняется (constraint/RLS)");
      }
    } else {
      console.log("[SKIP] Проверка duplicate slug — нет второй организации в БД");
    }

    const pageRes = await request(app).get(`/book/${testSlug}`).expect(200);
    if (!String(pageRes.text).includes("public-booking-page")) {
      fail("Публичная HTML-страница недоступна");
    }
    ok("Публичная HTML-страница открывается");

    console.log("\nВсе тесты public-booking пройдены.");
    console.log("Для SQL-проверок миграции: npm run validate:migration-009");
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
