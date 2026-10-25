/**
 * Jazyl Студия — «Сертификат»: подарочный отрывной талон.
 *
 * Картинка — один большой талон: слева подарок (номинал или услуга), кому, от кого, пожелание;
 * за перфорацией — корешок с QR на запись, номером и сроком. В портретных форматах корешок снизу.
 * Номинал — кнопками в один клик. Запоминаем только данные салона (название, QR, контакты, вид).
 * Шаблоны (TEMPLATES) — в порядке подписей в server/site/tools.js.
 */
(() => {
  const root = document.getElementById("sertifikat");
  if (!root) return;

  const kit = window.JazylToolKit;
  const $ = (sel) => root.querySelector(sel);
  const canvas = $("#sertifikat-canvas");
  const store = kit.storage("jazyl:studio:sertifikat");

  /** wide — 2:1 для печати (21 × 10,5 см); post и story — для WhatsApp и Instagram. */
  const FORMATS = { wide: [2000, 1000], post: [1080, 1350], story: [1080, 1920] };

  const TEXT = {
    ru: { sticker: "Подарок", title: "Сертификат", amount: "на сумму", service: "на услугу", to: "Кому", from: "От", until: (d) => `до ${d}`, forever: "бессрочно", qr: "Запись по QR", watermark: "сделано в Jazyl" },
    kk: { sticker: "Сыйлық", title: "Сертификат", amount: "сомасы", service: "қызмет", to: "Кімге", from: "Кімнен", until: (d) => `${d} дейін`, forever: "мерзімсіз", qr: "QR арқылы жазылу", watermark: "Jazyl арқылы жасалған" },
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
    const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
  }

  /** Номер: 6 знаков без похожих букв и цифр (0/O, 1/I). */
  function newNumber() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(6);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  }

  const groupDigits = (digits) => String(Number(digits)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

  function valueText(cfg) {
    if (cfg.kind === "service") return cfg.service.trim();
    const digits = String(cfg.amount || "").replace(/\D/g, "").slice(0, 9);
    return digits ? `${groupDigits(digits)} ₸` : "";
  }

  const state = {
    kind: "amount",
    amount: "10000",
    service: "",
    to: "",
    from: "",
    wish: "",
    number: newNumber(),
    until: monthsFromNow(3),
    qr: "",
    salon: "",
    contacts: "",
    style: "violet",
    format: "wide",
    lang: "ru",
  };

  // ---------------------------------------------------------------------------
  // Рисование
  // ---------------------------------------------------------------------------

  /** Левая часть талона: наклейка, салон, «Сертификат», номинал, кому/от кого, пожелание. */
  function drawGift(ctx, p, cfg, style, t, x, y, w, h, center) {
    const value = valueText(cfg);
    const salon = cfg.salon.trim();
    const lines = [];
    const big = cfg.kind === "amount";

    // Подбираем масштаб, чтобы всё влезло в высоту
    const measure = (s) => {
      let total = 70 * s + (salon ? 54 * s : 0) + 150 * s * 0.95 + 24 * s;
      if (value) {
        p.font((big ? 120 : 60) * s, big ? 900 : 800);
        const vl = big ? 1 : Math.min(2, p.wrap(value, w).length);
        total += 40 * s + vl * (big ? 124 : 70) * s + 16 * s;
      }
      if (cfg.to.trim()) total += 54 * s;
      if (cfg.from.trim()) total += 54 * s;
      if (cfg.wish.trim()) {
        p.font(34 * s, 500);
        total += 16 * s + Math.min(2, p.wrap(cfg.wish.trim(), w).length) * 46 * s;
      }
      return total;
    };
    let s = 1.3;
    while (s > 0.45 && measure(s) > h) s -= 0.05;

    let cy = y + Math.max(0, (h - measure(s)) / 2);
    const ax = (tw) => (center ? x + (w - tw) / 2 : x);

    // Наклейка «Подарок»
    p.font(28 * s, 800);
    const stickerW = ctx.measureText(t.sticker.toUpperCase()).width + 28 * s * 1.3;
    kit.sticker(ctx, p, { text: t.sticker.toUpperCase(), x: ax(stickerW), y: cy, size: 28 * s, angle: -0.06, fill: style.accent, color: style.accentText });
    cy += 70 * s;

    ctx.textBaseline = "alphabetic";
    if (salon) {
      p.font(28 * s, 800);
      p.spacing(5 * s);
      const text = p.fit(salon.toUpperCase(), w);
      ctx.fillStyle = style.ticketSub;
      ctx.fillText(text, ax(ctx.measureText(text).width), cy + 30 * s);
      p.spacing(0);
      cy += 54 * s;
    }

    p.font(150 * s, 900);
    p.spacing(-6 * s);
    const title = p.fit(t.title, w);
    ctx.fillStyle = style.ticketText;
    ctx.fillText(title, ax(ctx.measureText(title).width), cy + 150 * s * 0.8);
    p.spacing(0);
    cy += 150 * s * 0.95 + 24 * s;

    if (value) {
      p.font(28 * s, 700);
      const label = big ? t.amount : t.service;
      ctx.fillStyle = style.ticketSub;
      ctx.fillText(label, ax(ctx.measureText(label).width), cy + 28 * s);
      cy += 40 * s;
      p.font((big ? 120 : 60) * s, big ? 900 : 800);
      let vl = big ? [value] : p.wrap(value, w);
      if (vl.length > 2) vl = [vl[0], p.fit(vl.slice(1).join(" "), w)];
      ctx.fillStyle = style.ticketText;
      vl.forEach((line) => {
        ctx.fillText(line, ax(ctx.measureText(line).width), cy + (big ? 106 : 56) * s);
        cy += (big ? 124 : 70) * s;
      });
      cy += 16 * s;
    }

    for (const [label, raw] of [[t.to, cfg.to], [t.from, cfg.from]]) {
      const name = String(raw || "").trim();
      if (!name) continue;
      p.font(38 * s, 500);
      const prefix = `${label}: `;
      const pw = ctx.measureText(prefix).width;
      p.font(38 * s, 800);
      const nameText = p.fit(name, w - pw);
      const total = pw + ctx.measureText(nameText).width;
      const left = ax(total);
      p.font(38 * s, 500);
      ctx.fillStyle = style.ticketSub;
      ctx.fillText(prefix, left, cy + 40 * s);
      p.font(38 * s, 800);
      ctx.fillStyle = style.ticketText;
      ctx.fillText(nameText, left + pw, cy + 40 * s);
      cy += 54 * s;
    }

    const wish = cfg.wish.trim();
    if (wish) {
      cy += 16 * s;
      p.font(34 * s, 500);
      let wl = p.wrap(`«${wish}»`, w);
      if (wl.length > 2) wl = [wl[0], p.fit(wl.slice(1).join(" "), w)];
      ctx.fillStyle = style.ticketText;
      ctx.globalAlpha = 0.85;
      wl.forEach((line) => {
        ctx.fillText(line, ax(ctx.measureText(line).width), cy + 36 * s);
        cy += 46 * s;
      });
      ctx.globalAlpha = 1;
    }
  }

  /** Корешок: QR (или штамп), подпись, номер, срок. */
  function drawStub(ctx, p, cfg, style, t, cx, y, h, qrSize) {
    const target = kit.qrTarget(cfg.qr);
    const number = cfg.number.trim();
    const until = formatDate(cfg.until);
    const blockH = (target ? qrSize + 54 : qrSize * 0.6) + (number ? 58 : 0) + 44;
    let cy = y + Math.max(0, (h - blockH) / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    if (target) {
      kit.drawQr(ctx, p, target, cx - qrSize / 2, cy, qrSize, kit.qrDark(style));
      cy += qrSize + 40;
      p.font(26, 700);
      ctx.fillStyle = style.ticketSub;
      ctx.fillText(t.qr, cx, cy);
      cy += 14;
    } else {
      kit.drawStamp(ctx, cx - qrSize * 0.3, cy, qrSize * 0.6, style.ticketSub, qrSize * 0.035);
      cy += qrSize * 0.6;
    }
    if (number) {
      p.font(40, 900);
      p.spacing(3);
      ctx.fillStyle = style.ticketText;
      ctx.fillText(`№ ${number}`, cx, cy + 52);
      p.spacing(0);
      cy += 58;
    }
    p.font(28, 600);
    ctx.fillStyle = style.ticketSub;
    ctx.fillText(until ? t.until(until) : t.forever, cx, cy + 40);
    ctx.textAlign = "left";
  }

  function draw(target, cfg, scale = 1) {
    const [W, H] = FORMATS[cfg.format] || FORMATS.wide;
    const style = kit.findStyle(cfg.style);
    const { ctx, p } = kit.begin(target, W, H, style, scale);
    const t = TEXT[cfg.lang] || TEXT.ru;
    const contacts = cfg.contacts.trim();

    if (W > H) {
      // Горизонтальный талон, корешок справа
      const m = 64;
      const stubW = 500;
      const x = m;
      const y = m;
      const w = W - m * 2;
      const h = H - m * 2 - 30;
      const cutX = x + w - stubW;
      kit.ticket(ctx, { x, y, w, h, r: 44, notch: 30, cutX, fill: style.ticket, line: style.line });
      const innerTop = y + 64;
      const innerH = h - 128 - (contacts ? 50 : 0);
      drawGift(ctx, p, cfg, style, t, x + 90, innerTop, cutX - x - 160, innerH, false);
      if (contacts) {
        p.font(28, 600);
        ctx.fillStyle = style.ticketSub;
        ctx.fillText(p.fit(contacts, cutX - x - 160), x + 90, y + h - 60);
      }
      drawStub(ctx, p, cfg, style, t, cutX + stubW / 2, y, h, 300);
      kit.drawWatermark(ctx, p, style, t.watermark, W, H - 26);
      return;
    }

    // Вертикальный талон, корешок снизу
    const story = H / W > 1.5;
    const m = 70;
    const x = m;
    const y = story ? 150 : m;
    const w = W - m * 2;
    const h = H - y - (story ? 170 : 110);
    const stubH = cfg.qr.trim() ? (story ? 560 : 470) : 300;
    const cutY = y + h - stubH;
    kit.ticket(ctx, { x, y, w, h, r: 44, notch: 30, cutY, fill: style.ticket, line: style.line });
    const innerH = cutY - y - 120 - (contacts ? 46 : 0);
    drawGift(ctx, p, cfg, style, t, x + 70, y + 70, w - 140, innerH, true);
    if (contacts) {
      p.font(28, 600);
      ctx.fillStyle = style.ticketSub;
      ctx.textAlign = "center";
      ctx.fillText(p.fit(contacts, w - 140), W / 2, cutY - 44);
      ctx.textAlign = "left";
    }
    drawStub(ctx, p, cfg, style, t, W / 2, cutY, stubH, story ? 300 : 250);
    kit.drawWatermark(ctx, p, style, t.watermark, W, H - (story ? 70 : 40));
  }

  // ---------------------------------------------------------------------------
  // Форма
  // ---------------------------------------------------------------------------

  const FIELDS = ["amount", "service", "to", "from", "wish", "number", "until", "qr", "salon", "contacts"];

  function setChoice(group, value) {
    state[group] = value;
    kit.setPressed(root, group, value);
    if (group === "kind") {
      $("#sertifikat-amount-box").hidden = value !== "amount";
      $("#sertifikat-service-box").hidden = value !== "service";
    }
  }

  function updateHints() {
    const target = kit.qrTarget(state.qr);
    $("#sertifikat-qr-hint").textContent = target ? `QR откроет: ${target}` : "Без ссылки вместо QR будет штамп.";
    kit.setPressed(root, "amount", String(state.amount).replace(/\D/g, ""));
  }

  function syncInputs() {
    for (const name of FIELDS) {
      const el = root.querySelector(`[name="${name}"]`);
      if (el) el.value = state[name];
    }
    ["style", "format", "lang", "kind"].forEach((g) => setChoice(g, state[g]));
    updateHints();
  }

  const SAVED = ["qr", "salon", "contacts", "style", "format", "lang"];
  const save = () => store.save(Object.fromEntries(SAVED.map((k) => [k, state[k]])));
  const redraw = kit.scheduler(() => {
    draw(canvas, state);
    save();
  });

  function restore() {
    const saved = store.load();
    if (!saved) return;
    for (const [key, max] of [["qr", 200], ["salon", 40], ["contacts", 80]]) if (typeof saved[key] === "string") state[key] = saved[key].slice(0, max);
    if (kit.STYLES.some((st) => st.id === saved.style)) state.style = saved.style;
    if (FORMATS[saved.format]) state.format = saved.format;
    if (TEXT[saved.lang]) state.lang = saved.lang;
  }

  function plainText() {
    const t = TEXT[state.lang];
    const lines = [`🎁 ${t.title}${state.salon.trim() ? ` — ${state.salon.trim()}` : ""}`];
    const value = valueText(state);
    if (value) lines.push(`${state.kind === "service" ? t.service : t.amount}: ${value}`);
    if (state.to.trim()) lines.push(`${t.to}: ${state.to.trim()}`);
    if (state.from.trim()) lines.push(`${t.from}: ${state.from.trim()}`);
    if (state.wish.trim()) lines.push("", state.wish.trim(), "");
    lines.push(`№ ${state.number.trim()} · ${formatDate(state.until) ? t.until(formatDate(state.until)) : t.forever}`);
    const target = kit.qrTarget(state.qr);
    if (target) lines.push(target);
    if (state.contacts.trim()) lines.push(state.contacts.trim());
    return lines.join("\n");
  }

  kit.bindActions({
    canvas,
    render: () => draw(canvas, state),
    fileName: () => `${state.lang === "kk" ? "syilyq" : "sertifikat"}-${state.number.trim() || "jazyl"}.png`,
    text: plainText,
    download: $("#sertifikat-download"),
    share: $("#sertifikat-share"),
    copy: $("#sertifikat-copy"),
  });

  root.addEventListener("input", (event) => {
    const el = event.target;
    if (!FIELDS.includes(el.name)) return;
    state[el.name] = el.value;
    if (el.name === "qr" || el.name === "amount") updateHints();
    redraw();
  });

  root.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !root.contains(button) || button.dataset.template) return;
    if (button.dataset.action === "new-number") {
      state.number = newNumber();
      $("[name='number']").value = state.number;
    } else if (button.dataset.amount) {
      state.amount = button.dataset.amount;
      $("[name='amount']").value = state.amount;
      updateHints();
    } else if (button.dataset.months) {
      const months = Number(button.dataset.months);
      state.until = months ? monthsFromNow(months) : "";
      $("[name='until']").value = state.until;
    } else {
      const g = ["style", "format", "lang", "kind"].find((k) => button.dataset[k]);
      if (!g) return;
      setChoice(g, button.dataset[g]);
    }
    redraw();
  });

  // ---------------------------------------------------------------------------
  // Шаблоны
  // ---------------------------------------------------------------------------

  const base = { kind: "amount", amount: "", service: "", to: "Айгерим", from: "", wish: "", number: "A7K2QF", until: monthsFromNow(3), qr: "@vash.salon", salon: "", contacts: "", format: "wide", lang: "ru" };
  const TEMPLATES = [
    { ...base, style: "violet", salon: "Nail studio", amount: "10000", from: "Данияр", wish: "С днём рождения!" },
    { ...base, style: "graphite", salon: "Массажный кабинет", kind: "service", service: "Массаж спины, 60 минут", to: "Маме", from: "Дочка" },
    { ...base, style: "coral", salon: "Brow & lash", amount: "15000", to: "Лучшей подруге", wish: "С 8 Марта!" },
    { ...base, style: "mint", salon: "SPA", kind: "service", service: "SPA-программа «Релакс»", to: "Сауле", from: "Коллеги" },
    { ...base, style: "milk", salon: "Barbershop", amount: "20000", to: "Ерлан", from: "Жена", qr: "+7 701 000 00 00" },
    { ...base, style: "sky", salon: "Сұлулық салоны", amount: "10000", to: "Анама", from: "Ұлың", wish: "Туған күніңмен!", lang: "kk" },
  ];

  function applyTemplate(i) {
    const own = { salon: state.salon, qr: state.qr, contacts: state.contacts };
    Object.assign(state, JSON.parse(JSON.stringify(TEMPLATES[i])), { number: newNumber(), until: monthsFromNow(3) });
    for (const [key, value] of Object.entries(own)) if (value.trim()) state[key] = value;
    syncInputs();
    redraw();
  }

  // ---------------------------------------------------------------------------
  // Старт
  // ---------------------------------------------------------------------------

  restore();
  $("#sertifikat-styles").innerHTML = kit.styleButtons();
  syncInputs();
  draw(canvas, state);
  kit.fontsReady().then(() => {
    redraw();
    kit.renderTemplates(draw, TEMPLATES, applyTemplate);
  });
})();
