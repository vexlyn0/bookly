/**
 * Jazyl Студия — «Анонс месяца»: «Открыта запись» с огромным названием месяца и календарём.
 *
 * Картинка: наклейка, «Открыта запись», МЕСЯЦ крупно на всю ширину, календарь-талон
 * (перфорация под днями недели, рабочие дни — закрашенные квадраты), акция-наклейка, QR в углу.
 * Шаблоны (TEMPLATES) — в порядке подписей в server/site/tools.js.
 */
(() => {
  const root = document.getElementById("zapis");
  if (!root) return;

  const kit = window.JazylToolKit;
  const $ = (sel) => root.querySelector(sel);
  const canvas = $("#zapis-canvas");
  const calendarBox = $("#zapis-calendar");
  const store = kit.storage("jazyl:studio:anons");

  const FORMATS = { story: [1080, 1920], post: [1080, 1350] };

  const TEXT = {
    ru: {
      title: "Открыта запись",
      months: ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"],
      weekdays: ["пн", "вт", "ср", "чт", "пт", "сб", "вс"],
      workDays: "Рабочие дни",
    },
    kk: {
      title: "Жазылу ашық",
      months: ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым", "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"],
      weekdays: ["дс", "сс", "ср", "бс", "жм", "сн", "жс"],
      workDays: "Жұмыс күндері",
    },
  };

  // ---------------------------------------------------------------------------
  // Месяц и дни
  // ---------------------------------------------------------------------------

  const pad = (n) => String(n).padStart(2, "0");

  function monthKey(offset) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + offset);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }

  function parseMonth(key) {
    const [y, m] = String(key).split("-").map(Number);
    return { year: y, month: m - 1, days: new Date(y, m, 0).getDate() };
  }

  /** День недели с понедельника: 0 — пн … 6 — вс. */
  const weekdayOf = (year, month, day) => (new Date(year, month, day).getDay() + 6) % 7;

  function presetDays(key, kind) {
    const { year, month, days } = parseMonth(key);
    const all = Array.from({ length: days }, (_, i) => i + 1);
    if (kind === "weekdays") return all.filter((d) => weekdayOf(year, month, d) < 5);
    if (kind === "six") return all.filter((d) => weekdayOf(year, month, d) < 6);
    if (kind === "all") return all;
    if (kind === "twotwo") return all.filter((d) => (d - 1) % 4 < 2);
    return [];
  }

  function ranges(days) {
    const sorted = [...days].sort((a, b) => a - b);
    const parts = [];
    for (let i = 0; i < sorted.length; i += 1) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
      parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
      i = j;
    }
    return parts.join(", ");
  }

  // ---------------------------------------------------------------------------
  // Состояние
  // ---------------------------------------------------------------------------

  const state = {
    month: monthKey(1),
    days: presetDays(monthKey(1), "six"),
    preset: "six",
    label: "",
    title: "",
    promo: "",
    qr: "",
    nick: "",
    how: "link",
    whatsapp: "",
    custom: "",
    style: "graphite",
    format: "story",
    lang: "ru",
  };

  // ---------------------------------------------------------------------------
  // Рисование
  // ---------------------------------------------------------------------------

  /** Календарь-талон. Возвращает высоту. */
  function drawCalendar(ctx, p, cfg, style, t, x, y, w, s, draw) {
    const { year, month, days } = parseMonth(cfg.month);
    const first = weekdayOf(year, month, 1);
    const rows = Math.ceil((first + days) / 7);
    const padIn = 34 * s;
    const cell = (w - padIn * 2) / 7;
    const cellH = Math.min(cell * 0.9, 120 * s);
    const head = 74 * s;
    const h = padIn * 2 + head + rows * cellH;
    if (!draw) return h;

    kit.ticket(ctx, { x, y, w, h, r: 34 * s, notch: 18 * s, cutY: y + padIn + head - 14 * s, fill: style.ticket, line: style.line });
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    p.font(26 * s, 900);
    p.spacing(3 * s);
    t.weekdays.forEach((name, i) => {
      ctx.fillStyle = style.ticketSub;
      ctx.globalAlpha = i >= 5 ? 0.6 : 1;
      ctx.fillText(name.toUpperCase(), x + padIn + cell * (i + 0.5), y + padIn + head / 2 - 12 * s);
    });
    ctx.globalAlpha = 1;
    p.spacing(0);

    const work = new Set(cfg.days);
    const box = Math.min(cell, cellH) - 12 * s;
    for (let day = 1; day <= days; day += 1) {
      const index = first + day - 1;
      const cx = x + padIn + cell * ((index % 7) + 0.5);
      const cy = y + padIn + head + cellH * (Math.floor(index / 7) + 0.5);
      if (work.has(day)) {
        ctx.fillStyle = style.accent;
        p.roundRect(cx - box / 2, cy - box / 2, box, box, box * 0.28);
        ctx.fill();
        p.font(box * 0.42, 800);
        ctx.fillStyle = style.accentText;
      } else {
        p.font(box * 0.38, 600);
        ctx.fillStyle = style.ticketSub;
        ctx.globalAlpha = 0.45;
      }
      ctx.fillText(String(day), cx, cy + 2 * s);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    return h;
  }

  function draw(target, cfg, scale = 1) {
    const [W, H] = FORMATS[cfg.format] || FORMATS.story;
    const style = kit.findStyle(cfg.style);
    const { ctx, p } = kit.begin(target, W, H, style, scale);
    const t = TEXT[cfg.lang] || TEXT.ru;
    const padX = 80;
    const width = W - padX * 2;
    const { month } = parseMonth(cfg.month);

    // QR — в правом нижнем углу, низ текста сужается
    const qr = kit.qrTarget(cfg.qr);
    const qrSize = cfg.format === "story" ? 210 : 170;
    let bottom = kit.drawFooter(ctx, p, cfg, style, W, H, padX, qr ? width - qrSize - 40 : width);
    if (qr) {
      const qy = H - 110 - qrSize;
      kit.drawQr(ctx, p, qr, W - padX - qrSize, qy, qrSize, kit.qrDark(style));
      bottom = Math.min(bottom, qy - 30);
    }

    const label = cfg.label.trim();
    const title = cfg.title.trim() || t.title;
    const promo = cfg.promo.trim();
    const monthName = t.months[month].toUpperCase();
    const top = cfg.format === "story" ? 130 : 80;

    // Название месяца — на всю ширину
    p.font(100, 900);
    p.spacing(-4);
    const monthSize = Math.min(260, (100 * width) / ctx.measureText(monthName).width);
    p.spacing(0);

    let s = 1.2;
    const headH = (k) => (label ? 92 * k : 0) + 66 * k + monthSize * Math.min(1, k) * 0.9 + (promo ? 30 * k : 0) + 46 * k;
    for (; s > 0.45; s -= 0.05) {
      if (top + headH(s) + drawCalendar(ctx, p, cfg, style, t, padX, 0, width, s, false) <= bottom) break;
    }

    let y = top;
    if (label) {
      kit.sticker(ctx, p, { text: label.toUpperCase(), x: padX, y, size: 30 * s, angle: -0.05, fill: style.ticket, color: style.ticketText });
      y += 92 * s;
    }
    ctx.textBaseline = "alphabetic";
    p.font(54 * s, 800);
    ctx.fillStyle = style.sub;
    ctx.fillText(p.fit(title, width), padX, y + 50 * s);
    y += 66 * s;

    const ms = monthSize * Math.min(1, s);
    p.font(ms, 900);
    p.spacing(-ms * 0.04);
    ctx.fillStyle = style.text;
    ctx.fillText(monthName, padX - ms * 0.03, y + ms * 0.78);
    p.spacing(0);
    if (promo) {
      kit.sticker(ctx, p, { text: promo, x: W - padX, y: y + ms * 0.62, size: 32 * s, angle: 0.08, fill: style.accent, color: style.accentText, align: "right" });
    }
    y += ms * 0.9 + (promo ? 30 * s : 0) + 46 * s;

    // Лишнее место — половину над календарём
    const calH = drawCalendar(ctx, p, cfg, style, t, padX, y, width, s, false);
    y += Math.min(140, Math.max(0, (bottom - y - calH) / 2));
    drawCalendar(ctx, p, cfg, style, t, padX, y, width, s, true);
  }

  // ---------------------------------------------------------------------------
  // Форма
  // ---------------------------------------------------------------------------

  const capitalize = (v) => v.charAt(0).toUpperCase() + v.slice(1);

  function renderMonths() {
    $("[name='month']").innerHTML = Array.from({ length: 7 }, (_, i) => {
      const key = monthKey(i);
      const { year, month } = parseMonth(key);
      return `<option value="${key}">${capitalize(TEXT.ru.months[month])} ${year}</option>`;
    }).join("");
  }

  function renderCalendar() {
    const { year, month, days } = parseMonth(state.month);
    const first = weekdayOf(year, month, 1);
    const work = new Set(state.days);
    calendarBox.innerHTML =
      TEXT.ru.weekdays.map((d) => `<span class="st-cal__head">${d}</span>`).join("") +
      Array.from({ length: first }, () => "<span></span>").join("") +
      Array.from({ length: days }, (_, i) => `<button type="button" class="st-cal__day" data-day="${i + 1}" aria-pressed="${work.has(i + 1)}">${i + 1}</button>`).join("");
  }

  const FIELDS = ["month", "label", "title", "promo", "qr", "nick", "whatsapp", "custom"];

  function setChoice(group, value) {
    state[group] = value;
    kit.setPressed(root, group, value);
    if (group === "how") {
      $("#zapis-whatsapp").hidden = value !== "whatsapp";
      $("#zapis-custom").hidden = value !== "custom";
    }
  }

  function syncInputs() {
    const select = $("[name='month']");
    if (![...select.options].some((o) => o.value === state.month)) {
      select.insertAdjacentHTML("afterbegin", `<option value="${state.month}">${state.month}</option>`);
    }
    for (const name of FIELDS) {
      const el = root.querySelector(`[name="${name}"]`);
      if (el) el.value = state[name];
    }
    ["style", "format", "lang", "how"].forEach((g) => setChoice(g, state[g]));
    kit.setPressed(root, "days", state.preset || "");
    renderCalendar();
  }

  const SAVED = ["label", "qr", "nick", "how", "whatsapp", "custom", "style", "format", "lang"];
  const save = () => store.save(Object.fromEntries(SAVED.map((k) => [k, state[k]])));
  const redraw = kit.scheduler(() => {
    draw(canvas, state);
    save();
  });

  function restore() {
    const saved = store.load();
    if (!saved) return;
    for (const [key, max] of [["label", 30], ["qr", 200], ["nick", 32], ["whatsapp", 24], ["custom", 60]]) {
      if (typeof saved[key] === "string") state[key] = saved[key].slice(0, max);
    }
    if (kit.STYLES.some((st) => st.id === saved.style)) state.style = saved.style;
    if (FORMATS[saved.format]) state.format = saved.format;
    if (TEXT[saved.lang]) state.lang = saved.lang;
    if (["link", "direct", "whatsapp", "custom"].includes(saved.how)) state.how = saved.how;
  }

  function plainText() {
    const t = TEXT[state.lang];
    const { month } = parseMonth(state.month);
    const label = state.label.trim();
    const lines = [`${state.title.trim() || t.title}: ${t.months[month]}${label ? ` — ${label}` : ""}`];
    if (state.days.length) lines.push(`${t.workDays}: ${ranges(state.days)}`);
    if (state.promo.trim()) lines.push(state.promo.trim());
    lines.push(...kit.howLines(state));
    const target = kit.qrTarget(state.qr);
    if (target) lines.push(target);
    if (state.nick.trim()) lines.push(state.nick.trim());
    return lines.join("\n");
  }

  kit.bindActions({
    canvas,
    render: () => draw(canvas, state),
    fileName: () => `${state.lang === "kk" ? "zhazylu-ashyq" : "anons"}-${state.month}.png`,
    text: plainText,
    download: $("#zapis-download"),
    share: $("#zapis-share"),
    copy: $("#zapis-copy"),
  });

  root.addEventListener("input", (event) => {
    const el = event.target;
    if (!FIELDS.includes(el.name)) return;
    if (el.name === "month") {
      // Новый месяц — тот же график
      state.month = el.value;
      state.days = presetDays(el.value, state.preset || "six");
      renderCalendar();
    } else {
      state[el.name] = el.value;
    }
    redraw();
  });

  root.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !root.contains(button) || button.dataset.template) return;
    if (button.dataset.day) {
      const day = Number(button.dataset.day);
      state.days = state.days.includes(day) ? state.days.filter((d) => d !== day) : [...state.days, day];
      button.setAttribute("aria-pressed", String(state.days.includes(day)));
      state.preset = "";
      kit.setPressed(root, "days", "");
    } else if (button.dataset.days) {
      state.preset = button.dataset.days;
      state.days = presetDays(state.month, state.preset);
      kit.setPressed(root, "days", state.preset);
      renderCalendar();
    } else {
      const g = ["style", "format", "lang", "how"].find((k) => button.dataset[k]);
      if (!g) return;
      setChoice(g, button.dataset[g]);
    }
    redraw();
  });

  // ---------------------------------------------------------------------------
  // Шаблоны
  // ---------------------------------------------------------------------------

  const next = monthKey(1);
  const base = { month: next, label: "", title: "", promo: "", qr: "", nick: "@vash.nik", how: "link", whatsapp: "", custom: "", format: "story", lang: "ru" };
  const TEMPLATES = [
    { ...base, style: "graphite", label: "Маникюр", preset: "six", days: presetDays(next, "six") },
    { ...base, style: "violet", label: "Ресницы", promo: "−10% на первую неделю", preset: "twotwo", days: presetDays(next, "twotwo") },
    { ...base, style: "milk", label: "Barbershop", how: "direct", preset: "all", days: presetDays(next, "all") },
    { ...base, style: "mint", label: "Массаж", preset: "weekdays", days: presetDays(next, "weekdays") },
    { ...base, style: "coral", label: "Косметолог", qr: "@vash.nik", preset: "six", days: presetDays(next, "six") },
    { ...base, style: "sky", label: "Шаштараз", lang: "kk", preset: "six", days: presetDays(next, "six") },
  ];

  function applyTemplate(i) {
    const own = { nick: state.nick, qr: state.qr };
    Object.assign(state, JSON.parse(JSON.stringify(TEMPLATES[i])));
    if (own.nick.trim()) state.nick = own.nick;
    if (own.qr.trim() && state.qr) state.qr = own.qr;
    syncInputs();
    redraw();
  }

  // ---------------------------------------------------------------------------
  // Старт
  // ---------------------------------------------------------------------------

  restore();
  renderMonths();
  $("#zapis-styles").innerHTML = kit.styleButtons();
  syncInputs();
  draw(canvas, state);
  kit.fontsReady().then(() => {
    redraw();
    kit.renderTemplates(draw, TEMPLATES, applyTemplate);
  });
})();
