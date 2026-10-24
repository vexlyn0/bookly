/**
 * Jazyl — инструмент «Прайс-лист»: картинка с ценами для сторис, поста или печати A4.
 * Всё рисуется в браузере на canvas (общее — в kit.js), на сервер ничего не уходит.
 *
 * Состояние — в объекте state (разделы → услуги), форма и картинка собираются из него.
 * Примеры внизу страницы (EXAMPLES) идут в том же порядке, что подписи в server/site/tools.js.
 */
(() => {
  const root = document.getElementById("prays");
  if (!root) return;

  const kit = window.JazylToolKit;
  const { SANS, SERIF, STYLES } = kit;

  const $ = (sel) => root.querySelector(sel);
  const canvas = $("#prays-canvas");
  const sectionsBox = $("#prays-sections");
  const STORAGE_KEY = "jazyl:tool:prays";

  const FORMATS = { story: [1080, 1920], post: [1080, 1350], a4: [1240, 1754] };
  const MAX_SECTIONS = 8;
  const MAX_ITEMS = 20;

  const TEXT = {
    ru: {
      title: "Прайс-лист",
      from: (price) => `от ${price}`,
      minutes: "мин",
      how: {
        link: "Запись — по ссылке в шапке профиля",
        direct: "Пишите в директ",
        whatsapp: "Запись в WhatsApp",
      },
      watermark: "сделано в Jazyl",
      empty: "Добавьте услуги и цены",
    },
    kk: {
      title: "Баға тізімі",
      from: (price) => `${price} бастап`,
      minutes: "мин",
      how: {
        link: "Жазылу — профильдегі сілтеме арқылы",
        direct: "Директке жазыңыз",
        whatsapp: "WhatsApp арқылы жазылу",
      },
      watermark: "Jazyl арқылы жасалған",
      empty: "Қызметтер мен бағаларды қосыңыз",
    },
  };

  // ---------------------------------------------------------------------------
  // Цены
  // ---------------------------------------------------------------------------

  const groupDigits = (digits) => String(Number(digits)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

  /** «5000» → «5 000 ₸», «5000-7000» → «5 000–7 000 ₸», «бесплатно» — как есть. */
  function formatPrice(raw) {
    const value = String(raw || "").trim();
    if (!value) return "";
    const range = value.replace(/\s/g, "").match(/^(\d{1,9})(?:[-–—](\d{1,9}))?(?:₸|тг|тенге)?$/i);
    if (!range) return value;
    return range[2] ? `${groupDigits(range[1])}–${groupDigits(range[2])} ₸` : `${groupDigits(range[1])} ₸`;
  }

  function priceText(item, t) {
    const price = formatPrice(item.price);
    return price && item.from ? t.from(price) : price;
  }

  // ---------------------------------------------------------------------------
  // Состояние
  // ---------------------------------------------------------------------------

  const item = (name, price, extra = {}) => ({ name, price, from: false, duration: "", ...extra });

  const state = {
    name: "",
    title: "",
    sections: [
      {
        title: "Маникюр",
        items: [item("Маникюр без покрытия", "4000"), item("Маникюр + гель-лак", "7000"), item("Дизайн", "500", { from: true })],
      },
      { title: "Педикюр", items: [item("Педикюр + гель-лак", "9000"), item("Снятие покрытия", "1000")] },
    ],
    note: "",
    style: "cream",
    format: "story",
    lang: "ru",
    nick: "",
    how: "link",
    whatsapp: "",
    custom: "",
  };

  /** Разделы и услуги, которые попадут на картинку (пустые строки пропускаем). */
  function activeSections(cfg) {
    return cfg.sections
      .map((section) => ({
        title: section.title.trim(),
        items: section.items.filter((it) => it.name.trim() || String(it.price).trim()),
      }))
      .filter((section) => section.items.length);
  }

  function howLines(cfg, t) {
    if (cfg.how === "custom") return cfg.custom.trim() ? [cfg.custom.trim()] : [];
    if (cfg.how === "whatsapp") return [cfg.whatsapp.trim() ? `${t.how.whatsapp}: ${cfg.whatsapp.trim()}` : t.how.whatsapp];
    return [t.how[cfg.how] || t.how.link];
  }

  // ---------------------------------------------------------------------------
  // Рисование: draw(canvas, cfg, scale) — одна функция и для предпросмотра, и для примеров
  // ---------------------------------------------------------------------------

  /** Раскладка одной услуги: строки названия (до двух), цена, длительность. */
  function measureItem(ctx, p, it, t, colWidth, s) {
    p.font(38 * s, 700);
    const price = priceText(it, t);
    const priceW = price ? ctx.measureText(price).width : 0;
    p.font(38 * s, 500);
    const nameMax = Math.max(colWidth - priceW - 36 * s, colWidth * 0.4);
    let lines = p.wrap(it.name.trim() || "—", nameMax);
    if (lines.length > 2) lines = [lines[0], p.fit(lines.slice(1).join(" "), nameMax)];
    const duration = String(it.duration || "").trim();
    const height = lines.length * 48 * s + (duration ? 38 * s : 0);
    return { lines, price, priceW, duration, height };
  }

  function sectionHeight(ctx, p, section, t, colWidth, s) {
    const head = section.title ? 66 * s : 0;
    const rows = section.items.reduce((sum, it) => sum + measureItem(ctx, p, it, t, colWidth, s).height + 26 * s, 0);
    return head + rows - 26 * s;
  }

  /** Делим разделы на колонки по порядку, примерно поровну по высоте. */
  function splitColumns(heights, cols, gap) {
    if (cols === 1) return [heights.map((_, i) => i)];
    const total = heights.reduce((a, b) => a + b, 0) + gap * (heights.length - 1);
    const columns = [[], []];
    let used = 0;
    heights.forEach((h, i) => {
      const target = columns[0].length && used + h / 2 > total / 2 ? 1 : 0;
      columns[target].push(i);
      if (target === 0) used += h + gap;
    });
    return columns;
  }

  function layoutList(ctx, p, sections, cfg, style, t, x, y, width, s, cols, draw) {
    const colGap = 56 * s;
    const sectionGap = 52 * s;
    const colWidth = cols === 1 ? width : (width - colGap) / 2;
    const heights = sections.map((section) => sectionHeight(ctx, p, section, t, colWidth, s));
    const columns = splitColumns(heights, cols, sectionGap);
    let maxH = 0;

    columns.forEach((indexes, col) => {
      const left = x + col * (colWidth + colGap);
      let cursor = y;
      indexes.forEach((index, n) => {
        if (n) cursor += sectionGap;
        const section = sections[index];
        if (draw) drawSection(ctx, p, section, style, t, left, cursor, colWidth, s);
        cursor += heights[index];
      });
      maxH = Math.max(maxH, cursor - y);
    });
    return maxH;
  }

  function drawSection(ctx, p, section, style, t, x, y, width, s) {
    ctx.textBaseline = "top";
    let cursor = y;
    if (section.title) {
      p.font(30 * s, 700);
      p.spacing(6 * s);
      ctx.fillStyle = style.sub;
      ctx.fillText(p.fit(section.title.toUpperCase(), width), x, cursor);
      p.spacing(0);
      // Тонкая линия под заголовком раздела
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x, cursor + 46 * s, width, Math.max(1, 2 * s));
      ctx.globalAlpha = 1;
      cursor += 66 * s;
    }

    section.items.forEach((it, i) => {
      if (i) cursor += 26 * s;
      const m = measureItem(ctx, p, it, t, width, s);
      p.font(38 * s, 500);
      ctx.fillStyle = style.text;
      m.lines.forEach((line, n) => ctx.fillText(line, x, cursor + n * 48 * s));

      if (m.price) {
        p.font(38 * s, 700);
        ctx.textAlign = "right";
        ctx.fillText(m.price, x + width, cursor);
        ctx.textAlign = "left";

        // Точки-отточие между названием и ценой (на первой строке)
        p.font(38 * s, 500);
        const nameEnd = x + ctx.measureText(m.lines[0]).width + 18 * s;
        const priceStart = x + width - m.priceW - 18 * s;
        ctx.fillStyle = style.sub;
        ctx.globalAlpha = 0.5;
        for (let dx = nameEnd; dx < priceStart; dx += 14 * s) {
          ctx.beginPath();
          ctx.arc(dx, cursor + 32 * s, 2.4 * s, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      if (m.duration) {
        p.font(28 * s, 500);
        ctx.fillStyle = style.sub;
        const duration = /^\d+$/.test(m.duration) ? `${m.duration} ${t.minutes}` : m.duration;
        ctx.fillText(duration, x, cursor + m.lines.length * 48 * s + 2 * s);
      }
      cursor += m.height;
    });
  }

  function draw(target, cfg, scale = 1) {
    const [W, H] = FORMATS[cfg.format] || FORMATS.story;
    const style = kit.findStyle(cfg.style);
    const { ctx, p } = kit.begin(target, W, H, style, scale);
    const t = TEXT[cfg.lang] || TEXT.ru;
    const titleFamily = style.font === "serif" ? SERIF : SANS;
    const sections = activeSections(cfg);
    const padX = cfg.format === "a4" ? 110 : 84;
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
    const contentBottom = bottomY - 40;

    // Верх: имя салона, заголовок, примечание, затем список. Подбираем масштаб и колонки, чтобы всё влезло.
    const name = cfg.name.trim();
    const title = cfg.title.trim() || t.title;
    const note = cfg.note.trim();
    const topStart = cfg.format === "story" ? 150 : 100;
    const titleSize = style.font === "serif" ? 120 : 112;

    let fit = null;
    // Шапка (имя, заголовок, примечание) не крупнее hs — короткий прайс растит только список.
    const tryFit = (cols, s) => {
      const hs = Math.min(s, 1.15);
      p.font(titleSize * hs, style.font === "serif" ? 700 : 800, titleFamily);
      const titleLines = p.wrap(title, width);
      p.font(32 * hs, 500);
      const noteLines = note ? p.wrap(note, width) : [];
      const headerH =
        (name ? 60 * hs : 0) + titleLines.length * titleSize * hs * 1.04 + noteLines.length * 44 * hs + (note ? 14 * hs : 0) + 56 * hs;
      const listH = sections.length ? layoutList(ctx, p, sections, cfg, style, t, padX, 0, width, s, cols, false) : 80;
      const ok = titleLines.every((line) => {
        p.font(titleSize * hs, style.font === "serif" ? 700 : 800, titleFamily);
        return ctx.measureText(line).width <= width;
      });
      // Крупный шрифт берём, только если названия услуг не переносятся на вторую строку.
      const colWidth = cols === 1 ? width : (width - 56 * s) / 2;
      const wraps = s > 1 && sections.some((sec) => sec.items.some((it) => measureItem(ctx, p, it, t, colWidth, s).lines.length > 1));
      return { cols, s, hs, titleLines, noteLines, fits: ok && !wraps && topStart + headerH + listH <= contentBottom };
    };

    // Одна колонка, пока шрифт крупный; длинный прайс — в две колонки.
    for (let s = 1.5; s >= 0.7 && !fit; s -= 0.05) {
      const attempt = tryFit(1, s);
      if (attempt.fits) fit = attempt;
    }
    for (let s = 0.9; s >= 0.4 && !fit; s -= 0.05) {
      const attempt = tryFit(2, s);
      if (attempt.fits) fit = attempt;
    }
    fit = fit || tryFit(2, 0.4);
    const { s, hs, cols, titleLines, noteLines } = fit;

    let y = topStart;
    ctx.textBaseline = "top";
    if (name) {
      p.font(30 * hs, 700);
      p.spacing(7 * hs);
      ctx.fillStyle = style.sub;
      ctx.fillText(p.fit(name.toUpperCase(), width), padX, y);
      p.spacing(0);
      y += 60 * hs;
    }

    p.font(titleSize * hs, style.font === "serif" ? 700 : 800, titleFamily);
    p.spacing(style.font === "serif" ? 0 : -3 * hs);
    ctx.fillStyle = style.text;
    for (const line of titleLines) {
      ctx.fillText(line, padX, y);
      y += titleSize * hs * 1.04;
    }
    p.spacing(0);

    if (noteLines.length) {
      y += 14 * hs;
      p.font(32 * hs, 500);
      ctx.fillStyle = style.sub;
      noteLines.forEach((line) => {
        ctx.fillText(line, padX, y);
        y += 44 * hs;
      });
    }
    y += 56 * hs;

    if (sections.length) {
      layoutList(ctx, p, sections, cfg, style, t, padX, y, width, s, cols, true);
    } else {
      p.font(40, 500);
      ctx.fillStyle = style.sub;
      ctx.fillText(t.empty, padX, y);
    }
  }

  // ---------------------------------------------------------------------------
  // Форма
  // ---------------------------------------------------------------------------

  const escapeAttr = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");

  function renderSections() {
    sectionsBox.innerHTML = state.sections
      .map(
        (section, si) => `
        <div class="pl-section" data-section="${si}">
          <div class="pl-section__head">
            <input class="tool__input pl-section__title" data-field="title" value="${escapeAttr(section.title)}" maxlength="40" placeholder="Раздел, например «Маникюр»" aria-label="Название раздела">
            <button type="button" class="ok-day__remove" data-action="remove-section" aria-label="Убрать раздел">×</button>
          </div>
          <div class="pl-items">
            ${section.items
              .map(
                (it, ii) => `
            <div class="pl-item" data-item="${ii}">
              <input class="tool__input pl-item__name" data-field="name" value="${escapeAttr(it.name)}" maxlength="60" placeholder="Услуга" aria-label="Услуга">
              <input class="tool__input pl-item__price" data-field="price" value="${escapeAttr(it.price)}" maxlength="24" placeholder="5000" aria-label="Цена, ₸">
              <input class="tool__input pl-item__duration" data-field="duration" value="${escapeAttr(it.duration)}" maxlength="12" placeholder="мин" aria-label="Длительность, минут" inputmode="numeric">
              <label class="pl-item__from" title="Цена «от»"><input type="checkbox" data-field="from"${it.from ? " checked" : ""}> от</label>
              <button type="button" class="ok-day__remove" data-action="remove-item" aria-label="Убрать услугу">×</button>
            </div>`
              )
              .join("")}
          </div>
          ${section.items.length < MAX_ITEMS ? `<button type="button" class="tool__add" data-action="add-item">+ Услуга</button>` : ""}
        </div>`
      )
      .join("");
    $("[data-action='add-section']").hidden = state.sections.length >= MAX_SECTIONS;
  }

  function setChoice(group, value) {
    state[group] = value;
    root.querySelectorAll(`[data-${group}]`).forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset[group] === value));
    });
    if (group === "how") {
      $("#prays-whatsapp").hidden = value !== "whatsapp";
      $("#prays-custom").hidden = value !== "custom";
    }
  }

  function syncInputs() {
    for (const name of ["name", "title", "note", "nick", "whatsapp", "custom"]) {
      const el = root.querySelector(`[name="${name}"]`);
      if (el) el.value = state[name];
    }
    ["style", "lang", "format", "how"].forEach((group) => setChoice(group, state[group]));
    renderSections();
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
    const lines = [[state.title.trim() || t.title, state.name.trim()].filter(Boolean).join(" — ")];
    if (state.note.trim()) lines.push(state.note.trim());
    for (const section of activeSections(state)) {
      lines.push("");
      if (section.title) lines.push(section.title);
      section.items.forEach((it) => {
        const price = priceText(it, t);
        lines.push(`• ${it.name.trim()}${price ? ` — ${price}` : ""}`);
      });
    }
    lines.push("", ...howLines(state, t));
    if (state.nick.trim()) lines.push(state.nick.trim());
    return lines.join("\n");
  }

  // Прайс сохраняем целиком: к нему возвращаются, когда меняются цены.
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // приватный режим — не страшно
    }
  }

  const str = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved) return;
      for (const [key, max] of [["name", 40], ["title", 40], ["note", 120], ["nick", 32], ["whatsapp", 24], ["custom", 60]]) {
        state[key] = str(saved[key], max);
      }
      if (Array.isArray(saved.sections)) {
        state.sections = saved.sections.slice(0, MAX_SECTIONS).map((section) => ({
          title: str(section?.title, 40),
          items: (Array.isArray(section?.items) ? section.items : []).slice(0, MAX_ITEMS).map((it) => ({
            name: str(it?.name, 60),
            price: str(String(it?.price ?? ""), 24),
            from: it?.from === true,
            duration: str(String(it?.duration ?? ""), 12),
          })),
        }));
      }
      if (STYLES.some((st) => st.id === saved.style)) state.style = saved.style;
      if (TEXT[saved.lang]) state.lang = saved.lang;
      if (FORMATS[saved.format]) state.format = saved.format;
      if (["link", "direct", "whatsapp", "custom"].includes(saved.how)) state.how = saved.how;
    } catch {
      // сохранённого нет — начинаем с примера
    }
  }

  kit.bindActions({
    canvas,
    render: () => draw(canvas, state),
    fileName: () => `${state.lang === "kk" ? "baga-tizimi" : "prays-list"}.png`,
    text: plainText,
    download: $("#prays-download"),
    share: $("#prays-share"),
    copy: $("#prays-copy"),
  });

  // ---------------------------------------------------------------------------
  // События формы
  // ---------------------------------------------------------------------------

  function locate(el) {
    const sectionEl = el.closest(".pl-section");
    const itemEl = el.closest(".pl-item");
    const section = sectionEl ? state.sections[Number(sectionEl.dataset.section)] : null;
    const it = section && itemEl ? section.items[Number(itemEl.dataset.item)] : null;
    return { sectionEl, section, it };
  }

  root.addEventListener("input", (event) => {
    const el = event.target;
    const { section, it } = locate(el);
    const field = el.dataset.field;
    if (it && field) {
      it[field] = field === "from" ? el.checked : el.value;
    } else if (section && field === "title") {
      section.title = el.value;
    } else if (el.name && el.name in state) {
      state[el.name] = el.value;
    }
    schedule();
  });

  root.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !root.contains(button)) return;
    const { sectionEl, section } = locate(button);
    const action = button.dataset.action;

    if (action === "add-section") {
      state.sections.push({ title: "", items: [item("", "")] });
      renderSections();
      sectionsBox.querySelector(".pl-section:last-child .pl-section__title")?.focus();
    } else if (action === "remove-section" && section) {
      state.sections.splice(Number(sectionEl.dataset.section), 1);
      renderSections();
    } else if (action === "add-item" && section) {
      section.items.push(item("", ""));
      renderSections();
      sectionsBox
        .querySelector(`.pl-section[data-section="${sectionEl.dataset.section}"] .pl-item:last-child .pl-item__name`)
        ?.focus();
    } else if (action === "remove-item" && section) {
      section.items.splice(Number(button.closest(".pl-item").dataset.item), 1);
      renderSections();
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

  const base = { name: "", title: "", note: "", style: "cream", format: "story", lang: "ru", nick: "@vash.nik", how: "link", whatsapp: "", custom: "" };
  const EXAMPLES = [
    {
      ...base,
      name: "Nail studio",
      style: "cream",
      sections: [
        { title: "Маникюр", items: [item("Маникюр без покрытия", "4000"), item("Маникюр + гель-лак", "7000"), item("Укрепление гелем", "2000"), item("Наращивание", "12000")] },
        { title: "Педикюр", items: [item("Педикюр + гель-лак", "9000"), item("Смарт-педикюр", "8000")] },
        { title: "Дизайн", items: [item("Френч", "1500"), item("Дизайн 1 ногтя", "300", { from: true })] },
      ],
    },
    {
      ...base,
      name: "Barbershop",
      style: "night",
      how: "direct",
      sections: [
        { title: "Стрижки", items: [item("Мужская стрижка", "5000", { duration: "60" }), item("Стрижка машинкой", "3000", { duration: "30" }), item("Детская стрижка", "3500", { duration: "40" })] },
        { title: "Борода", items: [item("Оформление бороды", "3000", { duration: "30" }), item("Королевское бритьё", "4000", { duration: "45" })] },
        { title: "Комплекс", items: [item("Стрижка + борода", "7000", { duration: "90" })] },
      ],
    },
    {
      ...base,
      name: "Brow & lash",
      style: "powder",
      sections: [
        { title: "Брови", items: [item("Коррекция", "2500"), item("Окрашивание хной", "4000"), item("Ламинирование", "6000")] },
        { title: "Ресницы", items: [item("Ламинирование ресниц", "7000"), item("Классика", "9000"), item("2D–3D объём", "11000", { from: true })] },
      ],
    },
    {
      ...base,
      name: "Массажный кабинет",
      style: "chocolate",
      note: "Первое посещение — скидка 10%",
      sections: [
        { title: "Массаж", items: [item("Классический", "10000", { duration: "60" }), item("Антицеллюлитный", "12000", { duration: "60" }), item("Спина и шея", "6000", { duration: "30" }), item("Лимфодренаж", "15000", { duration: "90" })] },
      ],
    },
    {
      ...base,
      name: "Косметолог",
      style: "sage",
      sections: [
        { title: "Чистки", items: [item("Ультразвуковая", "8000"), item("Комбинированная", "12000")] },
        { title: "Уход", items: [item("Пилинг", "10000", { from: true }), item("Карбокситерапия", "9000"), item("Альгинатная маска", "4000")] },
        { title: "Консультация", items: [item("Подбор домашнего ухода", "Бесплатно")] },
      ],
    },
    {
      ...base,
      name: "Салон красоты",
      style: "minimal",
      how: "whatsapp",
      whatsapp: "+7 701 000 00 00",
      sections: [
        { title: "Стрижки", items: [item("Женская стрижка", "6000", { from: true }), item("Мужская стрижка", "4000"), item("Чёлка", "1500")] },
        { title: "Окрашивание", items: [item("В один тон", "15000", { from: true }), item("Сложное окрашивание", "30000-45000"), item("Тонирование", "12000", { from: true })] },
        { title: "Укладки", items: [item("Укладка", "5000", { from: true }), item("Вечерняя причёска", "10000", { from: true })] },
        { title: "Уход", items: [item("Кератин", "25000", { from: true }), item("Ботокс для волос", "20000", { from: true })] },
      ],
    },
    {
      ...base,
      name: "Tattoo studio",
      style: "terracotta",
      how: "direct",
      note: "Предоплата за эскиз — 5 000 ₸",
      sections: [
        { title: "Тату", items: [item("Мини-тату", "15000", { from: true }), item("Средний размер", "35000", { from: true }), item("Час работы", "20000")] },
        { title: "Другое", items: [item("Эскиз", "5000"), item("Перекрытие", "40000", { from: true })] },
      ],
    },
    {
      ...base,
      name: "Шаштараз",
      style: "lavender",
      lang: "kk",
      sections: [
        { title: "Шаш қию", items: [item("Әйелдер шаш қию", "6000", { from: true }), item("Ерлер шаш қию", "4000"), item("Балалар шаш қию", "3000")] },
        { title: "Шаш бояу", items: [item("Бір түске бояу", "15000", { from: true }), item("Тонирлеу", "12000")] },
        { title: "Сән", items: [item("Шаш сәндеу", "5000", { from: true })] },
      ],
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
  $("#prays-styles").innerHTML = kit.styleButtons();
  syncInputs();
  draw(canvas, state);

  // Рисуем заново, когда загрузятся шрифты, — иначе первый кадр будет системным шрифтом.
  kit.fontsReady().then(() => {
    schedule();
    renderExamples();
  });
})();
