/**
 * Jazyl — инструмент «Свободные окошки»: картинка для сторис/поста со свободным временем.
 * Всё рисуется в браузере на canvas, на сервер ничего не уходит.
 *
 * Состояние — в объекте state, форма и картинка собираются из него.
 * Примеры внизу страницы (EXAMPLES) идут в том же порядке, что подписи в server/site/tools.js.
 */
(() => {
  const root = document.getElementById("okoshki");
  if (!root) return;

  const $ = (sel) => root.querySelector(sel);
  const canvas = $("#okoshki-canvas");
  const daysBox = $("#okoshki-days");
  const STORAGE_KEY = "jazyl:tool:okoshki";

  const FORMATS = { story: [1080, 1920], post: [1080, 1350] };
  const QUICK_TIMES = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00"];

  const kit = window.JazylToolKit;
  const { SANS, SERIF, STYLES } = kit;

  const SERVICES = {
    "": ["", ""],
    manicure: ["Маникюр", "Маникюр"],
    pedicure: ["Педикюр", "Педикюр"],
    lashes: ["Ресницы", "Кірпік"],
    brows: ["Брови", "Қас"],
    haircut: ["Стрижка", "Шаш қию"],
    barber: ["Барбер", "Барбер"],
    coloring: ["Окрашивание", "Шаш бояу"],
    hair: ["Волосы", "Шаш"],
    massage: ["Массаж", "Массаж"],
    cosmetology: ["Косметология", "Косметология"],
    sugaring: ["Шугаринг", "Шугаринг"],
    tattoo: ["Тату", "Тату"],
  };

  const TEXT = {
    ru: {
      title: "Свободные окошки",
      today: "сегодня",
      tomorrow: "завтра",
      forToday: "на сегодня",
      forTomorrow: "на завтра",
      forWeek: "на неделю",
      on: "на",
      how: {
        link: "Запись — по ссылке в шапке профиля",
        direct: "Пишите в директ",
        whatsapp: "Запись в WhatsApp",
      },
      watermark: "сделано в Jazyl",
      empty: "Отметьте свободное время",
      weekdays: ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"],
      months: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
    },
    kk: {
      title: "Бос орындар",
      today: "бүгін",
      tomorrow: "ертең",
      forToday: "бүгінге",
      forTomorrow: "ертеңге",
      forWeek: "аптаға",
      on: "",
      how: {
        link: "Жазылу — профильдегі сілтеме арқылы",
        direct: "Директке жазыңыз",
        whatsapp: "WhatsApp арқылы жазылу",
      },
      watermark: "Jazyl арқылы жасалған",
      empty: "Бос уақытты белгілеңіз",
      weekdays: ["жексенбі", "дүйсенбі", "сейсенбі", "сәрсенбі", "бейсенбі", "жұма", "сенбі"],
      months: ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым", "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"],
    },
  };

  // ---------------------------------------------------------------------------
  // Даты и время
  // ---------------------------------------------------------------------------

  const pad = (n) => String(n).padStart(2, "0");
  const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDate = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (s, n) => {
    const d = parseDate(s);
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  };
  const today = () => toDateStr(new Date());
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const sortTimes = (times) => [...new Set(times)].sort();

  function dayName(dateStr, t) {
    const d = parseDate(dateStr);
    const date = `${d.getDate()} ${t.months[d.getMonth()]}`;
    if (dateStr === today()) return `${capitalize(t.today)}, ${date}`;
    if (dateStr === addDays(today(), 1)) return `${capitalize(t.tomorrow)}, ${date}`;
    return `${capitalize(t.weekdays[d.getDay()])}, ${date}`;
  }

  /** «на завтра, 25 октября» / «ертеңге, 25 қазан» / «на неделю, 24–30 октября». */
  function subtitle(days, t) {
    if (!days.length) return "";
    const fmt = (d) => `${d.getDate()} ${t.months[d.getMonth()]}`;
    if (days.length === 1) {
      const date = days[0].date;
      const d = parseDate(date);
      if (date === today()) return `${t.forToday}, ${fmt(d)}`;
      if (date === addDays(today(), 1)) return `${t.forTomorrow}, ${fmt(d)}`;
      return t.on ? `${t.on} ${fmt(d)}` : fmt(d);
    }
    const first = parseDate(days[0].date);
    const last = parseDate(days[days.length - 1].date);
    const range =
      first.getMonth() === last.getMonth()
        ? `${first.getDate()}–${last.getDate()} ${t.months[last.getMonth()]}`
        : `${fmt(first)} – ${fmt(last)}`;
    const span = Math.round((last - first) / 86400000) + 1;
    return span >= 5 && span <= 7 ? `${t.forWeek}, ${range}` : range;
  }

  // ---------------------------------------------------------------------------
  // Состояние
  // ---------------------------------------------------------------------------

  const state = {
    days: [{ date: addDays(today(), 1), times: ["10:00", "13:00", "16:00"] }],
    service: "",
    serviceCustom: "",
    style: "cream",
    format: "story",
    lang: "ru",
    nick: "",
    how: "link",
    whatsapp: "",
    custom: "",
    promo: "",
  };

  function activeDays(cfg) {
    return cfg.days
      .filter((day) => day.date && day.times.length)
      .map((day) => ({ date: day.date, times: sortTimes(day.times) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function serviceLabel(cfg) {
    if (cfg.service === "custom") return cfg.serviceCustom.trim();
    const entry = SERVICES[cfg.service];
    return entry ? entry[cfg.lang === "kk" ? 1 : 0] : "";
  }

  function howLines(cfg, t) {
    if (cfg.how === "custom") return cfg.custom.trim() ? [cfg.custom.trim()] : [];
    if (cfg.how === "whatsapp") return [cfg.whatsapp.trim() ? `${t.how.whatsapp}: ${cfg.whatsapp.trim()}` : t.how.whatsapp];
    return [t.how[cfg.how] || t.how.link];
  }

  // ---------------------------------------------------------------------------
  // Рисование: draw(canvas, cfg, scale) — одна функция и для предпросмотра, и для примеров
  // ---------------------------------------------------------------------------

  function drawChip(ctx, p, style, x, y, w, h, text, size) {
    ctx.fillStyle = style.chipFill;
    p.roundRect(x, y, w, h, h / 2);
    ctx.fill();
    if (style.chip === "outline") {
      ctx.lineWidth = Math.max(2, size * 0.06);
      ctx.strokeStyle = style.chipLine;
      ctx.stroke();
    }
    p.font(size, 700);
    ctx.fillStyle = style.chipText;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + w / 2, y + h / 2 + size * 0.04);
    ctx.textAlign = "left";
  }

  /**
   * Время. Один день — крупные пилюли столбиком (или в две колонки, если их много).
   * Несколько дней — карточки «день + время». draw=false — только измерить высоту.
   */
  function layoutTimes(ctx, p, days, cfg, style, t, x, y, width, s, draw) {
    if (days.length === 1) {
      const times = days[0].times;
      const cols = times.length > 6 ? 2 : 1;
      const gap = 22 * s;
      const h = 100 * s;
      const w = cols === 1 ? Math.min(470 * s, width) : (width - gap) / 2;
      const rows = Math.ceil(times.length / cols);
      if (draw) {
        times.forEach((time, i) => {
          const col = cols === 1 ? 0 : i % cols;
          const row = cols === 1 ? i : Math.floor(i / cols);
          drawChip(ctx, p, style, x + col * (w + gap), y + row * (h + gap), w, h, time, 52 * s);
        });
      }
      return rows * h + (rows - 1) * gap;
    }

    let cursor = y;
    const cardPad = 32 * s;
    const chipH = 78 * s;
    const chipGap = 14 * s;
    const chipPadX = 30 * s;
    for (const day of days) {
      const top = cursor;
      const labelTop = top + cardPad;
      const chipsTop = labelTop + 50 * s + 16 * s;
      p.font(40 * s, 700);
      const chips = [];
      let cx = x + cardPad;
      let rowTop = chipsTop;
      for (const time of day.times) {
        const w = ctx.measureText(time).width + chipPadX * 2;
        if (cx + w > x + width - cardPad && cx > x + cardPad) {
          cx = x + cardPad;
          rowTop += chipH + chipGap;
        }
        chips.push({ time, x: cx, y: rowTop, w });
        cx += w + chipGap;
      }
      const bottom = rowTop + chipH + cardPad;
      if (draw) {
        ctx.fillStyle = style.card;
        p.roundRect(x, top, width, bottom - top, 36 * s);
        ctx.fill();
        p.font(40 * s, 700);
        ctx.fillStyle = style.text;
        ctx.textBaseline = "top";
        ctx.fillText(dayName(day.date, t), x + cardPad, labelTop);
        chips.forEach((chip) => drawChip(ctx, p, style, chip.x, chip.y, chip.w, chipH, chip.time, 40 * s));
      }
      cursor = bottom + 22 * s;
    }
    return cursor - y - 22 * s;
  }

  function draw(target, cfg, scale = 1) {
    const [W, H] = FORMATS[cfg.format] || FORMATS.story;
    const style = kit.findStyle(cfg.style);
    const { ctx, p } = kit.begin(target, W, H, style, scale);
    const t = TEXT[cfg.lang] || TEXT.ru;
    const titleFamily = style.font === "serif" ? SERIF : SANS;
    const days = activeDays(cfg);
    const padX = 84;
    const width = W - padX * 2;

    // Низ — ник, как записаться, подпись Jazyl. Прижат к нижнему краю.
    kit.drawWatermark(ctx, p, style, t.watermark, W, H - 70);

    let bottomY = H - 140;
    p.font(34, 500);
    const how = howLines(cfg, t).flatMap((line) => p.wrap(line, width));
    for (let i = how.length - 1; i >= 0; i--) {
      p.font(34, 500);
      ctx.fillStyle = style.sub;
      ctx.fillText(how[i], padX, bottomY);
      bottomY -= 46;
    }
    if (cfg.nick.trim()) {
      p.font(48, 800);
      ctx.fillStyle = style.text;
      ctx.fillText(cfg.nick.trim(), padX, bottomY - 4);
      bottomY -= 70;
    }
    const contentBottom = bottomY - 30;

    // Верх: услуга, заголовок, дата, акция, время. Подбираем масштаб, чтобы всё влезло.
    const label = serviceLabel(cfg);
    const sub = subtitle(days, t);
    const promo = cfg.promo.trim();
    const topStart = cfg.format === "story" ? 150 : 100;
    const titleSize = style.font === "serif" ? 132 : 124;

    let s = 1.3;
    let titleLines = [];
    for (; s > 0.45; s -= 0.05) {
      p.font(titleSize * s, style.font === "serif" ? 700 : 800, titleFamily);
      titleLines = p.wrap(t.title, width);
      const titleFits = titleLines.every((line) => ctx.measureText(line).width <= width);
      const headerH =
        (label ? 64 * s : 0) +
        titleLines.length * titleSize * s * 1.02 +
        (sub ? 74 * s : 0) +
        (promo ? 110 * s : 0) +
        48 * s;
      const timesH = days.length ? layoutTimes(ctx, p, days, cfg, style, t, padX, 0, width, s, false) : 80;
      if (titleFits && topStart + headerH + timesH <= contentBottom) break;
    }

    let y = topStart;
    ctx.textBaseline = "top";
    if (label) {
      p.font(30 * s, 700);
      p.spacing(7 * s);
      ctx.fillStyle = style.sub;
      ctx.fillText(label.toUpperCase(), padX, y);
      p.spacing(0);
      y += 64 * s;
    }

    p.font(titleSize * s, style.font === "serif" ? 700 : 800, titleFamily);
    p.spacing(style.font === "serif" ? 0 : -3 * s);
    ctx.fillStyle = style.text;
    for (const line of titleLines) {
      ctx.fillText(line, padX, y);
      y += titleSize * s * 1.02;
    }
    p.spacing(0);

    if (sub) {
      y += 12 * s;
      p.font(44 * s, 600);
      ctx.fillStyle = style.sub;
      ctx.fillText(sub, padX, y);
      y += 62 * s;
    }

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
    y += 48 * s;

    if (days.length) {
      layoutTimes(ctx, p, days, cfg, style, t, padX, y, width, s, true);
    } else {
      p.font(40, 500);
      ctx.fillStyle = style.sub;
      ctx.fillText(t.empty, padX, y);
    }
  }

  // ---------------------------------------------------------------------------
  // Форма
  // ---------------------------------------------------------------------------

  function renderDays() {
    daysBox.innerHTML = state.days
      .map((day, index) => {
        const extra = day.times.filter((time) => !QUICK_TIMES.includes(time));
        const chip = (time) =>
          `<button type="button" class="ok-time" data-time="${time}" aria-pressed="${day.times.includes(time)}">${time}</button>`;
        return `
        <div class="ok-day" data-index="${index}">
          <div class="ok-day__head">
            <input class="tool__input ok-day__date" type="date" value="${day.date}" aria-label="День">
            ${state.days.length > 1 ? `<button type="button" class="ok-day__remove" data-action="remove-day" aria-label="Убрать день">×</button>` : ""}
          </div>
          <div class="ok-times">${[...QUICK_TIMES, ...sortTimes(extra)].map(chip).join("")}</div>
          <div class="ok-day__custom">
            <input class="tool__input" type="time" aria-label="Своё время">
            <button type="button" class="tool__chip-btn" data-action="add-time">Добавить</button>
          </div>
        </div>`;
      })
      .join("");
  }

  function setChoice(group, value) {
    state[group] = value;
    root.querySelectorAll(`[data-${group}]`).forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset[group] === value));
    });
    if (group === "how") {
      $("#okoshki-whatsapp").hidden = value !== "whatsapp";
      $("#okoshki-custom").hidden = value !== "custom";
    }
  }

  function renderStyles() {
    $("#okoshki-styles").innerHTML = kit.styleButtons();
  }

  function syncInputs() {
    const set = (name, value) => {
      const el = root.querySelector(`[name="${name}"]`);
      if (el) el.value = value;
    };
    set("nick", state.nick);
    set("whatsapp", state.whatsapp);
    set("custom", state.custom);
    set("promo", state.promo);
    set("service", state.service);
    set("serviceCustom", state.serviceCustom);
    $("#okoshki-service-custom").hidden = state.service !== "custom";
    ["style", "lang", "format", "how"].forEach((group) => setChoice(group, state[group]));
    renderDays();
  }

  let frame = 0;
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      draw(canvas, state);
      save();
    });
  }

  function preset(kind) {
    const start = kind === "tomorrow" ? addDays(today(), 1) : today();
    const count = kind === "week" ? 7 : 1;
    const previous = new Map(state.days.map((day) => [day.date, day.times]));
    state.days = Array.from({ length: count }, (_, i) => {
      const date = addDays(start, i);
      return { date, times: previous.get(date) || [] };
    });
    renderDays();
    schedule();
  }

  // ---------------------------------------------------------------------------
  // Текст для мессенджеров, сохранение, скачивание
  // ---------------------------------------------------------------------------

  function plainText() {
    const t = TEXT[state.lang];
    const days = activeDays(state);
    const label = serviceLabel(state);
    const lines = [`${t.title}${label ? ` (${label.toLowerCase()})` : ""} ${subtitle(days, t)}`.trim()];
    if (days.length === 1) lines.push(days[0].times.join(", "));
    else days.forEach((day) => lines.push(`${dayName(day.date, t)}: ${day.times.join(", ")}`));
    if (state.promo.trim()) lines.push(state.promo.trim());
    lines.push(...howLines(state, t));
    if (state.nick.trim()) lines.push(state.nick.trim());
    return lines.join("\n");
  }

  function save() {
    try {
      const { nick, how, whatsapp, custom, style, lang, format, service, serviceCustom } = state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ nick, how, whatsapp, custom, style, lang, format, service, serviceCustom }));
    } catch {
      // приватный режим — не страшно
    }
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved) return;
      for (const key of ["nick", "whatsapp", "custom", "serviceCustom"]) {
        if (typeof saved[key] === "string") state[key] = saved[key];
      }
      if (STYLES.some((st) => st.id === saved.style)) state.style = saved.style;
      if (TEXT[saved.lang]) state.lang = saved.lang;
      if (FORMATS[saved.format]) state.format = saved.format;
      if (["link", "direct", "whatsapp", "custom"].includes(saved.how)) state.how = saved.how;
      if (saved.service in SERVICES || saved.service === "custom") state.service = saved.service;
    } catch {
      // сохранённого нет — начинаем с чистого листа
    }
  }

  const fileName = () => `${state.lang === "kk" ? "bos-oryndar" : "svobodnye-okoshki"}-${today()}.png`;
  kit.bindActions({
    canvas,
    render: () => draw(canvas, state),
    fileName,
    text: plainText,
    download: $("#okoshki-download"),
    share: $("#okoshki-share"),
    copy: $("#okoshki-copy"),
  });

  // ---------------------------------------------------------------------------
  // События формы
  // ---------------------------------------------------------------------------

  root.addEventListener("input", (event) => {
    const el = event.target;
    const dayEl = el.closest(".ok-day");
    if (dayEl && el.classList.contains("ok-day__date")) {
      state.days[Number(dayEl.dataset.index)].date = el.value;
    } else if (el.name && el.name in state) {
      state[el.name] = el.value;
      if (el.name === "service") $("#okoshki-service-custom").hidden = el.value !== "custom";
    }
    schedule();
  });

  root.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !root.contains(button)) return;
    const dayEl = button.closest(".ok-day");
    const day = dayEl ? state.days[Number(dayEl.dataset.index)] : null;

    if (button.dataset.time && day) {
      const time = button.dataset.time;
      day.times = day.times.includes(time) ? day.times.filter((x) => x !== time) : sortTimes([...day.times, time]);
      button.setAttribute("aria-pressed", String(day.times.includes(time)));
    } else if (button.dataset.action === "add-time" && day) {
      const input = dayEl.querySelector('input[type="time"]');
      if (!input.value) return input.focus();
      day.times = sortTimes([...day.times, input.value.slice(0, 5)]);
      renderDays();
    } else if (button.dataset.action === "remove-day" && day) {
      state.days.splice(Number(dayEl.dataset.index), 1);
      renderDays();
    } else if (button.dataset.action === "add-day") {
      const last = state.days.length ? state.days[state.days.length - 1].date : today();
      state.days.push({ date: state.days.length ? addDays(last, 1) : today(), times: [] });
      renderDays();
    } else if (button.dataset.preset) {
      preset(button.dataset.preset);
      return;
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

  const tomorrow = addDays(today(), 1);
  const base = { days: [], service: "", serviceCustom: "", style: "cream", format: "story", lang: "ru", nick: "@vash.nik", how: "link", whatsapp: "", custom: "", promo: "" };
  const EXAMPLES = [
    { ...base, service: "manicure", style: "cream", days: [{ date: tomorrow, times: ["10:00", "12:00", "15:00", "18:00"] }] },
    { ...base, service: "massage", style: "chocolate", how: "direct", days: [{ date: tomorrow, times: ["12:00", "15:00", "18:00"] }] },
    { ...base, service: "lashes", style: "powder", days: [{ date: tomorrow, times: ["11:00", "14:00", "17:00"] }] },
    { ...base, service: "brows", style: "sage", promo: "−10% на эти окошки", days: [{ date: tomorrow, times: ["10:00", "13:00", "16:00", "19:00"] }] },
    { ...base, service: "sugaring", style: "minimal", how: "whatsapp", whatsapp: "+7 701 000 00 00", days: [{ date: tomorrow, times: ["10:00", "11:00", "14:00", "16:00", "20:00"] }] },
    { ...base, service: "cosmetology", style: "terracotta", days: [{ date: tomorrow, times: ["11:00", "13:00", "17:00"] }] },
    { ...base, service: "barber", style: "night", how: "direct", days: [{ date: today(), times: ["15:00", "16:30", "18:00", "19:30"] }] },
    {
      ...base,
      service: "hair",
      style: "lavender",
      lang: "kk",
      days: [0, 1, 2, 3, 4].map((i) => ({ date: addDays(today(), i), times: [["10:00", "14:00"], ["12:00"], ["11:00", "16:00", "18:00"], ["15:00"], ["10:00", "13:00"]][i] })),
    },
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
        state.nick = nick;
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
  renderStyles();
  syncInputs();
  draw(canvas, state);

  // Рисуем заново, когда загрузятся шрифты, — иначе первый кадр будет системным шрифтом.
  kit.fontsReady().then(() => {
    schedule();
    renderExamples();
  });
})();
