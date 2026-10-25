/**
 * Jazyl Студия — «Прайс»: цены текстом → картинка для сторис, поста или A4.
 *
 * Логика: никакой таблицы — прайс вставляется текстом, как в заметках:
 *   «# Маникюр» — раздел; «Маникюр + покрытие — 7000»; «Дизайн от 300»; «Стрижка 4000 60 мин»; «5000-7000».
 * На картинке каждый раздел — талон с перфорацией под заголовком.
 * Шаблоны (TEMPLATES) — в порядке подписей в server/site/tools.js.
 */
(() => {
  const root = document.getElementById("prays");
  if (!root) return;

  const kit = window.JazylToolKit;
  const $ = (sel) => root.querySelector(sel);
  const canvas = $("#prays-canvas");
  const store = kit.storage("jazyl:studio:prays");

  const FORMATS = { story: [1080, 1920], post: [1080, 1350], a4: [1240, 1754] };
  const MAX_LINES = 60;

  const TEXT = {
    ru: { title: "Прайс", from: (p) => `от ${p}`, empty: "Вставьте прайс текстом" },
    kk: { title: "Баға", from: (p) => `${p} бастап`, empty: "Бағаларды мәтінмен қойыңыз" },
  };

  // ---------------------------------------------------------------------------
  // Разбор текста
  // ---------------------------------------------------------------------------

  const groupDigits = (digits) => String(Number(String(digits).replace(/\s/g, ""))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

  /** Длительность: «60 мин», «1,5 ч», «2 часа». */
  // (\b в JS не работает с кириллицей — граница слова через (?![…]))
  const DURATION = /(\d+(?:[.,]5)?)\s*(мин(?:ут)?|м|ч(?:ас(?:а|ов)?)?)(?![а-яёa-z])\.?/i;
  /** Цена в конце строки: «от 5 000», «5000-7000», «7000 ₸». */
  const PRICE = /(?:(от|бастап)\s*)?(\d[\d\s]{0,9}\d|\d)(?:\s*[-–—]\s*(\d[\d\s]{0,9}\d|\d))?\s*(?:₸|тг|тенге|kzt)?\s*(бастап)?\s*$/i;

  /** Текст → разделы с услугами. */
  function parsePrice(text) {
    const sections = [];
    let current = null;
    const lines = String(text || "").split(/\r?\n/).slice(0, MAX_LINES);
    for (const raw of lines) {
      let line = raw.trim();
      if (!line) continue;

      const header = line.match(/^#+\s*(.+)$/) || (!/\d/.test(line) && line.match(/^(.+?):\s*$/));
      if (header) {
        current = { title: header[1].trim(), items: [] };
        sections.push(current);
        continue;
      }

      let duration = "";
      const dm = line.match(DURATION);
      if (dm) {
        duration = `${dm[1].replace(".", ",")} ${dm[2].toLowerCase().startsWith("ч") ? "ч" : "мин"}`;
        line = line.replace(DURATION, " ").replace(/\s+/g, " ").trim();
      }

      let price = null;
      const pm = line.match(PRICE);
      if (pm && pm.index > 0) {
        price = { from: Boolean(pm[1] || pm[4]), a: groupDigits(pm[2]), b: pm[3] ? groupDigits(pm[3]) : "" };
        line = line.slice(0, pm.index);
      } else {
        // «Консультация — бесплатно»: справа от тире — цена словами
        const sep = line.match(/^(.*\S)\s+[—–-]\s+(\S.*)$/);
        if (sep) {
          price = { text: sep[2].trim() };
          line = sep[1];
        }
      }
      const name = line.replace(/[\s—–\-:·.,]+$/g, "").trim();
      if (!name) continue;

      if (!current) {
        current = { title: "", items: [] };
        sections.push(current);
      }
      current.items.push({ name, price, duration });
    }
    return sections.filter((section) => section.items.length);
  }

  function priceText(price, t) {
    if (!price) return "";
    if (price.text) return price.text;
    const value = price.b ? `${price.a}–${price.b} ₸` : `${price.a} ₸`;
    return price.from ? t.from(value) : value;
  }

  // ---------------------------------------------------------------------------
  // Состояние
  // ---------------------------------------------------------------------------

  const SAMPLE = "# Маникюр\nМаникюр без покрытия — 4000\nМаникюр + гель-лак — 7000\nДизайн от 300\n# Педикюр\nПедикюр + гель-лак 9000 90 мин\nСнятие покрытия — 1000";

  const state = {
    text: SAMPLE,
    name: "",
    title: "",
    note: "",
    nick: "",
    how: "link",
    whatsapp: "",
    custom: "",
    style: "milk",
    format: "story",
    lang: "ru",
  };

  // ---------------------------------------------------------------------------
  // Рисование
  // ---------------------------------------------------------------------------

  /** Строка услуги: название (до 2 строк) слева, цена справа, длительность под названием. */
  function measureRow(ctx, p, item, t, w, s) {
    p.font(36 * s, 800);
    const price = priceText(item.price, t);
    const priceW = price ? ctx.measureText(price).width : 0;
    p.font(36 * s, 500);
    const max = Math.max(w - priceW - 40 * s, w * 0.45);
    let lines = p.wrap(item.name, max);
    if (lines.length > 2) lines = [lines[0], p.fit(lines.slice(1).join(" "), max)];
    const h = lines.length * 46 * s + (item.duration ? 34 * s : 0);
    return { lines, price, h };
  }

  const pad = 36;

  /** Высота талона-раздела. */
  function sectionHeight(ctx, p, section, t, w, s) {
    const inner = w - pad * 2 * s;
    const head = section.title ? 92 * s : 0;
    const rows = section.items.reduce((sum, item) => sum + measureRow(ctx, p, item, t, inner, s).h, 0);
    return head + rows + (section.items.length - 1) * 30 * s + pad * 2 * s;
  }

  function drawSection(ctx, p, section, style, t, x, y, w, s) {
    const h = sectionHeight(ctx, p, section, t, w, s);
    const head = section.title ? 92 * s : 0;
    kit.ticket(ctx, {
      x,
      y,
      w,
      h,
      r: 26 * s,
      notch: 15 * s,
      cutY: section.title ? y + pad * s + head - 18 * s : null,
      fill: style.ticket,
      line: style.line,
    });
    const inner = w - pad * 2 * s;
    let cy = y + pad * s;
    if (section.title) {
      ctx.textBaseline = "top";
      p.font(30 * s, 900);
      p.spacing(5 * s);
      ctx.fillStyle = style.ticketSub;
      ctx.fillText(p.fit(section.title.toUpperCase(), inner), x + pad * s, cy + 4 * s);
      p.spacing(0);
      cy += head;
    }
    section.items.forEach((item, i) => {
      if (i) {
        // тонкий пунктир между услугами
        ctx.save();
        ctx.strokeStyle = style.line;
        ctx.lineWidth = Math.max(1, 2 * s);
        ctx.setLineDash([4 * s, 8 * s]);
        ctx.beginPath();
        ctx.moveTo(x + pad * s, cy - 15 * s);
        ctx.lineTo(x + w - pad * s, cy - 15 * s);
        ctx.stroke();
        ctx.restore();
      }
      const m = measureRow(ctx, p, item, t, inner, s);
      ctx.textBaseline = "top";
      p.font(36 * s, 500);
      ctx.fillStyle = style.ticketText;
      m.lines.forEach((line, n) => ctx.fillText(line, x + pad * s, cy + n * 46 * s));
      if (m.price) {
        p.font(36 * s, 800);
        ctx.textAlign = "right";
        ctx.fillText(m.price, x + w - pad * s, cy);
        ctx.textAlign = "left";
      }
      if (item.duration) {
        p.font(26 * s, 600);
        ctx.fillStyle = style.ticketSub;
        ctx.fillText(item.duration, x + pad * s, cy + m.lines.length * 46 * s + 2 * s);
      }
      cy += m.h + 30 * s;
    });
    return h;
  }

  /** Разделы по колонкам: по порядку, примерно поровну по высоте. */
  function layout(ctx, p, sections, style, t, x, y, width, s, cols, draw) {
    const gap = 26 * s;
    const colW = cols === 1 ? width : (width - gap) / 2;
    const heights = sections.map((sec) => sectionHeight(ctx, p, sec, t, colW, s));
    const total = heights.reduce((a, b) => a + b, 0) + gap * (heights.length - 1);
    const columns = [[], []];
    let used = 0;
    heights.forEach((h, i) => {
      const c = cols === 2 && columns[0].length && used + h / 2 > total / 2 ? 1 : 0;
      columns[c].push(i);
      if (c === 0) used += h + gap;
    });
    let maxH = 0;
    columns.forEach((list, c) => {
      let cy = y;
      list.forEach((i, n) => {
        if (n) cy += gap;
        if (draw) drawSection(ctx, p, sections[i], style, t, x + c * (colW + gap), cy, colW, s);
        cy += heights[i];
      });
      maxH = Math.max(maxH, cy - y);
    });
    return maxH;
  }

  function draw(target, cfg, scale = 1) {
    const [W, H] = FORMATS[cfg.format] || FORMATS.story;
    const style = kit.findStyle(cfg.style);
    const { ctx, p } = kit.begin(target, W, H, style, scale);
    const t = TEXT[cfg.lang] || TEXT.ru;
    const padX = cfg.format === "a4" ? 100 : 80;
    const width = W - padX * 2;
    const sections = parsePrice(cfg.text);

    const bottom = kit.drawFooter(ctx, p, cfg, style, W, H, padX);
    const top = cfg.format === "story" ? 130 : 80;
    const name = cfg.name.trim();
    const title = cfg.title.trim() || t.title;
    const note = cfg.note.trim();

    const headH = (k) => (name ? 92 * k : 0) + Math.min(200 * k, 220) * 0.95 + (note ? 64 * k : 0) + 46 * k;
    let fit = { s: 0.4, cols: 2 };
    outer: for (const cols of [1, 2]) {
      for (let s = cols === 1 ? 1.5 : 0.95; s >= (cols === 1 ? 0.75 : 0.4); s -= 0.05) {
        const body = sections.length ? layout(ctx, p, sections, style, t, padX, 0, width, s, cols, false) : 80;
        if (top + headH(s) + body <= bottom) {
          fit = { s, cols };
          break outer;
        }
      }
    }
    const { s, cols } = fit;
    const bodyH = sections.length ? layout(ctx, p, sections, style, t, padX, 0, width, s, cols, false) : 80;

    let y = top + Math.min(120, Math.max(0, (bottom - top - headH(s) - bodyH) * 0.3));
    if (name) {
      kit.sticker(ctx, p, { text: name.toUpperCase(), x: padX, y, size: 30 * s, angle: -0.05, fill: style.accent, color: style.accentText });
      y += 92 * s;
    }
    const titleSize = Math.min(200 * s, 220);
    ctx.textBaseline = "alphabetic";
    p.font(titleSize, 900);
    p.spacing(-titleSize * 0.045);
    ctx.fillStyle = style.text;
    ctx.fillText(p.fit(title, width), padX, y + titleSize * 0.8);
    p.spacing(0);
    y += titleSize * 0.95;
    if (note) {
      p.font(32 * s, 600);
      ctx.fillStyle = style.sub;
      ctx.fillText(p.fit(note, width), padX, y + 36 * s);
      y += 64 * s;
    }
    y += 46 * s;

    if (sections.length) layout(ctx, p, sections, style, t, padX, y, width, s, cols, true);
    else {
      p.font(40, 600);
      ctx.fillStyle = style.sub;
      ctx.fillText(t.empty, padX, y + 40);
    }
  }

  // ---------------------------------------------------------------------------
  // Форма
  // ---------------------------------------------------------------------------

  const FIELDS = ["text", "name", "title", "note", "nick", "whatsapp", "custom"];

  function setChoice(group, value) {
    state[group] = value;
    kit.setPressed(root, group, value);
    if (group === "how") {
      $("#prays-whatsapp").hidden = value !== "whatsapp";
      $("#prays-custom").hidden = value !== "custom";
    }
  }

  function updateParsed() {
    const sections = parsePrice(state.text);
    const items = sections.reduce((n, sec) => n + sec.items.length, 0);
    const noPrice = sections.reduce((n, sec) => n + sec.items.filter((it) => !it.price).length, 0);
    $("#prays-parsed").textContent = items
      ? `Разделов: ${sections.length} · услуг: ${items}${noPrice ? ` · без цены: ${noPrice}` : ""}`
      : "Пока ничего не распознано — напишите «Услуга — цена».";
  }

  function syncInputs() {
    for (const name of FIELDS) {
      const el = root.querySelector(`[name="${name}"]`);
      if (el) el.value = state[name];
    }
    ["style", "format", "lang", "how"].forEach((g) => setChoice(g, state[g]));
    updateParsed();
  }

  // Прайс запоминаем целиком: к нему возвращаются, когда меняются цены
  const save = () => store.save(state);
  const redraw = kit.scheduler(() => {
    draw(canvas, state);
    save();
  });

  /** Возвращает true, если у человека уже есть свой прайс (не пример). */
  function restore() {
    const saved = store.load();
    if (!saved) return false;
    for (const [key, max] of [["text", 4000], ["name", 40], ["title", 30], ["note", 100], ["nick", 32], ["whatsapp", 24], ["custom", 60]]) {
      if (typeof saved[key] === "string") state[key] = saved[key].slice(0, max);
    }
    if (kit.STYLES.some((st) => st.id === saved.style)) state.style = saved.style;
    if (FORMATS[saved.format]) state.format = saved.format;
    if (TEXT[saved.lang]) state.lang = saved.lang;
    if (["link", "direct", "whatsapp", "custom"].includes(saved.how)) state.how = saved.how;
    return typeof saved.text === "string" && saved.text.trim() && saved.text !== SAMPLE;
  }

  function plainText() {
    const t = TEXT[state.lang];
    const lines = [[state.title.trim() || t.title, state.name.trim()].filter(Boolean).join(" — ")];
    if (state.note.trim()) lines.push(state.note.trim());
    for (const section of parsePrice(state.text)) {
      lines.push("");
      if (section.title) lines.push(section.title);
      section.items.forEach((it) => lines.push(`• ${it.name}${it.price ? ` — ${priceText(it.price, t)}` : ""}${it.duration ? ` (${it.duration})` : ""}`));
    }
    lines.push("", ...kit.howLines(state));
    if (state.nick.trim()) lines.push(state.nick.trim());
    return lines.join("\n");
  }

  kit.bindActions({
    canvas,
    render: () => draw(canvas, state),
    fileName: () => `${state.lang === "kk" ? "baga" : "prays"}.png`,
    text: plainText,
    download: $("#prays-download"),
    share: $("#prays-share"),
    copy: $("#prays-copy"),
  });

  root.addEventListener("input", (event) => {
    const el = event.target;
    if (!FIELDS.includes(el.name)) return;
    state[el.name] = el.value;
    if (el.name === "text") updateParsed();
    redraw();
  });

  root.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !root.contains(button) || button.dataset.template) return;
    const g = ["style", "format", "lang", "how"].find((k) => button.dataset[k]);
    if (!g) return;
    setChoice(g, button.dataset[g]);
    redraw();
  });

  // ---------------------------------------------------------------------------
  // Шаблоны
  // ---------------------------------------------------------------------------

  const base = { name: "", title: "", note: "", nick: "@vash.nik", how: "link", whatsapp: "", custom: "", format: "story", lang: "ru" };
  const page = kit.pageConfig(root);
  const TEMPLATES = page.templates ? page.templates.map((t) => ({ ...base, style: "milk", ...t })) : [
    { ...base, style: "milk", name: "Nail studio", text: SAMPLE + "\nСмарт-педикюр — 8000" },
    {
      ...base,
      style: "graphite",
      name: "Barbershop",
      how: "direct",
      text: "# Стрижки\nМужская стрижка 5000 60 мин\nСтрижка машинкой 3000 30 мин\nДетская стрижка 3500 40 мин\n# Борода\nОформление бороды 3000 30 мин\nКоролевское бритьё 4000 45 мин\n# Комплекс\nСтрижка + борода 7000 90 мин",
    },
    {
      ...base,
      style: "violet",
      name: "Brow & lash",
      text: "# Брови\nКоррекция — 2500\nОкрашивание хной — 4000\nЛаминирование — 6000\n# Ресницы\nЛаминирование ресниц — 7000\nКлассика — 9000\n2D–3D объём от 11000",
    },
    {
      ...base,
      style: "coral",
      name: "Массаж",
      note: "Первое посещение — скидка 10%",
      text: "Классический 10000 60 мин\nАнтицеллюлитный 12000 60 мин\nСпина и шея 6000 30 мин\nЛимфодренаж 15000 90 мин",
    },
    {
      ...base,
      style: "mint",
      name: "Косметолог",
      text: "# Чистки\nУльтразвуковая — 8000\nКомбинированная — 12000\n# Уход\nПилинг от 10000\nКарбокситерапия — 9000\nАльгинатная маска — 4000",
    },
    {
      ...base,
      style: "sky",
      name: "Шаштараз",
      lang: "kk",
      text: "# Шаш қию\nӘйелдер шаш қию 6000 бастап\nЕрлер шаш қию — 4000\nБалалар шаш қию — 3000\n# Шаш бояу\nБір түске бояу 15000 бастап\nТонирлеу — 12000",
    },
  ];

  function applyTemplate(i) {
    const nick = state.nick;
    Object.assign(state, JSON.parse(JSON.stringify(TEMPLATES[i])));
    if (nick.trim()) state.nick = nick;
    syncInputs();
    redraw();
  }

  // ---------------------------------------------------------------------------
  // Старт
  // ---------------------------------------------------------------------------

  const hadOwnPrice = restore();
  // Страница под запрос («прайс на маникюр»): пример страницы — только если своего прайса ещё нет,
  // иначе сохранённые цены человека затёрлись бы примером
  if (page.preset) {
    const nick = state.nick;
    if (hadOwnPrice) Object.assign(state, { style: page.preset.style || state.style });
    else Object.assign(state, { ...base, ...page.preset });
    if (nick.trim()) state.nick = nick;
  }
  $("#prays-styles").innerHTML = kit.styleButtons();
  syncInputs();
  draw(canvas, state);
  kit.fontsReady().then(() => {
    redraw();
    kit.renderTemplates(draw, TEMPLATES, applyTemplate);
  });
})();
