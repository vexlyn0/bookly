/**
 * Jazyl — инструмент «Подарочный сертификат»: сертификат с QR-кодом для печати или отправки в WhatsApp.
 * Всё рисуется в браузере на canvas (общее — в kit.js, QR — vendor/qrcode-generator), на сервер ничего не уходит.
 *
 * Состояние — в объекте state. Запоминаем только данные салона (название, ссылка для QR, контакты, вид),
 * а кому / от кого / номер — у каждого сертификата свои.
 * Примеры внизу страницы (EXAMPLES) идут в том же порядке, что подписи в server/site/tools.js.
 */
(() => {
  const root = document.getElementById("sertifikat");
  if (!root || !window.qrcode) return;

  const kit = window.JazylToolKit;
  const { SANS, SERIF, STYLES } = kit;
  window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs["UTF-8"];

  const $ = (sel) => root.querySelector(sel);
  const canvas = $("#sertifikat-canvas");
  const STORAGE_KEY = "jazyl:tool:sertifikat";

  /** wide — 2:1, как подарочная карта (печать 21×10,5 см); post и story — для WhatsApp и Instagram. */
  const FORMATS = { wide: [2000, 1000], post: [1080, 1350], story: [1080, 1920] };

  const TEXT = {
    ru: {
      title: "Подарочный сертификат",
      amountLabel: "Номинал",
      serviceLabel: "Услуга",
      to: "Кому",
      from: "От",
      until: (date) => `действует до ${date}`,
      qr: "Наведите камеру, чтобы записаться",
      watermark: "сделано в Jazyl",
    },
    kk: {
      title: "Сыйлық сертификаты",
      amountLabel: "Сомасы",
      serviceLabel: "Қызмет",
      to: "Кімге",
      from: "Кімнен",
      until: (date) => `${date} дейін жарамды`,
      qr: "Жазылу үшін камераны бағыттаңыз",
      watermark: "Jazyl арқылы жасалған",
    },
  };

  // ---------------------------------------------------------------------------
  // Данные
  // ---------------------------------------------------------------------------

  const pad = (n) => String(n).padStart(2, "0");
  const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function monthsFromNow(months) {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return toDateStr(d);
  }

  function formatDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
  }

  /** Номер сертификата: 6 знаков без похожих букв и цифр (0/O, 1/I). */
  function newNumber() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(6);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  }

  const groupDigits = (digits) => String(Number(digits)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

  function valueText(cfg) {
    if (cfg.kind === "service") return cfg.service.trim();
    const digits = String(cfg.amount || "").replace(/\D/g, "");
    return digits ? `${groupDigits(digits.slice(0, 9))} ₸` : "";
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

  const state = {
    salon: "",
    kind: "amount",
    amount: "10000",
    service: "",
    to: "",
    from: "",
    wish: "",
    until: monthsFromNow(3),
    number: newNumber(),
    qr: "",
    contacts: "",
    style: "lavender",
    format: "wide",
    lang: "ru",
  };

  // ---------------------------------------------------------------------------
  // QR
  // ---------------------------------------------------------------------------

  const qrCache = new Map();
  function qrMatrix(text) {
    if (!qrCache.has(text)) {
      try {
        const qr = window.qrcode(0, "M");
        qr.addData(text);
        qr.make();
        const n = qr.getModuleCount();
        qrCache.set(text, { n, dark: (r, c) => qr.isDark(r, c) });
      } catch {
        qrCache.set(text, null); // слишком длинный текст
      }
    }
    return qrCache.get(text);
  }

  function luminance(hex) {
    const m = String(hex).match(/^#([0-9a-f]{6})$/i);
    if (!m) return 1;
    const n = parseInt(m[1], 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  }

  /** Белая плашка с QR. Тёмные модули — цвет текста стиля, если он тёмный, иначе почти чёрный. */
  function drawQr(ctx, p, style, text, x, y, size) {
    const matrix = qrMatrix(text);
    ctx.fillStyle = "#ffffff";
    p.roundRect(x, y, size, size, size * 0.08);
    ctx.fill();
    if (!matrix) return;
    const quiet = 2;
    const cell = size / (matrix.n + quiet * 2);
    ctx.fillStyle = luminance(style.text) < 0.4 ? style.text : "#15131f";
    for (let r = 0; r < matrix.n; r += 1) {
      for (let c = 0; c < matrix.n; c += 1) {
        if (matrix.dark(r, c)) {
          // +0.5 — без светлых щелей между модулями
          ctx.fillRect(x + (c + quiet) * cell, y + (r + quiet) * cell, cell + 0.5, cell + 0.5);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Рисование: draw(canvas, cfg, scale) — одна функция и для предпросмотра, и для примеров
  // ---------------------------------------------------------------------------

  /**
   * Текстовая колонка: салон, заголовок, номинал, кому / от кого, пожелание.
   * draw=false — только измерить высоту.
   */
  function layoutText(ctx, p, cfg, style, t, x, y, width, s, draw, center) {
    const titleFamily = style.font === "serif" ? SERIF : SANS;
    const titleWeight = style.font === "serif" ? 700 : 800;
    const align = (w) => (center ? x + (width - w) / 2 : x);
    let cursor = y;

    const salon = cfg.salon.trim();
    if (salon) {
      p.font(32 * s, 700);
      p.spacing(7 * s);
      const text = p.fit(salon.toUpperCase(), width);
      if (draw) {
        ctx.fillStyle = style.sub;
        ctx.fillText(text, align(ctx.measureText(text).width), cursor);
      }
      p.spacing(0);
      cursor += 66 * s;
    }

    p.font(96 * s, titleWeight, titleFamily);
    p.spacing(style.font === "serif" ? 0 : -2 * s);
    const titleLines = p.wrap(t.title, width);
    titleLines.forEach((line) => {
      if (draw) {
        ctx.fillStyle = style.text;
        ctx.fillText(line, align(ctx.measureText(line).width), cursor);
      }
      cursor += 100 * s;
    });
    p.spacing(0);
    cursor += 30 * s;

    // Номинал: сумма крупно, услуга — до двух строк
    const value = valueText(cfg);
    if (value) {
      p.font(28 * s, 700);
      p.spacing(5 * s);
      const label = (cfg.kind === "service" ? t.serviceLabel : t.amountLabel).toUpperCase();
      if (draw) {
        ctx.fillStyle = style.sub;
        ctx.globalAlpha = 0.85;
        ctx.fillText(label, align(ctx.measureText(label).width), cursor);
        ctx.globalAlpha = 1;
      }
      p.spacing(0);
      cursor += 46 * s;

      const big = cfg.kind === "amount";
      p.font((big ? 130 : 66) * s, 800, big ? titleFamily : SANS);
      let lines = big ? [value] : p.wrap(value, width);
      if (lines.length > 2) lines = [lines[0], p.fit(lines.slice(1).join(" "), width)];
      lines.forEach((line) => {
        if (draw) {
          ctx.fillStyle = style.sub;
          ctx.fillText(line, align(ctx.measureText(line).width), cursor);
        }
        cursor += (big ? 140 : 76) * s;
      });
      cursor += 22 * s;
    }

    // Кому / от кого
    for (const [label, raw] of [[t.to, cfg.to], [t.from, cfg.from]]) {
      const name = String(raw || "").trim();
      if (!name) continue;
      p.font(40 * s, 500);
      const prefix = `${label}: `;
      const prefixW = ctx.measureText(prefix).width;
      p.font(40 * s, 700);
      const nameText = p.fit(name, width - prefixW);
      const total = prefixW + ctx.measureText(nameText).width;
      if (draw) {
        const left = align(total);
        p.font(40 * s, 500);
        ctx.fillStyle = style.sub;
        ctx.fillText(prefix, left, cursor);
        p.font(40 * s, 700);
        ctx.fillStyle = style.text;
        ctx.fillText(nameText, left + prefixW, cursor);
      }
      cursor += 56 * s;
    }

    const wish = cfg.wish.trim();
    if (wish) {
      cursor += 12 * s;
      p.font(36 * s, 500, titleFamily);
      let lines = p.wrap(wish, width);
      if (lines.length > 3) lines = [...lines.slice(0, 2), p.fit(lines.slice(2).join(" "), width)];
      lines.forEach((line) => {
        if (draw) {
          ctx.fillStyle = style.text;
          ctx.globalAlpha = 0.85;
          ctx.fillText(line, align(ctx.measureText(line).width), cursor);
          ctx.globalAlpha = 1;
        }
        cursor += 48 * s;
      });
    }
    return cursor - y;
  }

  /** «№ A7K2QF · действует до 25.01.2027» */
  function metaLine(cfg, t) {
    const parts = [];
    if (cfg.number.trim()) parts.push(`№ ${cfg.number.trim()}`);
    const until = formatDate(cfg.until);
    if (until) parts.push(t.until(until));
    return parts.join(" · ");
  }

  /** Подбирает масштаб текста, чтобы колонка влезла в высоту. */
  function fitScale(ctx, p, cfg, style, t, width, maxH, center, from = 1.15) {
    for (let s = from; s > 0.45; s -= 0.05) {
      if (layoutText(ctx, p, cfg, style, t, 0, 0, width, s, false, center) <= maxH) return s;
    }
    return 0.45;
  }

  function draw(target, cfg, scale = 1) {
    const [W, H] = FORMATS[cfg.format] || FORMATS.wide;
    const style = kit.findStyle(cfg.style);
    const { ctx, p } = kit.begin(target, W, H, style, scale);
    const t = TEXT[cfg.lang] || TEXT.ru;
    const qrText = qrTarget(cfg.qr);
    const meta = metaLine(cfg, t);
    const contacts = cfg.contacts.trim();
    ctx.textBaseline = "top";

    if (W > H) {
      // Горизонтальный: слева текст, справа плашка с QR
      kit.drawWatermark(ctx, p, style, t.watermark, W, H - 34);
      ctx.textBaseline = "top";
      const padX = 120;
      const panelW = qrText ? 560 : 0;
      const panelX = W - padX - panelW + 40;
      const textW = (qrText ? panelX - 80 : W - padX) - padX;

      let bottom = H - 110;
      p.font(30, 600);
      if (meta) {
        ctx.fillStyle = style.sub;
        ctx.fillText(p.fit(meta, textW), padX, bottom - 30);
        bottom -= 50;
      }
      if (contacts) {
        p.font(30, 500);
        ctx.fillStyle = style.text;
        ctx.fillText(p.fit(contacts, textW), padX, bottom - 30);
        bottom -= 50;
      }

      const top = 100;
      const space = bottom - 40 - top;
      const s = fitScale(ctx, p, cfg, style, t, textW, space, false, 1.6);
      const textH = layoutText(ctx, p, cfg, style, t, padX, 0, textW, s, false, false);
      // Текст — по центру свободного места над номером
      layoutText(ctx, p, cfg, style, t, padX, top + Math.max(0, (space - textH) / 2), textW, s, true, false);

      if (qrText) {
        const panelY = 90;
        const panelH = H - 180;
        ctx.fillStyle = style.card;
        p.roundRect(panelX, panelY, panelW, panelH, 40);
        ctx.fill();

        // QR и подпись — по центру плашки
        const qrSize = 420;
        p.font(30, 600);
        const caption = p.wrap(t.qr, panelW - 80).slice(0, 2);
        const blockH = qrSize + 36 + caption.length * 42;
        const qrX = panelX + (panelW - qrSize) / 2;
        const qrY = panelY + (panelH - blockH) / 2;
        drawQr(ctx, p, style, qrText, qrX, qrY, qrSize);

        ctx.textAlign = "center";
        p.font(30, 600);
        ctx.fillStyle = style.text;
        caption.forEach((line, i) => {
          ctx.fillText(line, panelX + panelW / 2, qrY + qrSize + 36 + i * 42);
        });
        ctx.textAlign = "left";
      }
      return;
    }

    // Вертикальный (пост, сторис): всё по центру, QR внизу
    kit.drawWatermark(ctx, p, style, t.watermark, W, H - 60);
    ctx.textBaseline = "top";
    const padX = 90;
    const width = W - padX * 2;
    const story = H / W > 1.5;

    let bottom = H - 110;
    ctx.textAlign = "center";
    if (meta) {
      p.font(30, 600);
      ctx.fillStyle = style.sub;
      ctx.fillText(p.fit(meta, width), W / 2, bottom - 30);
      bottom -= 52;
    }
    if (contacts) {
      p.font(30, 500);
      ctx.fillStyle = style.text;
      p.wrap(contacts, width)
        .slice(0, 2)
        .reverse()
        .forEach((line) => {
          ctx.fillText(line, W / 2, bottom - 30);
          bottom -= 42;
        });
      bottom -= 10;
    }
    if (qrText) {
      const qrSize = story ? 340 : 250;
      p.font(28, 600);
      ctx.fillStyle = style.text;
      ctx.fillText(p.fit(t.qr, width), W / 2, bottom - 30);
      bottom -= 48;
      drawQr(ctx, p, style, qrText, (W - qrSize) / 2, bottom - qrSize, qrSize);
      bottom -= qrSize + 40;
    }
    ctx.textAlign = "left";

    const top = story ? 170 : 100;
    const s = fitScale(ctx, p, cfg, style, t, width, bottom - top, true, story ? 1.2 : 1.05);
    const textH = layoutText(ctx, p, cfg, style, t, padX, 0, width, s, false, true);
    // Текст — по центру свободного места над QR
    const y = top + Math.max(0, (bottom - top - textH) / 2);
    layoutText(ctx, p, cfg, style, t, padX, y, width, s, true, true);
  }

  // ---------------------------------------------------------------------------
  // Форма
  // ---------------------------------------------------------------------------

  const FIELDS = ["salon", "amount", "service", "to", "from", "wish", "until", "number", "qr", "contacts"];

  function setChoice(group, value) {
    state[group] = value;
    root.querySelectorAll(`[data-${group}]`).forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset[group] === value));
    });
    if (group === "kind") {
      $("#sertifikat-amount").hidden = value !== "amount";
      $("#sertifikat-service").hidden = value !== "service";
    }
  }

  function syncInputs() {
    for (const name of FIELDS) {
      const el = root.querySelector(`[name="${name}"]`);
      if (el) el.value = state[name];
    }
    ["style", "lang", "format", "kind"].forEach((group) => setChoice(group, state[group]));
    updateQrHint();
  }

  function updateQrHint() {
    const hint = $("#sertifikat-qr-hint");
    const target = qrTarget(state.qr);
    hint.textContent = target ? `QR откроет: ${target}` : "Без ссылки сертификат будет без QR-кода.";
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
    const lines = [`🎁 ${t.title}${state.salon.trim() ? ` — ${state.salon.trim()}` : ""}`];
    const value = valueText(state);
    if (value) lines.push(`${state.kind === "service" ? t.serviceLabel : t.amountLabel}: ${value}`);
    if (state.to.trim()) lines.push(`${t.to}: ${state.to.trim()}`);
    if (state.from.trim()) lines.push(`${t.from}: ${state.from.trim()}`);
    if (state.wish.trim()) lines.push("", state.wish.trim(), "");
    const meta = metaLine(state, t);
    if (meta) lines.push(meta);
    const target = qrTarget(state.qr);
    if (target) lines.push(target);
    if (state.contacts.trim()) lines.push(state.contacts.trim());
    return lines.join("\n");
  }

  const SAVED = ["salon", "qr", "contacts", "style", "format", "lang", "kind"];

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
      for (const [key, max] of [["salon", 40], ["qr", 200], ["contacts", 80]]) {
        if (typeof saved[key] === "string") state[key] = saved[key].slice(0, max);
      }
      if (STYLES.some((st) => st.id === saved.style)) state.style = saved.style;
      if (TEXT[saved.lang]) state.lang = saved.lang;
      if (FORMATS[saved.format]) state.format = saved.format;
      if (["amount", "service"].includes(saved.kind)) state.kind = saved.kind;
    } catch {
      // сохранённого нет — начинаем с чистого листа
    }
  }

  kit.bindActions({
    canvas,
    render: () => draw(canvas, state),
    fileName: () => `${state.lang === "kk" ? "syilyq-sertifikat" : "sertifikat"}-${state.number.trim() || "jazyl"}.png`,
    text: plainText,
    download: $("#sertifikat-download"),
    share: $("#sertifikat-share"),
    copy: $("#sertifikat-copy"),
  });

  // ---------------------------------------------------------------------------
  // События формы
  // ---------------------------------------------------------------------------

  root.addEventListener("input", (event) => {
    const el = event.target;
    if (el.name && FIELDS.includes(el.name)) {
      state[el.name] = el.value;
      if (el.name === "qr") updateQrHint();
    }
    schedule();
  });

  root.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !root.contains(button)) return;

    if (button.dataset.action === "new-number") {
      state.number = newNumber();
      $("[name='number']").value = state.number;
    } else if (button.dataset.months) {
      const months = Number(button.dataset.months);
      state.until = months ? monthsFromNow(months) : "";
      $("[name='until']").value = state.until;
    } else {
      const group = ["style", "lang", "format", "kind"].find((g) => button.dataset[g]);
      if (!group) return;
      setChoice(group, button.dataset[group]);
    }
    schedule();
  });

  // ---------------------------------------------------------------------------
  // Примеры: те же картинки уменьшенно + «Сделать такой»
  // ---------------------------------------------------------------------------

  const base = {
    salon: "",
    kind: "amount",
    amount: "",
    service: "",
    to: "Айгерим",
    from: "",
    wish: "",
    until: monthsFromNow(3),
    number: "A7K2QF",
    qr: "@vash.salon",
    contacts: "",
    style: "lavender",
    format: "wide",
    lang: "ru",
  };
  const EXAMPLES = [
    { ...base, salon: "Nail studio", amount: "10000", style: "cream", wish: "С днём рождения! Пусть руки всегда будут красивыми", from: "Данияр" },
    { ...base, salon: "Массажный кабинет", kind: "service", service: "Массаж спины, 60 минут", style: "chocolate", to: "Маме", from: "Дочка", contacts: "Алматы, Абая 10 · +7 701 000 00 00" },
    { ...base, salon: "Brow & lash", amount: "15000", style: "powder", to: "Самой лучшей подруге", wish: "С 8 Марта!" },
    { ...base, salon: "SPA", kind: "service", service: "SPA-программа «Релакс»", style: "sage", to: "Сауле", from: "Коллеги" },
    { ...base, salon: "Barbershop", amount: "20000", style: "minimal", to: "Ерлан", from: "Жена", qr: "+7 701 000 00 00" },
    { ...base, salon: "Сұлулық салоны", amount: "10000", style: "lavender", lang: "kk", to: "Анама", from: "Ұлың", wish: "Туған күніңмен!" },
  ];

  function renderExamples() {
    root.ownerDocument.querySelectorAll("[data-example]").forEach((card) => {
      const cfg = EXAMPLES[Number(card.dataset.example)];
      const holder = card.querySelector("canvas");
      if (!cfg || !holder) return;
      draw(holder, cfg, 0.3);
      card.querySelector("[data-use-example]")?.addEventListener("click", () => {
        // Данные салона оставляем свои, вид и текст — как в примере, номер — новый.
        const own = { salon: state.salon, qr: state.qr, contacts: state.contacts };
        Object.assign(state, JSON.parse(JSON.stringify(cfg)), { number: newNumber(), until: monthsFromNow(3) });
        for (const [key, value] of Object.entries(own)) if (value.trim()) state[key] = value;
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
  $("#sertifikat-styles").innerHTML = kit.styleButtons();
  syncInputs();
  draw(canvas, state);

  // Рисуем заново, когда загрузятся шрифты, — иначе первый кадр будет системным шрифтом.
  kit.fontsReady().then(() => {
    schedule();
    renderExamples();
  });
})();
