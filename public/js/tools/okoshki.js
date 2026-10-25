/**
 * Jazyl Студия — «Есть окошки»: сторис со свободным временем.
 *
 * Логика: время пишется текстом, как в директ — «10, 13:30, 17-19» (диапазон = каждый час).
 * На картинке каждое время — отдельный талон; несколько дней — талон на день с корешком-датой.
 * Шаблоны (TEMPLATES) — в порядке подписей в server/site/tools.js.
 */
(() => {
  const root = document.getElementById("okoshki");
  if (!root) return;

  const kit = window.JazylToolKit;
  const $ = (sel) => root.querySelector(sel);
  const canvas = $("#okoshki-canvas");
  const daysBox = $("#okoshki-days");
  const store = kit.storage("jazyl:studio:okoshki");

  const FORMATS = { story: [1080, 1920], post: [1080, 1350] };
  const MAX_TIMES = 16;

  const TEXT = {
    ru: {
      title: ["Есть", "окошки"],
      free: "свободно",
      today: "сегодня",
      tomorrow: "завтра",
      week: "на неделю",
      weekdays: ["вс", "пн", "вт", "ср", "чт", "пт", "сб"],
      months: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
    },
    kk: {
      title: ["Бос", "орындар"],
      free: "бос",
      today: "бүгін",
      tomorrow: "ертең",
      week: "аптаға",
      weekdays: ["жс", "дс", "сс", "ср", "бс", "жм", "сн"],
      months: ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым", "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"],
    },
  };

  // ---------------------------------------------------------------------------
  // Даты и разбор времени
  // ---------------------------------------------------------------------------

  const pad = (n) => String(n).padStart(2, "0");
  const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDate = (s) => {
    const [y, m, d] = String(s).split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (s, n) => {
    const d = parseDate(s);
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  };
  const today = () => toDateStr(new Date());

  /** «10, 13:30, 17-19» → ["10:00", "13:30", "17:00", "18:00", "19:00"]. */
  function parseTimes(text) {
    const out = new Set();
    const src = String(text || "").replace(/[–—]/g, "-");
    const re = /(\d{1,2})(?:[:.](\d{2}))?(?:\s*-\s*(\d{1,2})(?:[:.](\d{2}))?)?/g;
    let m;
    while ((m = re.exec(src)) && out.size < MAX_TIMES) {
      const h1 = Number(m[1]);
      const m1 = Number(m[2] || 0);
      if (h1 > 23 || m1 > 59) continue;
      out.add(`${pad(h1)}:${pad(m1)}`);
      if (m[3] != null) {
        const h2 = Math.min(Number(m[3]), 23);
        for (let h = h1 + 1; h <= h2 && out.size < MAX_TIMES; h += 1) out.add(`${pad(h)}:${pad(m1)}`);
      }
    }
    return [...out].sort();
  }

  function activeDays(cfg) {
    return cfg.days
      .map((day) => ({ date: day.date, times: parseTimes(day.text) }))
      .filter((day) => day.date && day.times.length)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function subtitle(days, t) {
    if (!days.length) return "";
    const fmt = (s) => {
      const d = parseDate(s);
      return `${d.getDate()} ${t.months[d.getMonth()]}`;
    };
    if (days.length === 1) {
      const date = days[0].date;
      if (date === today()) return `${t.today} · ${fmt(date)}`;
      if (date === addDays(today(), 1)) return `${t.tomorrow} · ${fmt(date)}`;
      return `${t.weekdays[parseDate(date).getDay()]} · ${fmt(date)}`;
    }
    const first = parseDate(days[0].date);
    const last = parseDate(days[days.length - 1].date);
    const range =
      first.getMonth() === last.getMonth()
        ? `${first.getDate()}–${last.getDate()} ${t.months[last.getMonth()]}`
        : `${fmt(days[0].date)} – ${fmt(days[days.length - 1].date)}`;
    return `${t.week} · ${range}`;
  }

  // ---------------------------------------------------------------------------
  // Состояние
  // ---------------------------------------------------------------------------

  const state = {
    days: [{ date: addDays(today(), 1), text: "10, 13:30, 17" }],
    label: "",
    promo: "",
    nick: "",
    how: "link",
    whatsapp: "",
    custom: "",
    style: "violet",
    format: "story",
    lang: "ru",
  };

  // ---------------------------------------------------------------------------
  // Рисование
  // ---------------------------------------------------------------------------

  /** Талоны времени. Один день — талон на время (в 2 колонки, если их много); несколько — талон на день. */
  function layoutTickets(ctx, p, days, style, t, x, y, width, s, draw) {
    if (days.length === 1) {
      const times = days[0].times;
      const cols = times.length > 6 ? 2 : 1;
      const gap = 22 * s;
      const h = (cols === 1 ? 128 : 112) * s;
      const w = cols === 1 ? width : (width - gap) / 2;
      const stub = (cols === 1 ? 250 : 120) * s;
      if (draw) {
        times.forEach((time, i) => {
          const tx = x + (cols === 1 ? 0 : (i % 2) * (w + gap));
          const ty = y + Math.floor(cols === 1 ? i : i / 2) * (h + gap);
          kit.ticket(ctx, { x: tx, y: ty, w, h, r: 24 * s, notch: 15 * s, cutX: tx + w - stub, fill: style.ticket, line: style.line });
          ctx.textBaseline = "middle";
          p.font((cols === 1 ? 78 : 62) * s, 800);
          p.spacing(-1 * s);
          ctx.fillStyle = style.ticketText;
          ctx.fillText(time, tx + 44 * s, ty + h / 2 + 3 * s);
          p.spacing(0);
          if (cols === 1) {
            p.font(26 * s, 800);
            p.spacing(4 * s);
            ctx.fillStyle = style.ticketSub;
            ctx.textAlign = "center";
            ctx.fillText(t.free.toUpperCase(), tx + w - stub / 2, ty + h / 2 + 2 * s);
            ctx.textAlign = "left";
            p.spacing(0);
          } else {
            kit.drawStamp(ctx, tx + w - stub / 2 - 22 * s, ty + h / 2 - 22 * s, 44 * s, style.ticketSub, 2.6 * s);
          }
        });
      }
      const rows = cols === 1 ? times.length : Math.ceil(times.length / 2);
      return rows * h + (rows - 1) * gap;
    }

    let cursor = y;
    const stub = 200 * s;
    const lineH = 60 * s;
    for (const day of days) {
      p.font(48 * s, 700);
      const lines = p.wrap(day.times.join("  ·  "), width - stub - 70 * s);
      const h = Math.max(176 * s, lines.length * lineH + 70 * s);
      if (draw) {
        kit.ticket(ctx, { x, y: cursor, w: width, h, r: 26 * s, notch: 15 * s, cutX: x + stub, fill: style.ticket, line: style.line });
        const d = parseDate(day.date);
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        p.font(56 * s, 900);
        ctx.fillStyle = style.ticketText;
        ctx.fillText(t.weekdays[d.getDay()].toUpperCase(), x + stub / 2, cursor + h / 2 + 8 * s);
        p.font(28 * s, 700);
        ctx.fillStyle = style.ticketSub;
        ctx.fillText(`${pad(d.getDate())}.${pad(d.getMonth() + 1)}`, x + stub / 2, cursor + h / 2 + 46 * s);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        p.font(48 * s, 700);
        ctx.fillStyle = style.ticketText;
        const top = cursor + h / 2 - ((lines.length - 1) * lineH) / 2;
        lines.forEach((line, i) => ctx.fillText(line, x + stub + 40 * s, top + i * lineH));
      }
      cursor += h + 22 * s;
    }
    return cursor - y - 22 * s;
  }

  function draw(target, cfg, scale = 1) {
    const [W, H] = FORMATS[cfg.format] || FORMATS.story;
    const style = kit.findStyle(cfg.style);
    const { ctx, p } = kit.begin(target, W, H, style, scale);
    const t = TEXT[cfg.lang] || TEXT.ru;
    const padX = 80;
    const width = W - padX * 2;
    const days = activeDays(cfg);

    const bottom = kit.drawFooter(ctx, p, cfg, style, W, H, padX);
    const top = cfg.format === "story" ? 140 : 80;
    const label = cfg.label.trim();
    const promo = cfg.promo.trim();
    const sub = subtitle(days, t);

    // Подбираем масштаб: заголовок, подзаголовок и талоны должны поместиться
    // Заголовок не шире картинки: «орындар» длиннее «окошки»
    p.font(100, 900);
    p.spacing(-4.5);
    const titleFit = Math.min(...t.title.map((line) => (100 * width) / ctx.measureText(line).width));
    p.spacing(0);
    const titleAt = (k) => Math.min(190 * k, 220, titleFit);
    const topRow = label || promo ? 96 : 0;
    const headerH = (k) => topRow * k + 2 * titleAt(k) * 0.9 + (sub ? 84 * k : 0) + 50 * k;

    let s = 1.3;
    let body = 0;
    for (; s > 0.45; s -= 0.05) {
      body = days.length ? layoutTickets(ctx, p, days, style, t, padX, 0, width, s, false) : 80;
      if (top + headerH(s) + body <= bottom) break;
    }

    // Свободное место — часть сверху, чтобы картинка не «висела» под потолком
    let y = top + Math.min(120, Math.max(0, (bottom - top - headerH(s) - body) * 0.3));
    if (label) {
      kit.sticker(ctx, p, { text: label.toUpperCase(), x: padX, y, size: 30 * s, angle: -0.05, fill: style.ticket, color: style.ticketText });
    }
    if (promo) {
      kit.sticker(ctx, p, { text: promo, x: W - padX, y: y + 4 * s, size: 32 * s, angle: 0.07, fill: style.accent, color: style.accentText, align: "right" });
    }
    y += topRow * s;

    // Заголовок: две строки, самым жирным
    ctx.textBaseline = "alphabetic";
    const titleSize = titleAt(s);
    p.font(titleSize, 900);
    p.spacing(-titleSize * 0.045);
    ctx.fillStyle = style.text;
    t.title.forEach((line, i) => ctx.fillText(line, padX, y + titleSize * 0.82 + i * titleSize * 0.9));
    p.spacing(0);
    y += 2 * titleSize * 0.9;

    if (sub) {
      p.font(44 * s, 600);
      ctx.fillStyle = style.sub;
      ctx.fillText(sub, padX, y + 44 * s);
      y += 84 * s;
    }
    y += 50 * s;

    if (days.length) {
      layoutTickets(ctx, p, days, style, t, padX, y, width, s, true);
    } else {
      p.font(40, 600);
      ctx.fillStyle = style.sub;
      ctx.fillText(cfg.lang === "kk" ? "Бос уақытты жазыңыз" : "Напишите свободное время", padX, y + 40);
    }
  }

  // ---------------------------------------------------------------------------
  // Форма
  // ---------------------------------------------------------------------------

  const escapeAttr = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

  function renderDays() {
    daysBox.innerHTML = state.days
      .map((day, i) => {
        const times = parseTimes(day.text);
        return `
        <div class="st-day" data-index="${i}">
          <input class="st-input st-day__date" type="date" value="${escapeAttr(day.date)}" aria-label="День">
          <input class="st-input st-day__times" value="${escapeAttr(day.text)}" placeholder="10, 13:30, 17-19" aria-label="Свободное время">
          ${state.days.length > 1 ? `<button type="button" class="st-x" data-action="remove-day" aria-label="Убрать день">×</button>` : ""}
          <span class="st-day__parsed">${times.length ? times.join(" · ") : "Время не распознано"}</span>
        </div>`;
      })
      .join("");
  }

  function updateParsed(index) {
    const row = daysBox.querySelector(`.st-day[data-index="${index}"] .st-day__parsed`);
    const times = parseTimes(state.days[index].text);
    if (row) row.textContent = times.length ? times.join(" · ") : "Время не распознано";
  }

  function setChoice(group, value) {
    state[group] = value;
    kit.setPressed(root, group, value);
    if (group === "how") {
      $("#okoshki-whatsapp").hidden = value !== "whatsapp";
      $("#okoshki-custom").hidden = value !== "custom";
    }
  }

  const FIELDS = ["label", "promo", "nick", "whatsapp", "custom"];

  function syncInputs() {
    for (const name of FIELDS) {
      const el = root.querySelector(`[name="${name}"]`);
      if (el) el.value = state[name];
    }
    ["style", "format", "lang", "how"].forEach((g) => setChoice(g, state[g]));
    renderDays();
  }

  function save() {
    const { label, nick, how, whatsapp, custom, style, format, lang } = state;
    store.save({ label, nick, how, whatsapp, custom, style, format, lang });
  }

  const redraw = kit.scheduler(() => {
    draw(canvas, state);
    save();
  });

  function restore() {
    const saved = store.load();
    if (!saved) return;
    for (const key of ["label", "nick", "whatsapp", "custom"]) if (typeof saved[key] === "string") state[key] = saved[key].slice(0, 60);
    if (kit.STYLES.some((st) => st.id === saved.style)) state.style = saved.style;
    if (FORMATS[saved.format]) state.format = saved.format;
    if (TEXT[saved.lang]) state.lang = saved.lang;
    if (["link", "direct", "whatsapp", "custom"].includes(saved.how)) state.how = saved.how;
  }

  function plainText() {
    const t = TEXT[state.lang];
    const days = activeDays(state);
    const lines = [`${t.title.join(" ")}${state.label.trim() ? ` (${state.label.trim()})` : ""} — ${subtitle(days, t)}`];
    if (days.length === 1) lines.push(days[0].times.join(", "));
    else days.forEach((d) => lines.push(`${t.weekdays[parseDate(d.date).getDay()]} ${parseDate(d.date).getDate()}: ${d.times.join(", ")}`));
    if (state.promo.trim()) lines.push(state.promo.trim());
    lines.push(...kit.howLines(state));
    if (state.nick.trim()) lines.push(state.nick.trim());
    return lines.join("\n");
  }

  kit.bindActions({
    canvas,
    render: () => draw(canvas, state),
    fileName: () => `${state.lang === "kk" ? "bos-oryndar" : "est-okoshki"}-${today()}.png`,
    text: plainText,
    download: $("#okoshki-download"),
    share: $("#okoshki-share"),
    copy: $("#okoshki-copy"),
  });

  root.addEventListener("input", (event) => {
    const el = event.target;
    const dayEl = el.closest(".st-day");
    if (dayEl) {
      const i = Number(dayEl.dataset.index);
      if (el.classList.contains("st-day__date")) state.days[i].date = el.value;
      if (el.classList.contains("st-day__times")) {
        state.days[i].text = el.value;
        updateParsed(i);
      }
    } else if (FIELDS.includes(el.name)) {
      state[el.name] = el.value;
    }
    redraw();
  });

  root.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !root.contains(button) || button.dataset.template) return;
    const action = button.dataset.action;
    if (action === "add-day") {
      const last = state.days[state.days.length - 1]?.date || today();
      state.days.push({ date: addDays(last, 1), text: "" });
      renderDays();
      daysBox.querySelector(".st-day:last-child .st-day__times")?.focus();
    } else if (action === "remove-day") {
      state.days.splice(Number(button.closest(".st-day").dataset.index), 1);
      renderDays();
    } else if (button.dataset.preset) {
      const kind = button.dataset.preset;
      const start = kind === "tomorrow" ? addDays(today(), 1) : today();
      const count = kind === "week" ? 5 : 1;
      const texts = new Map(state.days.map((d) => [d.date, d.text]));
      const fallback = state.days[0]?.text || "";
      state.days = Array.from({ length: count }, (_, i) => {
        const date = addDays(start, i);
        return { date, text: texts.get(date) ?? (count === 1 ? fallback : "") };
      });
      renderDays();
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

  const tomorrow = addDays(today(), 1);
  const base = { label: "", promo: "", nick: "@vash.nik", how: "link", whatsapp: "", custom: "", format: "story", lang: "ru" };
  const TEMPLATES = [
    { ...base, style: "violet", label: "Маникюр", days: [{ date: tomorrow, text: "10, 12:30, 15, 18" }] },
    { ...base, style: "graphite", label: "Barber", how: "direct", days: [{ date: today(), text: "15-19" }] },
    {
      ...base,
      style: "milk",
      label: "Ресницы",
      days: [0, 1, 2, 3, 4].map((i) => ({ date: addDays(tomorrow, i), text: ["11, 15", "10", "12, 16, 18", "14", "10, 13"][i] })),
    },
    { ...base, style: "coral", label: "Массаж", promo: "−15% сегодня", days: [{ date: today(), text: "12, 14:30, 17" }] },
    { ...base, style: "mint", label: "Брови", how: "whatsapp", whatsapp: "+7 701 000 00 00", days: [{ date: tomorrow, text: "11, 13, 16, 19" }] },
    { ...base, style: "sky", label: "Шаш қию", lang: "kk", days: [{ date: tomorrow, text: "10, 14, 18" }] },
  ];

  function applyTemplate(i) {
    const own = { nick: state.nick };
    Object.assign(state, JSON.parse(JSON.stringify(TEMPLATES[i])));
    if (own.nick.trim()) state.nick = own.nick;
    syncInputs();
    redraw();
  }

  // ---------------------------------------------------------------------------
  // Старт
  // ---------------------------------------------------------------------------

  restore();
  $("#okoshki-styles").innerHTML = kit.styleButtons();
  syncInputs();
  draw(canvas, state);
  kit.fontsReady().then(() => {
    redraw();
    kit.renderTemplates(draw, TEMPLATES, applyTemplate);
  });
})();
