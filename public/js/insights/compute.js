/**
 * Bookly — расчёты для «Клиентов» и «Аналитики» (Pro).
 * Чистые функции без DOM и сети: работают и в браузере, и в unit-тестах Node.
 *
 * «Визит» — завершённая запись или подтверждённая/ожидающая запись, время
 * которой уже прошло (салоны часто не отмечают «Завершена» вручную).
 * Выручка считается по текущим ценам услуг.
 */
(function (root) {
  const ACTIVE = ["pending", "confirmed"];

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function dateString(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parseDate(dateStr) {
    const [y, m, d] = String(dateStr).split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(dateStr, days) {
    const d = parseDate(dateStr);
    d.setDate(d.getDate() + days);
    return dateString(d);
  }

  function daysBetween(fromStr, toStr) {
    return Math.round((parseDate(toStr) - parseDate(fromStr)) / 86400000);
  }

  function toMinutes(time) {
    const [h, m] = String(time || "").split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  /** Номер в едином виде — как public.phone_key() в базе. */
  function phoneKey(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
    if (digits.length === 10) return `7${digits}`;
    return digits;
  }

  function startsAt(booking) {
    const d = parseDate(booking.booking_date);
    d.setMinutes(toMinutes(booking.start_time));
    return d;
  }

  function endsAt(booking) {
    const d = parseDate(booking.booking_date);
    d.setMinutes(toMinutes(booking.end_time || booking.start_time));
    return d;
  }

  function isVisit(booking, now) {
    if (booking.status === "completed") return true;
    return ACTIVE.includes(booking.status) && endsAt(booking) <= now;
  }

  function isUpcoming(booking, now) {
    return ACTIVE.includes(booking.status) && startsAt(booking) > now;
  }

  function priceOf(booking, priceByService) {
    if (priceByService && priceByService.has(booking.service_id)) {
      return Number(priceByService.get(booking.service_id)) || 0;
    }
    return Number(booking.services?.price) || 0;
  }

  function mode(values) {
    const counts = new Map();
    let best = null;
    let bestCount = 0;
    for (const value of values) {
      if (!value) continue;
      const count = (counts.get(value) || 0) + 1;
      counts.set(value, count);
      if (count > bestCount) {
        best = value;
        bestCount = count;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Клиенты
  // ---------------------------------------------------------------------------

  /**
   * Сводка по клиентам (группировка по номеру телефона).
   * @returns {Array<{
   *   key, name, phone, visits, noShows, cancellations, spent, firstDate, lastVisit,
   *   daysSinceVisit, nextBooking, favoriteStaffId, favoriteServiceName, telegram, bookings
   * }>}
   */
  function aggregateClients(bookings, { now = new Date(), priceByService = null } = {}) {
    const today = dateString(now);
    const groups = new Map();

    for (const booking of bookings || []) {
      const key = booking.client_phone_key || phoneKey(booking.client_phone);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(booking);
    }

    const clients = [];
    for (const [key, list] of groups) {
      list.sort((a, b) => startsAt(a) - startsAt(b));
      const latest = list[list.length - 1];
      const visits = list.filter((b) => isVisit(b, now));
      const upcoming = list.filter((b) => isUpcoming(b, now));
      const lastVisit = visits.length ? visits[visits.length - 1].booking_date : null;

      clients.push({
        key,
        name: String(latest.client_name || "").trim() || "Без имени",
        phone: latest.client_phone || "",
        visits: visits.length,
        noShows: list.filter((b) => b.status === "no_show").length,
        cancellations: list.filter((b) => b.status === "canceled").length,
        spent: visits.reduce((sum, b) => sum + priceOf(b, priceByService), 0),
        firstDate: list[0].booking_date,
        lastVisit,
        daysSinceVisit: lastVisit ? daysBetween(lastVisit, today) : null,
        nextBooking: upcoming[0] || null,
        favoriteStaffId: mode(visits.map((b) => b.staff_id)),
        favoriteServiceName: mode(visits.map((b) => b.services?.name)),
        telegram: list.some((b) => b.client_telegram_chat_id),
        bookings: list.slice().reverse(),
      });
    }

    return clients;
  }

  /**
   * Сегменты: all | lapsed (давно не были) | regular (3+ визита) | new (новые за 30 дней) | noshow
   */
  function filterClients(clients, { segment = "all", lapsedDays = 45, query = "", now = new Date() } = {}) {
    const today = dateString(now);
    const q = String(query || "").trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");

    let list = clients.filter((client) => {
      switch (segment) {
        case "lapsed":
          return client.visits > 0 && !client.nextBooking && client.daysSinceVisit >= lapsedDays;
        case "regular":
          return client.visits >= 3;
        case "new":
          return daysBetween(client.firstDate, today) <= 30;
        case "noshow":
          return client.noShows > 0;
        default:
          return true;
      }
    });

    if (q) {
      // «8 777…» и «+7 777…» — один и тот же номер.
      const variants = [qDigits];
      if (qDigits.startsWith("8")) variants.push(`7${qDigits.slice(1)}`);
      list = list.filter((client) => {
        if (client.name.toLowerCase().includes(q)) return true;
        if (qDigits.length < 3) return false;
        const key = phoneKey(client.phone);
        return variants.some((v) => key.includes(v));
      });
    }

    const activity = (client) =>
      client.nextBooking ? startsAt(client.nextBooking).getTime() : client.lastVisit ? parseDate(client.lastVisit).getTime() : 0;

    return list.sort((a, b) =>
      segment === "lapsed" ? b.daysSinceVisit - a.daysSinceVisit : activity(b) - activity(a)
    );
  }

  function segmentCounts(clients, options = {}) {
    const result = {};
    for (const segment of ["all", "lapsed", "regular", "new", "noshow"]) {
      result[segment] = filterClients(clients, { ...options, segment, query: "" }).length;
    }
    return result;
  }

  /** CSV для Excel: «;» и BOM, чтобы кириллица открылась без кракозябр. */
  function clientsToCsv(clients, staffName = () => "") {
    const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const head = ["Имя", "Телефон", "Визитов", "Последний визит", "Следующая запись", "Сумма, ₸", "Мастер", "Неявки"];
    const rows = clients.map((c) => [
      c.name,
      c.phone,
      c.visits,
      c.lastVisit || "",
      c.nextBooking ? `${c.nextBooking.booking_date} ${String(c.nextBooking.start_time).slice(0, 5)}` : "",
      c.spent,
      staffName(c.favoriteStaffId),
      c.noShows,
    ]);
    return "﻿" + [head, ...rows].map((row) => row.map(escape).join(";")).join("\r\n");
  }

  // ---------------------------------------------------------------------------
  // Аналитика
  // ---------------------------------------------------------------------------

  /** Период: 7 | 30 | 90 | month | prev_month → { from, to, days, label } (to включительно). */
  function resolvePeriod(period, now = new Date()) {
    const today = dateString(now);
    if (period === "month") {
      const from = dateString(new Date(now.getFullYear(), now.getMonth(), 1));
      return { from, to: today, days: daysBetween(from, today) + 1 };
    }
    if (period === "prev_month") {
      const from = dateString(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      const to = dateString(new Date(now.getFullYear(), now.getMonth(), 0));
      return { from, to, days: daysBetween(from, to) + 1 };
    }
    const days = Number(period) || 30;
    return { from: addDays(today, -(days - 1)), to: today, days };
  }

  function previousRange(range) {
    const to = addDays(range.from, -1);
    return { from: addDays(to, -(range.days - 1)), to, days: range.days };
  }

  function inRange(booking, range) {
    return booking.booking_date >= range.from && booking.booking_date <= range.to;
  }

  function summarize(bookings, range, { now, priceByService, firstSeen }) {
    const list = bookings.filter((b) => inRange(b, range));
    const visits = list.filter((b) => isVisit(b, now));
    const noShows = list.filter((b) => b.status === "no_show").length;
    const revenue = visits.reduce((sum, b) => sum + priceOf(b, priceByService), 0);
    const notCanceled = list.filter((b) => b.status !== "canceled");
    const online = notCanceled.filter((b) => b.source === "public_booking").length;

    let newClients = 0;
    for (const [, first] of firstSeen) {
      if (first >= range.from && first <= range.to) newClients += 1;
    }

    return {
      bookings: notCanceled.length,
      visits: visits.length,
      revenue,
      avgCheck: visits.length ? Math.round(revenue / visits.length) : 0,
      noShows,
      noShowRate: visits.length + noShows ? Math.round((noShows / (visits.length + noShows)) * 100) : 0,
      cancellations: list.filter((b) => b.status === "canceled").length,
      onlineShare: notCanceled.length ? Math.round((online / notCanceled.length) * 100) : 0,
      newClients,
    };
  }

  function delta(current, previous) {
    if (!previous) return current ? null : 0;
    return Math.round(((current - previous) / previous) * 100);
  }

  /** Сколько минут мастер работал по графику в днях периода (не позже сегодняшнего). */
  function scheduledMinutes(schedules, staffId, range, today) {
    const last = range.to < today ? range.to : today;
    let total = 0;
    for (let date = range.from; date <= last; date = addDays(date, 1)) {
      const dayIndex = (parseDate(date).getDay() + 6) % 7;
      const row = schedules.find((s) => s.staff_id === staffId && s.day_of_week === dayIndex);
      if (row && row.is_working === true) {
        total += Math.max(0, toMinutes(row.end_time) - toMinutes(row.start_time));
      }
    }
    return total;
  }

  /**
   * Вся аналитика за период.
   * @param {object} input
   * @param {Array} input.bookings   все записи организации (для «новых клиентов» нужны и старые)
   * @param {Array} input.schedules  staff_schedules
   * @param {Array} input.staff
   * @param {Array} input.services
   * @param {string|number} input.period
   */
  function computeAnalytics({ bookings = [], schedules = [], staff = [], services = [], period = 30, now = new Date() }) {
    const priceByService = new Map(services.map((s) => [s.id, Number(s.price) || 0]));
    const range = resolvePeriod(period, now);
    const prev = previousRange(range);
    const today = dateString(now);

    // Первое появление клиента (по номеру) — для «новых клиентов».
    const firstSeen = new Map();
    for (const b of bookings) {
      if (b.status === "canceled") continue;
      const key = b.client_phone_key || phoneKey(b.client_phone);
      if (!key) continue;
      const known = firstSeen.get(key);
      if (!known || b.booking_date < known) firstSeen.set(key, b.booking_date);
    }

    const ctx = { now, priceByService, firstSeen };
    const current = summarize(bookings, range, ctx);
    const previous = summarize(bookings, prev, ctx);

    const periodBookings = bookings.filter((b) => inRange(b, range));
    const visits = periodBookings.filter((b) => isVisit(b, now));

    // Выручка по дням (для 90 дней — по неделям)
    const bucketDays = range.days > 45 ? 7 : 1;
    const chart = [];
    for (let start = range.from; start <= range.to; start = addDays(start, bucketDays)) {
      const end = addDays(start, bucketDays - 1);
      const bucket = visits.filter((b) => b.booking_date >= start && b.booking_date <= end);
      chart.push({
        from: start,
        to: end > range.to ? range.to : end,
        revenue: bucket.reduce((sum, b) => sum + priceOf(b, priceByService), 0),
        visits: bucket.length,
      });
    }

    // По мастерам
    const byStaff = staff
      .map((member) => {
        const own = visits.filter((b) => b.staff_id === member.id);
        const booked = periodBookings.filter(
          (b) => b.staff_id === member.id && b.status !== "canceled" && startsAt(b) <= now
        );
        const bookedMinutes = booked.reduce(
          (sum, b) => sum + Math.max(0, toMinutes(b.end_time) - toMinutes(b.start_time)),
          0
        );
        const available = scheduledMinutes(schedules, member.id, range, today);
        return {
          id: member.id,
          name: member.name,
          visits: own.length,
          revenue: own.reduce((sum, b) => sum + priceOf(b, priceByService), 0),
          load: available ? Math.min(100, Math.round((bookedMinutes / available) * 100)) : null,
        };
      })
      .filter((row) => row.visits > 0 || row.load)
      .sort((a, b) => b.revenue - a.revenue || b.visits - a.visits);

    // Топ услуг
    const serviceMap = new Map();
    for (const b of visits) {
      const name = b.services?.name || "Без названия";
      const row = serviceMap.get(name) || { name, visits: 0, revenue: 0 };
      row.visits += 1;
      row.revenue += priceOf(b, priceByService);
      serviceMap.set(name, row);
    }
    const topServices = [...serviceMap.values()].sort((a, b) => b.revenue - a.revenue || b.visits - a.visits).slice(0, 6);

    // Загрузка по дням недели и часам (по записям, кроме отменённых)
    const active = periodBookings.filter((b) => b.status !== "canceled");
    const weekdays = Array(7).fill(0);
    const hours = new Map();
    for (const b of active) {
      weekdays[(parseDate(b.booking_date).getDay() + 6) % 7] += 1;
      const hour = Math.floor(toMinutes(b.start_time) / 60);
      hours.set(hour, (hours.get(hour) || 0) + 1);
    }
    const hourKeys = [...hours.keys()];
    const minHour = hourKeys.length ? Math.min(...hourKeys) : 9;
    const maxHour = hourKeys.length ? Math.max(...hourKeys) : 20;
    const byHour = [];
    for (let h = minHour; h <= maxHour; h += 1) byHour.push({ hour: h, count: hours.get(h) || 0 });

    return {
      range,
      current,
      previous,
      deltas: {
        revenue: delta(current.revenue, previous.revenue),
        visits: delta(current.visits, previous.visits),
        avgCheck: delta(current.avgCheck, previous.avgCheck),
        newClients: delta(current.newClients, previous.newClients),
      },
      chart,
      bucketDays,
      byStaff,
      topServices,
      weekdays,
      byHour,
    };
  }

  const api = {
    phoneKey,
    dateString,
    addDays,
    daysBetween,
    isVisit,
    isUpcoming,
    aggregateClients,
    filterClients,
    segmentCounts,
    clientsToCsv,
    resolvePeriod,
    computeAnalytics,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BooklyInsights = api;
})(typeof window !== "undefined" ? window : globalThis);
