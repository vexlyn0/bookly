/**
 * Jazyl — инструмент «Свободные окошки»: картинка для сторис/поста со свободным временем.
 * Всё рисуется в браузере на canvas, на сервер ничего не уходит.
 */
(() => {
  const form = document.getElementById("okoshki-form");
  const canvas = document.getElementById("okoshki-canvas");
  if (!form || !canvas) return;

  const ctx = canvas.getContext("2d");
  const daysBox = document.getElementById("okoshki-days");
  const themesBox = document.getElementById("okoshki-themes");
  const downloadBtn = document.getElementById("okoshki-download");
  const shareBtn = document.getElementById("okoshki-share");
  const STORAGE_KEY = "jazyl:tool:okoshki";

  const FORMATS = { story: [1080, 1920], post: [1080, 1350] };

  const THEMES = [
    { id: "night", name: "Ночь", bg: ["#2a2550", "#0d0c14"], text: "#ffffff", sub: "#afa9ec", card: "rgba(255,255,255,0.08)", chip: "#7f77dd", chipText: "#ffffff", glow: "rgba(127,119,221,0.35)" },
    { id: "lavender", name: "Лаванда", bg: ["#f6f5ff", "#cecbf6"], text: "#26215c", sub: "#534ab7", card: "rgba(255,255,255,0.7)", chip: "#534ab7", chipText: "#ffffff", glow: "rgba(127,119,221,0.25)" },
    { id: "peach", name: "Персик", bg: ["#fff5f0", "#f5c4b3"], text: "#4a1b0c", sub: "#993c1d", card: "rgba(255,255,255,0.65)", chip: "#d85a30", chipText: "#ffffff", glow: "rgba(240,153,123,0.35)" },
    { id: "mint", name: "Мята", bg: ["#f1fbf7", "#9fe1cb"], text: "#04342c", sub: "#0f6e56", card: "rgba(255,255,255,0.65)", chip: "#0f6e56", chipText: "#ffffff", glow: "rgba(93,202,165,0.35)" },
    { id: "beige", name: "Беж", bg: ["#fbf7f1", "#e6d6c0"], text: "#3b2a1a", sub: "#8b5e3c", card: "rgba(255,255,255,0.65)", chip: "#8b5e3c", chipText: "#ffffff", glow: "rgba(186,117,23,0.2)" },
    { id: "pink", name: "Розовый", bg: ["#fff2f7", "#f4c0d1"], text: "#4b1528", sub: "#993556", card: "rgba(255,255,255,0.65)", chip: "#d4537e", chipText: "#ffffff", glow: "rgba(212,83,126,0.3)" },
  ];

  const TEXT = {
    ru: {
      title: "Свободные окошки",
      today: "сегодня",
      tomorrow: "завтра",
      forToday: "на сегодня",
      forTomorrow: "на завтра",
      cta: "Запись по ссылке в профиле",
      watermark: "сделано в Jazyl",
      weekdays: ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"],
      months: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
    },
    kk: {
      title: "Бос орындар",
      today: "бүгін",
      tomorrow: "ертең",
      forToday: "бүгінге",
      forTomorrow: "ертеңге",
      cta: "Профильдегі сілтеме арқылы жазылыңыз",
      watermark: "Jazyl арқылы жасалған",
      weekdays: ["жексенбі", "дүйсенбі", "сейсенбі", "сәрсенбі", "бейсенбі", "жұма", "сенбі"],
      months: ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым", "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"],
    },
  };

  const state = { theme: "night", lang: "ru", format: "story" };

  // ---------------------------------------------------------------------------
  // Даты
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

  /** «10, 12.30 15:00» → ["10:00", "12:30", "15:00"], по порядку, без повторов. */
  function parseTimes(value) {
    const found = String(value || "").match(/\d{1,2}(?:[:.]\d{2})?/g) || [];
    const times = found
      .map((t) => {
        const [h, m = "00"] = t.split(/[:.]/);
        const hours = Number(h);
        if (hours > 23 || Number(m) > 59) return null;
        return `${pad(hours)}:${m}`;
      })
      .filter(Boolean);
    return [...new Set(times)].sort();
  }

  function dayLabel(dateStr, t) {
    const d = parseDate(dateStr);
    const date = `${d.getDate()} ${t.months[d.getMonth()]}`;
    if (dateStr === today()) return `${capitalize(t.today)}, ${date}`;
    if (dateStr === addDays(today(), 1)) return `${capitalize(t.tomorrow)}, ${date}`;
    return `${capitalize(t.weekdays[d.getDay()])}, ${date}`;
  }

  function subtitle(days, t) {
    if (!days.length) return "";
    if (days.length === 1) {
      const [only] = days;
      if (only.date === today()) return t.forToday;
      if (only.date === addDays(today(), 1)) return t.forTomorrow;
      const d = parseDate(only.date);
      return `${d.getDate()} ${t.months[d.getMonth()]}`;
    }
    const first = parseDate(days[0].date);
    const last = parseDate(days[days.length - 1].date);
    return first.getMonth() === last.getMonth()
      ? `${first.getDate()} – ${last.getDate()} ${t.months[last.getMonth()]}`
      : `${first.getDate()} ${t.months[first.getMonth()]} – ${last.getDate()} ${t.months[last.getMonth()]}`;
  }

  // ---------------------------------------------------------------------------
  // Форма
  // ---------------------------------------------------------------------------

  function addDayRow(date = today(), times = "") {
    const row = document.createElement("div");
    row.className = "okoshki-day";
    row.innerHTML = `
      <input class="tool__input" type="date" name="date" value="${date}" aria-label="День">
      <input class="tool__input" type="text" name="times" value="${times}" placeholder="10:00, 13:30, 17:00" inputmode="numeric" aria-label="Свободное время">
      <button class="okoshki-day__remove" type="button" data-action="remove-day" aria-label="Убрать день">×</button>`;
    daysBox.appendChild(row);
  }

  function readDays() {
    return [...daysBox.querySelectorAll(".okoshki-day")]
      .map((row) => ({
        date: row.querySelector('[name="date"]').value,
        times: parseTimes(row.querySelector('[name="times"]').value),
      }))
      .filter((day) => day.date && day.times.length)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function readForm() {
    const value = (name) => String(form.elements.namedItem(name)?.value || "").trim();
    return { salon: value("salon"), cta: value("cta"), link: value("link"), days: readDays() };
  }

  function preset(kind) {
    const start = kind === "tomorrow" ? addDays(today(), 1) : today();
    const count = kind === "week" ? 7 : 1;
    // Уже вписанное время для этих дат сохраняем.
    const existing = new Map(
      [...daysBox.querySelectorAll(".okoshki-day")].map((row) => [
        row.querySelector('[name="date"]').value,
        row.querySelector('[name="times"]').value,
      ])
    );
    daysBox.innerHTML = "";
    for (let i = 0; i < count; i++) {
      const date = addDays(start, i);
      addDayRow(date, existing.get(date) || "");
    }
    daysBox.querySelector('[name="times"]')?.focus();
    schedule();
  }

  function setChoice(group, value) {
    state[group] = value;
    form.querySelectorAll(`[data-${group}]`).forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset[group] === value));
    });
  }

  function renderThemes() {
    themesBox.innerHTML = THEMES.map(
      (theme) => `
      <button type="button" class="okoshki-theme" data-theme="${theme.id}" aria-pressed="false" title="${theme.name}"
        style="background:linear-gradient(160deg, ${theme.bg[0]}, ${theme.bg[1]})">
        <span style="background:${theme.chip}"></span>
      </button>`
    ).join("");
  }

  // ---------------------------------------------------------------------------
  // Рисование
  // ---------------------------------------------------------------------------

  const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';

  function setFont(size, weight = 700) {
    ctx.font = `${weight} ${Math.round(size)}px ${FONT}`;
  }

  function setSpacing(px) {
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${px}px`;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapText(text, maxWidth) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  /**
   * Раскладка блока дней при масштабе s. draw=false — только считает высоту.
   * @returns высота блока
   */
  function layoutDays(days, t, theme, x, y, width, s, draw) {
    let cursor = y;
    const cardPad = 34 * s;
    const chipH = 82 * s;
    const chipGap = 16 * s;
    const chipPadX = 32 * s;

    for (const day of days) {
      const top = cursor;
      const labelTop = top + cardPad;
      const chipsTop = labelTop + 52 * s + 18 * s;

      // Сначала раскладываем время по строкам — так известна высота карточки.
      setFont(42 * s, 700);
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
        ctx.fillStyle = theme.card;
        roundRect(x, top, width, bottom - top, 40 * s);
        ctx.fill();

        ctx.fillStyle = theme.text;
        ctx.textBaseline = "top";
        ctx.fillText(dayLabel(day.date, t), x + cardPad, labelTop);

        ctx.textBaseline = "middle";
        for (const chip of chips) {
          ctx.fillStyle = theme.chip;
          roundRect(chip.x, chip.y, chip.w, chipH, chipH / 2);
          ctx.fill();
          ctx.fillStyle = theme.chipText;
          ctx.fillText(chip.time, chip.x + chipPadX, chip.y + chipH / 2 + 2 * s);
        }
      }
      cursor = bottom + 24 * s;
    }
    return cursor - y;
  }

  function draw() {
    const [W, H] = FORMATS[state.format];
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const theme = THEMES.find((th) => th.id === state.theme) || THEMES[0];
    const t = TEXT[state.lang];
    const data = readForm();
    const padX = 84;

    // Фон
    const gradient = ctx.createLinearGradient(0, 0, W * 0.4, H);
    gradient.addColorStop(0, theme.bg[0]);
    gradient.addColorStop(1, theme.bg[1]);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W * 0.9, H * 0.08, 0, W * 0.9, H * 0.08, W * 0.75);
    glow.addColorStop(0, theme.glow);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Низ: подпись, ссылка, водяной знак — фиксированно у нижнего края
    const footerLines = [];
    const cta = data.cta || t.cta;
    let footerTop = H - 70;
    setFont(26, 500);
    setSpacing(1);
    ctx.fillStyle = theme.sub;
    ctx.globalAlpha = 0.75;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";
    ctx.fillText(t.watermark, W / 2, H - 56);
    ctx.globalAlpha = 1;
    setSpacing(0);

    if (data.link) {
      setFont(52, 800);
      footerLines.push({ text: data.link, size: 52, weight: 800, color: theme.text });
    }
    setFont(38, 600);
    wrapText(cta, W - padX * 2)
      .reverse()
      .forEach((line) => footerLines.unshift({ text: line, size: 38, weight: 600, color: theme.sub }));

    footerTop -= 40;
    for (let i = footerLines.length - 1; i >= 0; i--) {
      const line = footerLines[i];
      setFont(line.size, line.weight);
      ctx.fillStyle = line.color;
      ctx.fillText(line.text, W / 2, footerTop);
      footerTop -= line.size * 1.3;
    }
    ctx.textAlign = "left";
    const contentBottom = footerTop - 30;

    // Верх: салон, заголовок, период. Подбираем масштаб, чтобы всё влезло.
    const days = data.days;
    const sub = subtitle(days, t);
    const width = W - padX * 2;
    const topStart = state.format === "story" ? 150 : 96;

    // Мало окошек — крупнее (до 1.35), много — мельче (до 0.45).
    let s = 1.35;
    let headerH = 0;
    let titleLines = [];
    for (; s >= 0.45; s -= 0.05) {
      setFont(124 * s, 800);
      titleLines = wrapText(t.title, width);
      headerH = (data.salon ? 64 * s : 0) + titleLines.length * 124 * s * 1.02 + (sub ? 78 * s : 0) + 50 * s;
      const daysH = days.length ? layoutDays(days, t, theme, padX, 0, width, s, false) : 120;
      setFont(124 * s, 800);
      const titleFits = titleLines.every((line) => ctx.measureText(line).width <= width);
      if (titleFits && topStart + headerH + daysH <= contentBottom) break;
    }
    s = Math.max(s, 0.45);

    let y = topStart;
    ctx.textBaseline = "top";
    if (data.salon) {
      setFont(34 * s, 700);
      setSpacing(6 * s);
      ctx.fillStyle = theme.sub;
      ctx.fillText(data.salon.toUpperCase(), padX, y);
      setSpacing(0);
      y += 64 * s;
    }

    setFont(124 * s, 800);
    setSpacing(-3 * s);
    ctx.fillStyle = theme.text;
    for (const line of titleLines) {
      ctx.fillText(line, padX, y);
      y += 124 * s * 1.02;
    }
    setSpacing(0);

    if (sub) {
      y += 10 * s;
      setFont(50 * s, 500);
      ctx.fillStyle = theme.sub;
      ctx.fillText(sub, padX, y);
      y += 68 * s;
    }
    y += 40 * s;

    if (days.length) {
      layoutDays(days, t, theme, padX, y, width, s, true);
    } else {
      setFont(40, 500);
      ctx.fillStyle = theme.sub;
      ctx.fillText(state.lang === "kk" ? "Бос уақытты енгізіңіз" : "Впишите свободное время", padX, y);
    }
  }

  let frame = 0;
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      draw();
      save();
    });
  }

  // ---------------------------------------------------------------------------
  // Сохранение настроек в браузере и скачивание
  // ---------------------------------------------------------------------------

  function save() {
    try {
      const { salon, cta, link } = readForm();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ salon, cta, link, theme: state.theme, lang: state.lang, format: state.format }));
    } catch {
      // приватный режим — не страшно
    }
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved) return;
      ["salon", "cta", "link"].forEach((name) => {
        if (saved[name]) form.elements.namedItem(name).value = saved[name];
      });
      if (THEMES.some((th) => th.id === saved.theme)) state.theme = saved.theme;
      if (TEXT[saved.lang]) state.lang = saved.lang;
      if (FORMATS[saved.format]) state.format = saved.format;
    } catch {
      // нет сохранённого — начинаем с чистого листа
    }
  }

  function fileName() {
    return `${state.lang === "kk" ? "bos-oryndar" : "svobodnye-okoshki"}-${today()}.png`;
  }

  function toBlob() {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  downloadBtn?.addEventListener("click", async () => {
    draw();
    const blob = await toBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  // На телефоне — «Поделиться»: сразу в Instagram, WhatsApp, Telegram.
  if (shareBtn && navigator.canShare) {
    const probe = new File([new Blob()], "x.png", { type: "image/png" });
    if (navigator.canShare({ files: [probe] })) {
      shareBtn.hidden = false;
      shareBtn.addEventListener("click", async () => {
        draw();
        const blob = await toBlob();
        if (!blob) return;
        try {
          await navigator.share({ files: [new File([blob], fileName(), { type: "image/png" })] });
        } catch {
          // пользователь закрыл окно «Поделиться»
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Старт
  // ---------------------------------------------------------------------------

  renderThemes();
  restore();
  setChoice("theme", state.theme);
  setChoice("lang", state.lang);
  setChoice("format", state.format);
  addDayRow(today(), "");
  addDayRow(addDays(today(), 1), "");

  form.addEventListener("input", schedule);
  form.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.preset) preset(button.dataset.preset);
    else if (button.dataset.action === "add-day") {
      const rows = readDays();
      const last = rows.length ? rows[rows.length - 1].date : today();
      addDayRow(rows.length ? addDays(last, 1) : today(), "");
      schedule();
    } else if (button.dataset.action === "remove-day") {
      button.closest(".okoshki-day")?.remove();
      schedule();
    } else {
      for (const group of ["theme", "lang", "format"]) {
        if (button.dataset[group]) {
          setChoice(group, button.dataset[group]);
          schedule();
        }
      }
    }
  });

  // Рисуем, когда загрузится шрифт Inter, — иначе первый кадр будет системным шрифтом.
  draw();
  (document.fonts?.ready || Promise.resolve()).then(() => {
    Promise.all([
      document.fonts?.load?.(`800 124px "Inter"`),
      document.fonts?.load?.(`700 42px "Inter"`),
      document.fonts?.load?.(`500 50px "Inter"`),
    ]).finally(schedule);
  });
})();
