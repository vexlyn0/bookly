/**
 * Bookly — экран «Сегодня»: расписание дня, ждущие подтверждения записи,
 * ближайшие дни и чек-лист настройки для нового салона.
 */
window.BooklyDashboardUI = (() => {
  const UPCOMING_DAYS = 60;
  const NEXT_LIMIT = 6;
  const ACTIVE = ["pending", "confirmed"];
  const STATUS_LABELS = {
    pending: "Ждёт",
    confirmed: "Подтверждена",
    completed: "Завершена",
    no_show: "Не пришёл",
    canceled: "Отменена",
  };

  let organization = null;
  let staffById = new Map();
  let bookings = [];
  let loading = false;
  // Telegram владельца (раздел «Уведомления») — узнаём из события модуля BooklyOwnerTelegram
  let ownerTelegram = false;
  let lastSetup = null;
  const els = {};

  // ---------------------------------------------------------------------------
  // Даты
  // ---------------------------------------------------------------------------

  function dateString(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function addDays(dateStr, days) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return dateString(new Date(y, m - 1, d + days));
  }

  function toMinutes(time) {
    const [h, m] = String(time || "").split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  function hhmm(time) {
    return String(time || "").slice(0, 5);
  }

  function dayLabel(dateStr) {
    const today = dateString(new Date());
    if (dateStr === addDays(today, 1)) return "Завтра";
    const [y, m, d] = dateStr.split("-").map(Number);
    const label = new Date(y, m - 1, d).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------------------------------------------------------------------------
  // Шапка
  // ---------------------------------------------------------------------------

  function renderHead() {
    const hour = new Date().getHours();
    const greeting =
      hour < 5 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
    const name = String(document.getElementById("user-name")?.textContent || "").trim();
    els.greeting.textContent = name && name !== "—" ? `${greeting}, ${name}` : greeting;

    const date = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    els.date.textContent = date.charAt(0).toUpperCase() + date.slice(1);
  }

  // ---------------------------------------------------------------------------
  // Чек-лист настройки
  // ---------------------------------------------------------------------------

  function renderSetup(services, staff) {
    lastSetup = [services, staff];
    const activeStaff = staff.filter((m) => m.is_active);
    const steps = [
      {
        done: services.some((s) => s.is_active),
        title: "Добавьте услуги",
        text: "Название, длительность и цена.",
        section: "services",
        action: "Добавить",
      },
      {
        done: activeStaff.length > 0,
        title: "Добавьте мастеров",
        text: "У каждого — свои услуги и график.",
        section: "staff",
        action: "Добавить",
      },
      {
        done: organization?.public_booking_enabled === true,
        title: "Включите онлайн-запись",
        text: "И поставьте ссылку в Instagram и 2ГИС.",
        section: "public-booking",
        action: "Включить",
      },
      {
        done: activeStaff.some((m) => m.telegram_chat_id),
        title: "Подключите Telegram мастеру",
        text: "Отправьте ему ссылку — записи будут приходить ему сразу.",
        section: "staff",
        action: "Подключить",
      },
      {
        done: ownerTelegram,
        title: "Подключите свой Telegram",
        text: "Оплаты Kaspi и записи по всем мастерам — вам в чат.",
        section: "notifications",
        action: "Подключить",
        ownerOnly: true,
      },
    ].filter((step) => !step.ownerOnly || organization?.role === "owner");

    const doneCount = steps.filter((step) => step.done).length;
    els.setup.hidden = doneCount === steps.length;
    els.setupProgress.textContent = `${doneCount} из ${steps.length}`;
    els.setupList.innerHTML = steps
      .map(
        (step) => `
          <li class="setup-step ${step.done ? "is-done" : ""}">
            <span class="setup-step__check" aria-hidden="true">${step.done ? "✓" : ""}</span>
            <span class="setup-step__body">
              <b>${escapeHtml(step.title)}</b>
              <span>${escapeHtml(step.text)}</span>
            </span>
            ${step.done ? "" : `<button class="btn btn--outline btn--sm" type="button" data-open-section="${step.section}">${step.action}</button>`}
          </li>`
      )
      .join("");
  }

  // ---------------------------------------------------------------------------
  // Списки
  // ---------------------------------------------------------------------------

  function staffName(id) {
    return staffById.get(id)?.name || "—";
  }

  function renderToday() {
    const today = dateString(new Date());
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    const rows = bookings
      .filter((b) => b.booking_date === today && b.status !== "canceled")
      .sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));

    if (!rows.length) {
      els.list.innerHTML = `
        <div class="today-empty">
          <p class="today-empty__title">Сегодня записей нет</p>
          <p>Поделитесь ссылкой на запись — клиенты смогут записаться сами.</p>
        </div>`;
      return;
    }

    els.list.innerHTML = rows
      .map((b) => {
        const start = toMinutes(b.start_time);
        const end = toMinutes(b.end_time);
        const state = end <= nowMinutes ? "is-past" : start <= nowMinutes ? "is-now" : "";
        const pending = b.status === "pending";
        const awaiting = state === "is-past" && ACTIVE.includes(b.status);
        return `
          <div class="today-row ${awaiting ? "is-awaiting" : state} ${pending && !awaiting ? "is-pending" : ""}" data-booking-id="${b.id}" role="button" tabindex="0">
            <span class="today-row__time">${hhmm(b.start_time)}<small>${hhmm(b.end_time)}</small></span>
            <span class="today-row__bar status-bar--${escapeHtml(b.status)}" aria-hidden="true"></span>
            <span class="today-row__body">
              <b>${escapeHtml(b.client_name)}${state === "is-now" ? ' <em class="today-row__now">сейчас</em>' : ""}</b>
              <span>${escapeHtml(b.services?.name || "")} · ${escapeHtml(staffName(b.staff_id))}</span>
            </span>
            ${
              awaiting
                ? `<span class="today-row__actions">
                     <button class="btn btn--primary btn--sm" type="button" data-visit-done="${b.id}" title="Пришёл, оплатил по записи">Пришёл${b.price ? ` · ${Number(b.price).toLocaleString("ru-RU")} ₸` : ""}</button>
                     <button class="btn btn--outline btn--sm" type="button" data-visit-sum="${b.id}" title="Другая сумма">₸</button>
                     <button class="btn btn--ghost btn--sm" type="button" data-visit-noshow="${b.id}" title="Не пришёл">Не пришёл</button>
                   </span>`
                : pending
                ? `<span class="today-row__actions">
                     <button class="btn btn--primary btn--sm" type="button" data-confirm="${b.id}">Подтвердить</button>
                     <button class="btn btn--ghost btn--sm" type="button" data-reject="${b.id}" aria-label="Отклонить">✕</button>
                   </span>`
                : `<span class="today-row__status">${escapeHtml(STATUS_LABELS[b.status] || b.status)}</span>`
            }
          </div>`;
      })
      .join("");
  }

  function renderNext() {
    const today = dateString(new Date());
    const rows = bookings
      .filter((b) => b.booking_date > today && ACTIVE.includes(b.status))
      .sort((a, b) =>
        a.booking_date === b.booking_date
          ? toMinutes(a.start_time) - toMinutes(b.start_time)
          : a.booking_date.localeCompare(b.booking_date)
      )
      .slice(0, NEXT_LIMIT);

    if (!rows.length) {
      els.next.innerHTML = `<p class="today-empty today-empty--small">Ближайших записей пока нет.</p>`;
      return;
    }

    els.next.innerHTML = rows
      .map(
        (b) => `
          <div class="today-row ${b.status === "pending" ? "is-pending" : ""}" data-booking-id="${b.id}" role="button" tabindex="0">
            <span class="today-row__time today-row__time--day">${escapeHtml(dayLabel(b.booking_date))}<small>${hhmm(b.start_time)}</small></span>
            <span class="today-row__bar status-bar--${escapeHtml(b.status)}" aria-hidden="true"></span>
            <span class="today-row__body">
              <b>${escapeHtml(b.client_name)}</b>
              <span>${escapeHtml(b.services?.name || "")} · ${escapeHtml(staffName(b.staff_id))}</span>
            </span>
          </div>`
      )
      .join("");
  }

  function renderPending() {
    const today = dateString(new Date());
    const count = bookings.filter((b) => b.status === "pending" && b.booking_date >= today).length;
    els.pending.textContent = String(count);
    els.pendingCard.classList.toggle("is-active", count > 0);
  }

  // ---------------------------------------------------------------------------
  // Загрузка
  // ---------------------------------------------------------------------------

  async function refresh() {
    if (loading || !organization) return;
    loading = true;
    renderHead();

    try {
      const today = dateString(new Date());
      const [staff, services, rows] = await Promise.all([
        BooklyStaff.list(organization.id),
        BooklyServices.list(organization.id),
        BooklyBookings.listRange(organization.id, today, addDays(today, UPCOMING_DAYS)),
      ]);

      staffById = new Map(staff.map((member) => [member.id, member]));
      bookings = rows;
      renderSetup(services, staff);
      renderToday();
      renderNext();
      renderPending();
    } catch (error) {
      console.error("[Dashboard]", error?.message);
      els.list.innerHTML = `<p class="today-empty">Не удалось загрузить расписание. Обновите страницу.</p>`;
    } finally {
      loading = false;
    }
  }

  async function setStatus(id, status, button) {
    const before = bookings.find((b) => b.id === id);
    button.disabled = true;
    try {
      await BooklyBookings.setStatus(id, status);
      if (before) {
        BooklyBookings.notifyChange("updated", id, BooklyBookings.toNotifySnapshot(before));
      }
      document.dispatchEvent(new CustomEvent("bookly:bookings-changed"));
    } catch (error) {
      button.disabled = false;
      alert(window.BooklyBookingsErrors?.fromError(error) || "Не удалось изменить запись.");
    }
  }

  async function markVisit(id, mode, button) {
    let amount = null;
    if (mode === "sum") {
      const booking = bookings.find((b) => b.id === id);
      const input = window.prompt(
        `Сколько заплатил(а) ${booking?.client_name || "клиент"}? Сумма в тенге:`,
        booking?.price ? String(booking.price) : ""
      );
      if (input === null) return;
      amount = Number(String(input).replace(/[\s.,₸]/g, "").replace(/тг$/i, ""));
      if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) {
        alert("Введите сумму числом, например 4500.");
        return;
      }
    }

    button.disabled = true;
    try {
      if (mode === "noshow") await BooklyBookings.setStatus(id, "no_show");
      else await BooklyBookings.completeVisit(id, amount);
      document.dispatchEvent(new CustomEvent("bookly:bookings-changed"));
    } catch (error) {
      button.disabled = false;
      alert(window.BooklyBookingsErrors?.fromError(error) || "Не удалось отметить визит.");
    }
  }

  function handleClick(event) {
    const visitBtn = event.target.closest("[data-visit-done], [data-visit-sum], [data-visit-noshow]");
    if (visitBtn) {
      event.stopPropagation();
      const mode = visitBtn.dataset.visitDone ? "done" : visitBtn.dataset.visitSum ? "sum" : "noshow";
      const id = visitBtn.dataset.visitDone || visitBtn.dataset.visitSum || visitBtn.dataset.visitNoshow;
      markVisit(id, mode, visitBtn);
      return;
    }

    const confirmBtn = event.target.closest("[data-confirm]");
    if (confirmBtn) {
      event.stopPropagation();
      setStatus(confirmBtn.dataset.confirm, "confirmed", confirmBtn);
      return;
    }

    const rejectBtn = event.target.closest("[data-reject]");
    if (rejectBtn) {
      event.stopPropagation();
      if (confirm("Отклонить запись? Клиент и мастер получат уведомление, если подключены к боту.")) {
        setStatus(rejectBtn.dataset.reject, "canceled", rejectBtn);
      }
      return;
    }

    const row = event.target.closest("[data-booking-id]");
    if (row) window.BooklyBookingsUI?.openEdit(row.dataset.bookingId);
  }

  async function copyLink() {
    if (!organization?.slug || organization.public_booking_enabled !== true) {
      window.BooklyAppShell?.open("public-booking");
      return;
    }
    const url = `${window.location.origin}/book/${organization.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      els.copy.textContent = "Скопировано ✓";
      setTimeout(() => {
        els.copy.textContent = "Ссылка на запись";
      }, 2000);
    } catch {
      window.prompt("Ссылка на запись:", url);
    }
  }

  function init(org) {
    organization = org;
    els.section = document.getElementById("dashboard-section");
    if (!els.section) return;

    els.greeting = document.getElementById("today-greeting");
    els.date = document.getElementById("today-date");
    els.setup = document.getElementById("today-setup");
    els.setupProgress = document.getElementById("today-setup-progress");
    els.setupList = document.getElementById("today-setup-list");
    els.list = document.getElementById("today-list");
    els.next = document.getElementById("today-next");
    els.pending = document.getElementById("today-pending");
    els.pendingCard = document.getElementById("today-pending-card");
    els.copy = document.getElementById("today-copy-link");

    els.section.addEventListener("click", handleClick);
    els.section.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.matches("[data-booking-id]")) handleClick(event);
    });
    els.copy?.addEventListener("click", copyLink);
    document.getElementById("today-add")?.addEventListener("click", () => {
      window.BooklyBookingsUI?.openCreate({ date: dateString(new Date()) });
    });

    document.addEventListener("bookly:bookings-changed", refresh);
    document.addEventListener("bookly:owner-telegram-changed", (event) => {
      const connected = Boolean(event.detail?.connected);
      if (connected === ownerTelegram) return;
      ownerTelegram = connected;
      if (lastSetup) renderSetup(...lastSetup);
    });
    document
      .querySelector('.sidebar__link[data-section="dashboard"]')
      ?.addEventListener("click", refresh);

    // Настройки онлайн-записи меняют organization в другом модуле — подхватываем.
    document.addEventListener("bookly:organization-changed", (event) => {
      organization = { ...organization, ...(event.detail || {}) };
      refresh();
    });

    // Раз в минуту — чтобы «сейчас» и прошедшие записи сдвигались.
    setInterval(() => {
      if (!els.section.hidden) {
        renderHead();
        renderToday();
      }
    }, 60000);

    refresh();
  }

  return { init, refresh };
})();
