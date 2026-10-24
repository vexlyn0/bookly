/**
 * Расчёт показателей админ-панели платформы из «снимка» данных.
 * Чистые функции — без базы и сети (покрыты unit-тестами).
 */

const DAY = 86400000;

function dayKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function addDaysKey(key, days) {
  return new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

function within(value, from, to = Infinity) {
  const t = value ? Date.parse(value) : NaN;
  return Number.isFinite(t) && t >= from && t < to;
}

function group(rows, key = "organization_id") {
  const map = new Map();
  for (const row of rows || []) {
    const id = row[key];
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }
  return map;
}

/**
 * Тариф организации по строке подписки.
 * @returns {{ plan: "free"|"pro"|"trial"|"suspended", until: string|null }}
 */
function planOf(sub, now = new Date()) {
  const t = now.getTime();
  if (!sub) return { plan: "free", until: null };
  if (sub.status === "suspended") return { plan: "suspended", until: null };
  if (sub.status === "trialing" && within(sub.trial_ends_at, t)) return { plan: "trial", until: sub.trial_ends_at };
  if (["active", "past_due", "canceled"].includes(sub.status)) {
    if (within(sub.current_period_end, t)) return { plan: "pro", until: sub.current_period_end };
    if (sub.status === "past_due" && within(sub.grace_period_ends_at, t)) {
      return { plan: "pro", until: sub.grace_period_ends_at };
    }
  }
  return { plan: "free", until: null };
}

/**
 * Одна строка на организацию со всеми производными показателями.
 * @param {object} raw { organizations, subscriptions, owners, users, staff, services, bookings }
 */
function buildOrganizations(raw, now = new Date()) {
  const t = now.getTime();
  const subs = new Map((raw.subscriptions || []).map((s) => [s.organization_id, s]));
  const owners = new Map((raw.owners || []).map((o) => [o.organization_id, o.user_id]));
  const users = new Map((raw.users || []).map((u) => [u.id, u]));
  const staffBy = group(raw.staff);
  const servicesBy = group(raw.services);
  const bookingsBy = group(raw.bookings);

  return (raw.organizations || []).map((org) => {
    const staff = staffBy.get(org.id) || [];
    const services = servicesBy.get(org.id) || [];
    const bookings = bookingsBy.get(org.id) || [];
    const activeStaff = staff.filter((s) => s.is_active);
    const created30 = bookings.filter((b) => within(b.created_at, t - 30 * DAY));
    const created7 = bookings.filter((b) => within(b.created_at, t - 7 * DAY));
    const lastBooking = bookings.reduce((max, b) => (b.created_at > max ? b.created_at : max), "");
    const owner = users.get(owners.get(org.id));
    const { plan, until } = planOf(subs.get(org.id), now);
    const ageDays = Math.floor((t - Date.parse(org.created_at)) / DAY);

    const setup = {
      services: services.some((s) => s.is_active),
      staff: activeStaff.length > 0,
      public_booking: org.public_booking_enabled === true,
      telegram: activeStaff.some((s) => s.telegram_chat_id),
    };
    const setupDone = Object.values(setup).filter(Boolean).length;

    return {
      id: org.id,
      name: org.public_name || org.name,
      legal_name: org.name,
      slug: org.slug,
      business_type: org.business_type,
      phone: org.phone || "",
      address: org.address || "",
      created_at: org.created_at,
      age_days: ageDays,
      owner_email: owner?.email || null,
      owner_last_sign_in_at: owner?.last_sign_in_at || null,
      plan,
      plan_until: until,
      subscription_status: subs.get(org.id)?.status || null,
      staff_active: activeStaff.length,
      staff_total: staff.length,
      telegram_staff: activeStaff.filter((s) => s.telegram_chat_id).length,
      services_active: services.filter((s) => s.is_active).length,
      bookings_total: bookings.length,
      bookings_30d: created30.length,
      bookings_7d: created7.length,
      online_30d: created30.filter((b) => b.source === "public_booking").length,
      last_booking_at: lastBooking || null,
      setup,
      setup_done: setupDone,
      is_live: created7.length > 0,
      is_sleeping: bookings.length === 0 && ageDays >= 3,
      is_stuck: setupDone < 3 && ageDays >= 2,
    };
  });
}

const SEGMENTS = {
  all: () => true,
  free: (o) => o.plan === "free",
  pro: (o) => o.plan === "pro",
  trial: (o) => o.plan === "trial",
  suspended: (o) => o.plan === "suspended",
  live: (o) => o.is_live,
  sleeping: (o) => o.is_sleeping,
  stuck: (o) => o.is_stuck,
};

function filterOrganizations(orgs, { segment = "all", search = "" } = {}) {
  const test = SEGMENTS[segment] || SEGMENTS.all;
  const q = String(search || "").trim().toLowerCase();
  return orgs
    .filter(test)
    .filter(
      (o) =>
        !q ||
        [o.name, o.legal_name, o.slug, o.owner_email, o.phone].some((v) => String(v || "").toLowerCase().includes(q))
    )
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

function segmentCounts(orgs) {
  const counts = {};
  for (const key of Object.keys(SEGMENTS)) counts[key] = orgs.filter(SEGMENTS[key]).length;
  return counts;
}

function delta(current, previous) {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Главная админки.
 * @param {object} raw — тот же снимок + payments (manual_payment_requests)
 */
function buildOverview(raw, orgs, now = new Date()) {
  const t = now.getTime();
  const bookings = raw.bookings || [];
  const payments = raw.payments || [];

  const count = (rows, field, from, to) => rows.filter((r) => within(r[field], from, to)).length;
  const bookings7 = bookings.filter((b) => within(b.created_at, t - 7 * DAY));
  const online7 = bookings7.filter((b) => b.source === "public_booking").length;

  const approved30 = payments.filter(
    (p) => p.status === "approved" && within(p.reviewed_at || p.created_at, t - 30 * DAY)
  );

  // Графики за 30 дней
  const today = dayKey(now);
  const days = Array.from({ length: 30 }, (_, i) => addDaysKey(today, i - 29));
  const signupsByDay = new Map(days.map((d) => [d, 0]));
  const bookingsByDay = new Map(days.map((d) => [d, 0]));
  for (const o of raw.organizations || []) {
    const k = dayKey(o.created_at);
    if (signupsByDay.has(k)) signupsByDay.set(k, signupsByDay.get(k) + 1);
  }
  for (const b of bookings) {
    const k = dayKey(b.created_at);
    if (bookingsByDay.has(k)) bookingsByDay.set(k, bookingsByDay.get(k) + 1);
  }

  const trialsEnding = orgs
    .filter((o) => o.plan === "trial" && within(o.plan_until, t, t + 3 * DAY))
    .sort((a, b) => String(a.plan_until).localeCompare(String(b.plan_until)));

  const stuck = orgs
    .filter((o) => o.is_stuck)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  return {
    organizations: {
      total: orgs.length,
      new_7d: count(raw.organizations || [], "created_at", t - 7 * DAY),
      new_prev_7d: count(raw.organizations || [], "created_at", t - 14 * DAY, t - 7 * DAY),
      live: orgs.filter((o) => o.is_live).length,
      sleeping: orgs.filter((o) => o.is_sleeping).length,
      stuck: stuck.length,
    },
    plans: {
      free: orgs.filter((o) => o.plan === "free").length,
      pro: orgs.filter((o) => o.plan === "pro").length,
      trial: orgs.filter((o) => o.plan === "trial").length,
      suspended: orgs.filter((o) => o.plan === "suspended").length,
    },
    bookings: {
      last_7d: bookings7.length,
      prev_7d: count(bookings, "created_at", t - 14 * DAY, t - 7 * DAY),
      delta: delta(bookings7.length, count(bookings, "created_at", t - 14 * DAY, t - 7 * DAY)),
      online_share_7d: bookings7.length ? Math.round((online7 / bookings7.length) * 100) : 0,
      total: bookings.length,
    },
    payments: {
      approved_30d_amount: approved30.reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
      approved_30d_count: approved30.length,
      pending: payments.filter((p) => p.status === "pending").length,
    },
    charts: {
      days,
      signups: days.map((d) => signupsByDay.get(d)),
      bookings: days.map((d) => bookingsByDay.get(d)),
    },
    attention: {
      pending_payments: payments
        .filter((p) => p.status === "pending")
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        .slice(0, 5)
        .map((p) => ({
          id: p.id,
          organization_id: p.organization_id,
          organization_name: orgs.find((o) => o.id === p.organization_id)?.name || "—",
          amount: p.amount,
          billing_months: p.billing_months,
          created_at: p.created_at,
        })),
      trials_ending: trialsEnding.slice(0, 5).map(pickBrief),
      stuck: stuck.slice(0, 5).map(pickBrief),
    },
  };
}

function pickBrief(o) {
  return {
    id: o.id,
    name: o.name,
    owner_email: o.owner_email,
    plan_until: o.plan_until,
    created_at: o.created_at,
    setup_done: o.setup_done,
    setup: o.setup,
  };
}

module.exports = {
  planOf,
  buildOrganizations,
  filterOrganizations,
  segmentCounts,
  buildOverview,
  SEGMENTS: Object.keys(SEGMENTS),
};
