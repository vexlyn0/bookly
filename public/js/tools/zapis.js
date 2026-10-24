/**
 * Jazyl — инструмент «Запись открыта»: картинка-анонс на месяц с календарём рабочих дней.
 * Всё рисуется в браузере на canvas (общее — в kit.js, QR — vendor/qrcode-generator), на сервер ничего не уходит.
 *
 * Состояние — в объекте state, форма и картинка собираются из него.
 * Примеры внизу страницы (EXAMPLES) идут в том же порядке, что подписи в server/site/tools.js.
 */
(() => {
  const root = document.getElementById("zapis");
  if (!root) return;

  const kit = window.JazylToolKit;
  const { SANS, SERIF, STYLES } = kit;
  if (window.qrcode) window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs["UTF-8"];

  const $ = (sel) => root.querySelector(sel);
  const canvas = $("#zapis-canvas");
  const calendarBox = $("#zapis-calendar");
  const STORAGE_KEY = "jazyl:tool:zapis";

  const FORMATS = { story: [1080, 1920], post: [1080, 1350] };

  const TEXT = {
    ru: {
      title: "Запись открыта",
      forMonth: (month) => `на ${month}`,
      months: ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"],
      weekdays: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
      workDays: "Рабочие дни",
      how: {
        link: "Запись — по ссылке в шапке профиля",
        direct: "Пишите в директ",
        whatsapp: "Запись в WhatsApp",
      },
      qr: "Запись по QR",
      watermark: "сделано в Jazyl",
    },
    kk: {
      title: "Жазылу ашық",
      forMonth: (month) => `${month} айына`,
      months: ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым", "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"],
      weekdays: ["Дс", "Сс", "Ср", "Бс", "Жм", "Сн", "Жс"],
      workDays: "Жұмыс күндері",
      how: {
        link: "Жазылу — профильдегі сілтеме арқылы",
        direct: "Директке жазыңыз",
        whatsapp: "WhatsApp арқылы жазылу",
      },
      qr: "QR арқылы жазылу",
      watermark: "Jazyl арқылы жасалған",
    },
  };

  // ---------------------------------------------------------------------------
  // Месяц и дни
  // ---------------------------------------------------------------------------

  const pad = (n) => String(n).padStart(2, "0");
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

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

  /** Быстрый выбор рабочих дней. */
  function presetDays(key, kind) {
    const { year, month, days } = parseMonth(key);
    const all = Array.from({ length: days }, (_, i) => i + 1);
    if (kind === "weekdays") return all.filter((d) => weekdayOf(year, month, d) < 5);
    if (kind === "six") return all.filter((d) => weekdayOf(year, month, d) < 6);
    if (kind === "all") return all;
    if (kind === "twotwo") return all.filter((d) => (d - 1) % 4 < 2);
    return [];
  }

  /** «1–5, 8–12, 15» — для текста в мессенджеры. */
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
    label: "",
    title: "",
    promo: "",
    qr: "",
    style: "cream",
    format: "story",
    lang: "ru",
    nick: "",
    how: "link",
    whatsapp: "",
    custom: "",
  };

  function howLines(cfg, t) {
    if (cfg.how === "custom") return cfg.custom.trim() ? [cfg.custom.trim()] : [];
    if (cfg.how === "whatsapp") return [cfg.whatsapp.trim() ? `${t.how.whatsapp}: ${cfg.whatsapp.trim()}` : t.how.whatsapp];
    return [t.how[cfg.how] || t.how.link];
  }

  /** Что зашить в QR: ссылка как есть, @ник → Instagram, номер телефона → WhatsApp. */
  function qrTarget(raw) {
    const value = String(raw || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (/^@[\w.]{2,30}$/.test(value)) return `https://instagram.com/${value.slice(1)}`;
    if (/^[\d\s()+-]{10,}$/.test(value)) {
      let digits = value.replace(/\D/g, "");
      if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
      if (digits.length === 10) digits = `7${digits}`;
      return `https://wa.me/${digits}`;
    }
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(value)) return `https://${value}`;
    return value;
  }

  // ---------------------------------------------------------------------------
  // Рисование: draw(canvas, cfg, scale) — одна функция и для предпросмотра, и для примеров
  // ---------------------------------------------------------------------------

  const qrCache = new Map();
  function drawQr(ctx, p, text, x, y, size, dark) {
    if (!qrCache.has(text)) {
      try {
        const qr = window.qrcode(0, "M");
        qr.addData(text);
        qr.make();
        qrCache.set(text, qr);
      } catch {
        qrCache.set(text, null);
      }
    }
    const qr = qrCache.get(text);
    ctx.fillStyle = "#ffffff";
    p.roundRect(x, y, size, size, size * 0.08);
    ctx.fill();
    if (!qr) return;
    const n = qr.getModuleCount();
    const cell = size / (n + 4);
    ctx.fillStyle = dark;
    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n; c += 1) {
        if (qr.isDark(r, c)) ctx.fillRect(x + (c + 2) * cell, y + (r + 2) * cell, cell + 0.5, cell + 0.5);
      }
    }
  }

  function luminance(hex) {
    const m = String(hex).match(/^#([0-9a-f]{6})$/i);
    if (!m) return 1;
    const n = parseInt(m[1], 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  }

  /** Календарь месяца: шапка дней недели и сетка. Возвращает высоту. */
  function drawCalendar(ctx, p, cfg, style, t, x, y, width, s, draw) {
    const { year, month, days } = parseMonth(cfg.month);
    const first = weekdayOf(year, month, 1);
    const rows = Math.ceil((first + days) / 7);
    const cardPad = 34 * s;
    const inner = width - cardPad * 2;
    const cellW = inner / 7;
    const cellH = Math.min(cellW * 0.86, 118 * s);
    const headH = 58 * s;
    const height = cardPad * 2 + headH + rows * cellH;
    if (!draw) return height;

    ctx.fillStyle = style.card;
    p.roundRect(x, y, width, height, 40 * s);
    ctx.fill();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    p.font(26 * s, 700);
    t.weekdays.forEach((name, i) => {
      ctx.fillStyle = style.sub;
      ctx.globalAlpha = i >= 5 ? 0.6 : 0.9;
      ctx.fillText(name, x + cardPad + cellW * (i + 0.5), y + cardPad + headH / 2 - 6 * s);
    });
    ctx.globalAlpha = 1;

    const work = new Set(cfg.days);
    const chipSize = Math.min(cellW, cellH) - 12 * s;
    for (let day = 1; day <= days; day += 1) {
      const index = first + day - 1;
      const cx = x + cardPad + cellW * ((index % 7) + 0.5);
      const cy = y + cardPad + headH + cellH * (Math.floor(index / 7) + 0.5);
      if (work.has(day)) {
        ctx.fillStyle = style.chipFill;
        ctx.beginPath();
        ctx.arc(cx, cy, chipSize / 2, 0, Math.PI * 2);
        ctx.fill();
        if (style.chip === "outline") {
          ctx.lineWidth = Math.max(2, 3 * s);
          ctx.strokeStyle = style.chipLine;
          ctx.stroke();
        }
        p.font(chipSize * 0.42, 700);
        ctx.fillStyle = style.chipText;
      } else {
        p.font(chipSize * 0.4, 500);
        ctx.fillStyle = style.text;
        ctx.globalAlpha = 0.32;
      }
      ctx.fillText(String(day), cx, cy + 2 * s);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    return height;
  }

  function draw(target, cfg, scale = 1) {
    const [W, H] = FORMATS[cfg.format] || FORMATS.story;
    const style = kit.findStyle(cfg.style);
    const { ctx, p } = kit.begin(target, W, H, style, scale);
    const t = TEXT[cfg.lang] || TEXT.ru;
    const titleFamily = style.font === "serif" ? SERIF : SANS;
    const titleWeight = style.font === "serif" ? 700 : 800;
    const padX = 84;
    const width = W - padX * 2;
    const { month } = parseMonth(cfg.month);

    // Низ: QR справа, ник и «как записаться» слева, подпись Jazyl
    kit.drawWatermark(ctx, p, style, t.watermark, W, H - 70);
    const qrText = window.qrcode ? qrTarget(cfg.qr) : "";
    const qrSize = cfg.format === "story" ? 220 : 180;
    const textW = qrText ? width - qrSize - 40 : width;

    let bottomY = H - 140;
    p.font(34, 500);
    const how = howLines(cfg, t).flatMap((line) => p.wrap(line, textW));
    for (let i = how.length - 1; i >= 0; i--) {
      p.font(34, 500);
      ctx.fillStyle = style.sub;
      ctx.fillText(how[i], padX, bottomY);
      bottomY -= 46;
    }
    if (cfg.nick.trim()) {
      p.font(48, 800);
      ctx.fillStyle = style.text;
      ctx.fillText(p.fit(cfg.nick.trim(), textW), padX, bottomY - 4);
      bottomY -= 70;
    }
    let contentBottom = bottomY - 30;
    if (qrText) {
      const qrTop = H - 120 - qrSize;
      drawQr(ctx, p, qrText, W - padX - qrSize, qrTop, qrSize, luminance(style.text) < 0.4 ? style.text : "#15131f");
      contentBottom = Math.min(contentBottom, qrTop - 40);
    }

    // Верх: подпись, заголовок, «на ноябрь», акция, календарь. Подбираем масштаб.
    const label = cfg.label.trim();
    const title = cfg.title.trim() || t.title;
    const sub = t.forMonth(t.months[month]);
    const promo = cfg.promo.trim();
    const topStart = cfg.format === "story" ? 150 : 90;
    const titleSize = style.font === "serif" ? 132 : 124;

    let s = 1.25;
    let titleLines = [];
    for (; s > 0.45; s -= 0.05) {
      p.font(titleSize * s, titleWeight, titleFamily);
      titleLines = p.wrap(title, width);
      const fits = titleLines.every((line) => ctx.measureText(line).width <= width);
      const headerH =
        (label ? 64 * s : 0) + titleLines.length * titleSize * s * 1.02 + 74 * s + (promo ? 110 * s : 0) + 44 * s;
      const calendarH = drawCalendar(ctx, p, cfg, style, t, padX, 0, width, s, false);
      if (fits && topStart + headerH + calendarH <= contentBottom) break;
    }

    let y = topStart;
    ctx.textBaseline = "top";
    if (label) {
      p.font(30 * s, 700);
      p.spacing(7 * s);
      ctx.fillStyle = style.sub;
      ctx.fillText(p.fit(label.toUpperCase(), width), padX, y);
      p.spacing(0);
      y += 64 * s;
    }

    p.font(titleSize * s, titleWeight, titleFamily);
    p.spacing(style.font === "serif" ? 0 : -3 * s);
    ctx.fillStyle = style.text;
    for (const line of titleLines) {
      ctx.fillText(line, padX, y);
      y += titleSize * s * 1.02;
    }
    p.spacing(0);

    y += 12 * s;
    p.font(48 * s, 600);
    ctx.fillStyle = style.sub;
    ctx.fillText(sub, padX, y);
    y += 62 * s;

    if (promo) {
      y += 18 * s;
      p.font(40 * s, 700);
      const promoW = Math.min(ctx.measureText(promo).width + 56 * s, width);
      const promoH = 76 * s;
      ctx.fillStyle = style.sub;
      p.roundRect(padX, y, promoW, promoH, promoH / 2);
      ctx.fill();
      ctx.fillStyle = style.bg[1];
      ctx.textBaseline = "middle";
      ctx.fillText(promo, padX + 28 * s, y + promoH / 2 + 2 * s, width - 56 * s);
      ctx.textBaseline = "top";
      y += promoH + 16 * s;
    }
    y += 44 * s;

    // Лишнее место (обычно в сторис) — половину над календарём, чтобы он не прилипал к заголовку.
    const calendarH = drawCalendar(ctx, p, cfg, style, t, padX, y, width, s, false);
    y += Math.min(160, Math.max(0, (contentBottom - y - calendarH) / 2));
    drawCalendar(ctx, p, cfg, style, t, padX, y, width, s, true);
  }

  // ---------------------------------------------------------------------------
  // Форма
  // ---------------------------------------------------------------------------

  function renderMonths() {
    const t = TEXT.ru;
    $("[name='month']").innerHTML = Array.from({ length: 7 }, (_, i) => {
      const key = monthKey(i);
      const { year, month } = parseMonth(key);
      return `<option value="${key}">${capitalize(t.months[month])} ${year}</option>`;
    }).join("");
  }

  function renderCalendar() {
    const { year, month, days } = parseMonth(state.month);
    const first = weekdayOf(year, month, 1);
    const work = new Set(state.days);
    const head = TEXT.ru.weekdays.map((d) => `<span class="zc-head">${d}</span>`).join("");
    const blanks = Array.from({ length: first }, () => `<span></span>`).join("");
    const cells = Array.from({ length: days }, (_, i) => {
      const day = i + 1;
      return `<button type="button" class="zc-day" data-day="${day}" aria-pressed="${work.has(day)}">${day}</button>`;
    }).join("");
    calendarBox.innerHTML = head + blanks + cells;
  }

  function setChoice(group, value) {
    state[group] = value;
    root.querySelectorAll(`[data-${group}]`).forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset[group] === value));
    });
    if (group === "how") {
      $("#zapis-whatsapp").hidden = value !== "whatsapp";
      $("#zapis-custom").hidden = value !== "custom";
    }
  }

  const FIELDS = ["month", "label", "title", "promo", "qr", "nick", "whatsapp", "custom"];

  function syncInputs() {
    if (![...$("[name='month']").options].some((o) => o.value === state.month)) {
      $("[name='month']").insertAdjacentHTML("afterbegin", `<option value="${state.month}">${state.month}</option>`);
    }
    for (const name of FIELDS) {
      const el = root.querySelector(`[name="${name}"]`);
      if (el) el.value = state[name];
    }
    ["style", "lang", "format", "how"].forEach((group) => setChoice(group, state[group]));
    renderCalendar();
  }

  let frame = 0;
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      draw(canvas, state);
      save();
    });
  }

  // ---------------------------------------------------------------------------
  // Текст для мессенджеров, сохранение
  // ---------------------------------------------------------------------------

  function plainText() {
    const t = TEXT[state.lang];
    const { month } = parseMonth(state.month);
    const label = state.label.trim();
    const lines = [`${state.title.trim() || t.title} ${t.forMonth(t.months[month])}${label ? ` — ${label}` : ""}`];
    if (state.days.length) lines.push(`${t.workDays}: ${ranges(state.days)}`);
    if (state.promo.trim()) lines.push(state.promo.trim());
    lines.push(...howLines(state, t));
    const target = qrTarget(state.qr);
    if (target) lines.push(target);
    if (state.nick.trim()) lines.push(state.nick.trim());
    return lines.join("\n");
  }

  const SAVED = ["label", "qr", "nick", "how", "whatsapp", "custom", "style", "lang", "format"];

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(SAVED.map((key) => [key, state[key]]))));
    } catch {
      // приватный режим — не страшно
    }
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved) return;
      for (const [key, max] of [["label", 40], ["qr", 200], ["nick", 32], ["whatsapp", 24], ["custom", 60]]) {
        if (typeof saved[key] === "string") state[key] = saved[key].slice(0, max);
      }
      if (STYLES.some((st) => st.id === saved.style)) state.style = saved.style;
      if (TEXT[saved.lang]) state.lang = saved.lang;
      if (FORMATS[saved.format]) state.format = saved.format;
      if (["link", "direct", "whatsapp", "custom"].includes(saved.how)) state.how = saved.how;
    } catch {
      // сохранённого нет — начинаем с чистого листа
    }
  }

  kit.bindActions({
    canvas,
    render: () => draw(canvas, state),
    fileName: () => `${state.lang === "kk" ? "zhazylu-ashyq" : "zapis-otkryta"}-${state.month}.png`,
    text: plainText,
    download: $("#zapis-download"),
    share: $("#zapis-share"),
    copy: $("#zapis-copy"),
  });

  // ---------------------------------------------------------------------------
  // События формы
  // ---------------------------------------------------------------------------

  root.addEventListener("input", (event) => {
    const el = event.target;
    if (el.name && FIELDS.includes(el.name)) {
      if (el.name === "month") {
        // Новый месяц — тот же график по дням недели
        const kind = root.querySelector("[data-days][aria-pressed='true']")?.dataset.days || "six";
        state.month = el.value;
        state.days = presetDays(el.value, kind);
        renderCalendar();
      } else {
        state[el.name] = el.value;
      }
    }
    schedule();
  });

  root.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !root.contains(button)) return;

    if (button.dataset.day) {
      const day = Number(button.dataset.day);
      state.days = state.days.includes(day) ? state.days.filter((d) => d !== day) : [...state.days, day];
      button.setAttribute("aria-pressed", String(state.days.includes(day)));
      root.querySelectorAll("[data-days]").forEach((btn) => btn.setAttribute("aria-pressed", "false"));
    } else if (button.dataset.days) {
      state.days = presetDays(state.month, button.dataset.days);
      root.querySelectorAll("[data-days]").forEach((btn) => btn.setAttribute("aria-pressed", String(btn === button)));
      renderCalendar();
    } else {
      const group = ["style", "lang", "format", "how"].find((g) => button.dataset[g]);
      if (!group) return;
      setChoice(group, button.dataset[group]);
    }
    schedule();
  });

  // ---------------------------------------------------------------------------
  // Примеры: те же картинки уменьшенно + «Сделать такую»
  // ---------------------------------------------------------------------------

  const next = monthKey(1);
  const base = { month: next, label: "", title: "", promo: "", qr: "", style: "cream", format: "story", lang: "ru", nick: "@vash.nik", how: "link", whatsapp: "", custom: "" };
  const EXAMPLES = [
    { ...base, label: "Маникюр", style: "cream", days: presetDays(next, "six") },
    { ...base, label: "Массаж", style: "chocolate", how: "direct", days: presetDays(next, "weekdays") },
    { ...base, label: "Ресницы", style: "powder", promo: "−10% на первую неделю", days: presetDays(next, "twotwo") },
    { ...base, label: "Брови", style: "sage", days: presetDays(next, "six") },
    { ...base, label: "Шугаринг", style: "minimal", how: "whatsapp", whatsapp: "+7 701 000 00 00", days: presetDays(next, "weekdays") },
    { ...base, label: "Косметолог", style: "terracotta", qr: "@vash.nik", days: presetDays(next, "six") },
    { ...base, label: "Barbershop", style: "night", how: "direct", days: presetDays(next, "all") },
    { ...base, label: "Шаштараз", style: "lavender", lang: "kk", days: presetDays(next, "six") },
  ];

  function renderExamples() {
    root.ownerDocument.querySelectorAll("[data-example]").forEach((card) => {
      const cfg = EXAMPLES[Number(card.dataset.example)];
      const holder = card.querySelector("canvas");
      if (!cfg || !holder) return;
      draw(holder, cfg, 0.3);
      card.querySelector("[data-use-example]")?.addEventListener("click", () => {
        // Свой ник оставляем, остальное — как в примере.
        const nick = state.nick;
        Object.assign(state, JSON.parse(JSON.stringify(cfg)));
        if (nick.trim()) state.nick = nick;
        syncInputs();
        schedule();
        root.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Старт
  // ---------------------------------------------------------------------------

  restore();
  renderMonths();
  $("#zapis-styles").innerHTML = kit.styleButtons();
  syncInputs();
  root.querySelector("[data-days='six']")?.setAttribute("aria-pressed", "true");
  draw(canvas, state);

  // Рисуем заново, когда загрузятся шрифты, — иначе первый кадр будет системным шрифтом.
  kit.fontsReady().then(() => {
    schedule();
    renderExamples();
  });
})();
