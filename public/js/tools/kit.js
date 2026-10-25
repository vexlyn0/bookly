/**
 * Jazyl Студия — общий движок картинок (подключается перед скриптом каждого редактора).
 *
 * Фирменный язык картинок:
 *   - «талоны»: карточки с полукруглыми вырезами и пунктирной перфорацией (время, цены, сертификат);
 *   - «наклейки»: плашки под углом (услуга, акция);
 *   - растр из точек в углу и штамп-галочка Jazyl на фоне;
 *   - один шрифт Inter, заголовки — самым жирным начертанием, плотно.
 * Здесь же: палитры, кнопки выбора палитры, QR, «как записаться», скачать / поделиться / скопировать.
 */
window.JazylToolKit = (() => {
  const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';

  /**
   * Палитры. bg/bg2 — фон сверху вниз; ticket — талоны; accent — наклейки и выделения;
   * line — перфорация и разделители; dots — растр в углу.
   */
  const STYLES = [
    { id: "violet", name: "Фиалка", bg: "#4b42ad", bg2: "#2c2573", text: "#ffffff", sub: "#cfcaf7", accent: "#f0997b", accentText: "#3a1408", ticket: "#ffffff", ticketText: "#221d58", ticketSub: "#6c64c9", line: "rgba(34,29,88,0.22)", dots: "rgba(255,255,255,0.13)", stamp: "rgba(255,255,255,0.08)" },
    { id: "milk", name: "Молоко", bg: "#f6f0e6", bg2: "#ece2d1", text: "#201e24", sub: "#6b6470", accent: "#534ab7", accentText: "#ffffff", ticket: "#ffffff", ticketText: "#201e24", ticketSub: "#8a8290", line: "rgba(32,30,36,0.18)", dots: "rgba(83,74,183,0.12)", stamp: "rgba(32,30,36,0.05)" },
    { id: "graphite", name: "Графит", bg: "#2a2730", bg2: "#141217", text: "#f6f3ee", sub: "#aaa3b4", accent: "#c9c2ef", accentText: "#201e24", ticket: "#36323d", ticketText: "#ffffff", ticketSub: "#c9c2ef", line: "rgba(255,255,255,0.2)", dots: "rgba(201,194,239,0.14)", stamp: "rgba(255,255,255,0.05)" },
    { id: "mint", name: "Мята", bg: "#d8efe4", bg2: "#bfe2d1", text: "#0d3a2c", sub: "#2f6b55", accent: "#0f6e56", accentText: "#ffffff", ticket: "#ffffff", ticketText: "#0d3a2c", ticketSub: "#4f8a73", line: "rgba(13,58,44,0.2)", dots: "rgba(15,110,86,0.14)", stamp: "rgba(13,58,44,0.06)" },
    { id: "coral", name: "Коралл", bg: "#f19272", bg2: "#dc5f3f", text: "#2a0f06", sub: "#5a2412", accent: "#221d58", accentText: "#ffffff", ticket: "#fff7f2", ticketText: "#4a1b0c", ticketSub: "#b0583a", line: "rgba(74,27,12,0.22)", dots: "rgba(255,255,255,0.22)", stamp: "rgba(42,15,6,0.07)" },
    { id: "sky", name: "Небо", bg: "#e4f0fc", bg2: "#c9def4", text: "#0c2c53", sub: "#355f8c", accent: "#185fa5", accentText: "#ffffff", ticket: "#ffffff", ticketText: "#0c2c53", ticketSub: "#5a83ad", line: "rgba(12,44,83,0.2)", dots: "rgba(24,95,165,0.13)", stamp: "rgba(12,44,83,0.06)" },
  ];

  const findStyle = (id) => STYLES.find((st) => st.id === id) || STYLES[0];

  const HOW = {
    ru: { link: "Запись — по ссылке в шапке профиля", direct: "Пишите в директ", whatsapp: "Запись в WhatsApp", watermark: "сделано в Jazyl" },
    kk: { link: "Жазылу — профильдегі сілтеме арқылы", direct: "Директке жазыңыз", whatsapp: "WhatsApp арқылы жазылу", watermark: "Jazyl арқылы жасалған" },
  };

  // ---------------------------------------------------------------------------
  // Рисование
  // ---------------------------------------------------------------------------

  function makePainter(ctx) {
    return {
      font(size, weight = 600) {
        ctx.font = `${weight} ${Math.round(size)}px ${FONT}`;
      },
      spacing(px) {
        if ("letterSpacing" in ctx) ctx.letterSpacing = `${px}px`;
      },
      roundRect(x, y, w, h, r) {
        const rr = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
      },
      wrap(text, maxWidth) {
        const words = String(text).split(/\s+/).filter(Boolean);
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
      },
      fit(text, maxWidth) {
        let value = String(text);
        if (ctx.measureText(value).width <= maxWidth) return value;
        while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1);
        return `${value.trimEnd()}…`;
      },
    };
  }

  /** Штамп Jazyl: календарь с галочкой (контур). */
  function drawStamp(ctx, x, y, size, color, width) {
    const s = size / 24;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 2 * s;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const r = 3.5 * s;
    const bx = 4 * s;
    const by = 5.5 * s;
    const bw = 16 * s;
    const bh = 14.5 * s;
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
    ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
    ctx.arcTo(bx, by + bh, bx, by, r);
    ctx.arcTo(bx, by, bx + bw, by, r);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(8.5 * s, 3.5 * s);
    ctx.lineTo(8.5 * s, 7 * s);
    ctx.moveTo(15.5 * s, 3.5 * s);
    ctx.lineTo(15.5 * s, 7 * s);
    ctx.moveTo(8.5 * s, 13.2 * s);
    ctx.lineTo(11.1 * s, 15.8 * s);
    ctx.lineTo(15.7 * s, 10.6 * s);
    ctx.stroke();
    ctx.restore();
  }

  /** Фон: вертикальный градиент, растр из точек в правом верхнем углу, крупный штамп слева внизу. */
  function begin(target, W, H, style, scale = 1) {
    const pw = Math.round(W * scale);
    const ph = Math.round(H * scale);
    if (target.width !== pw || target.height !== ph) {
      target.width = pw;
      target.height = ph;
    }
    const ctx = target.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, style.bg);
    gradient.addColorStop(1, style.bg2);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    // Растр: точки уменьшаются к центру
    const step = Math.round(W / 27);
    const area = Math.min(W, H) * 0.42;
    ctx.fillStyle = style.dots;
    for (let gx = W - step / 2; gx > W - area; gx -= step) {
      for (let gy = step / 2; gy < area; gy += step) {
        const d = Math.hypot(W - gx, gy) / area;
        if (d >= 1) continue;
        ctx.beginPath();
        ctx.arc(gx, gy, (1 - d) * step * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Штамп Jazyl
    const stampSize = Math.min(W, H) * 0.62;
    ctx.save();
    ctx.translate(-stampSize * 0.18, H - stampSize * 0.72);
    ctx.rotate(-0.18);
    drawStamp(ctx, 0, 0, stampSize, style.stamp, stampSize / 22);
    ctx.restore();

    return { ctx, p: makePainter(ctx) };
  }

  /**
   * Талон: прямоугольник с полукруглыми вырезами.
   *   cutX — вертикальная перфорация (вырезы сверху и снизу), cutY — горизонтальная (вырезы слева и справа);
   *   без них — вырезы по бокам посередине.
   */
  function ticket(ctx, { x, y, w, h, r = 22, notch = 14, cutX = null, cutY = null, fill, line }) {
    const n = notch;
    const sideY = cutY ?? (cutX == null ? y + h / 2 : null);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    if (cutX != null) {
      ctx.lineTo(cutX - n, y);
      ctx.arc(cutX, y, n, Math.PI, 0, false);
    }
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    if (sideY != null) {
      ctx.lineTo(x + w, sideY - n);
      ctx.arc(x + w, sideY, n, -Math.PI / 2, Math.PI / 2, true);
    }
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    if (cutX != null) {
      ctx.lineTo(cutX + n, y + h);
      ctx.arc(cutX, y + h, n, 0, Math.PI, true);
    }
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    if (sideY != null) {
      ctx.lineTo(x, sideY + n);
      ctx.arc(x, sideY, n, Math.PI / 2, -Math.PI / 2, true);
    }
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    // Перфорация
    if (line && (cutX != null || cutY != null)) {
      ctx.save();
      ctx.strokeStyle = line;
      ctx.lineWidth = Math.max(2, n * 0.18);
      ctx.setLineDash([n * 0.55, n * 0.55]);
      ctx.beginPath();
      if (cutX != null) {
        ctx.moveTo(cutX, y + n + 6);
        ctx.lineTo(cutX, y + h - n - 6);
      } else {
        ctx.moveTo(x + n + 6, cutY);
        ctx.lineTo(x + w - n - 6, cutY);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Наклейка под углом: плашка-«таблетка» с текстом. Возвращает ширину. */
  function sticker(ctx, p, { text, x, y, size, angle = -0.06, fill, color, align = "left" }) {
    p.font(size, 800);
    p.spacing(size * 0.06);
    const w = ctx.measureText(text).width + size * 1.3;
    const h = size * 1.9;
    ctx.save();
    ctx.translate(align === "right" ? x - w : x, y);
    ctx.rotate(angle);
    ctx.fillStyle = fill;
    p.roundRect(0, 0, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(text, w / 2, h / 2 + size * 0.05);
    ctx.restore();
    p.spacing(0);
    ctx.textAlign = "left";
    return w;
  }

  /** Подпись внизу по центру: штамп + «сделано в Jazyl». */
  function drawWatermark(ctx, p, style, text, W, y) {
    p.font(24, 600);
    p.spacing(1);
    const tw = ctx.measureText(text).width;
    const total = tw + 34;
    const x0 = (W - total) / 2;
    ctx.globalAlpha = 0.75;
    drawStamp(ctx, x0, y - 22, 26, style.sub, 2.4);
    ctx.fillStyle = style.sub;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x0 + 34, y);
    ctx.globalAlpha = 1;
    p.spacing(0);
  }

  /** Строки «как записаться» для выбранного языка. */
  function howLines(cfg) {
    const t = HOW[cfg.lang] || HOW.ru;
    if (cfg.how === "custom") return cfg.custom?.trim() ? [cfg.custom.trim()] : [];
    if (cfg.how === "whatsapp") return [cfg.whatsapp?.trim() ? `${t.whatsapp}: ${cfg.whatsapp.trim()}` : t.whatsapp];
    if (cfg.how === "none") return [];
    return [t[cfg.how] || t.link];
  }

  /** Низ картинки: @ник, «как записаться», штамп. Возвращает y, выше которого можно рисовать. */
  function drawFooter(ctx, p, cfg, style, W, H, padX, maxWidth = W - padX * 2) {
    const t = HOW[cfg.lang] || HOW.ru;
    drawWatermark(ctx, p, style, t.watermark, W, H - 56);
    let y = H - 120;
    ctx.textBaseline = "alphabetic";
    p.font(34, 500);
    const how = howLines(cfg).flatMap((line) => p.wrap(line, maxWidth));
    for (let i = how.length - 1; i >= 0; i--) {
      p.font(34, 500);
      ctx.fillStyle = style.sub;
      ctx.fillText(how[i], padX, y);
      y -= 46;
    }
    const nick = String(cfg.nick || "").trim();
    if (nick) {
      p.font(50, 800);
      ctx.fillStyle = style.text;
      ctx.fillText(p.fit(nick, maxWidth), padX, y - 4);
      y -= 74;
    }
    return y - 24;
  }

  // ---------------------------------------------------------------------------
  // QR
  // ---------------------------------------------------------------------------

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

  const qrCache = new Map();
  function drawQr(ctx, p, text, x, y, size, dark = "#15131f") {
    if (window.qrcode && !qrCache.has(text)) {
      try {
        window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs["UTF-8"];
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
    p.roundRect(x, y, size, size, size * 0.1);
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

  /** Цвет модулей QR: тёмный текст палитры или почти чёрный. */
  function qrDark(style) {
    const m = String(style.ticketText).match(/^#([0-9a-f]{6})$/i);
    if (!m) return "#15131f";
    const n = parseInt(m[1], 16);
    const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum < 0.4 ? style.ticketText : "#15131f";
  }

  // ---------------------------------------------------------------------------
  // Редактор: палитры, шаблоны, кнопки
  // ---------------------------------------------------------------------------

  /** Кнопки палитр: полоска фона, талон и наклейка. */
  function styleButtons() {
    return STYLES.map(
      (st) => `
      <button type="button" class="st-swatch" data-style="${st.id}" aria-pressed="false" title="${st.name}">
        <span class="st-swatch__bg" style="background:linear-gradient(180deg, ${st.bg}, ${st.bg2})">
          <span class="st-swatch__ticket" style="background:${st.ticket}"></span>
          <span class="st-swatch__dot" style="background:${st.accent}"></span>
        </span>
        <span class="st-swatch__name">${st.name}</span>
      </button>`
    ).join("");
  }

  /** Шаблоны: миниатюры в ленте наверху. Клик — onPick(index). */
  function renderTemplates(draw, templates, onPick) {
    document.querySelectorAll("[data-template]").forEach((button) => {
      const cfg = templates[Number(button.dataset.template)];
      const canvas = button.querySelector("canvas");
      if (!cfg || !canvas) return;
      draw(canvas, cfg, 0.2);
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-template]").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
        onPick(Number(button.dataset.template));
      });
    });
  }

  /** Переключатели [data-<group>]: подсветка выбранного. */
  function setPressed(root, group, value) {
    root.querySelectorAll(`[data-${group}]`).forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset[group] === value));
    });
  }

  /**
   * «Скачать», «Поделиться» (если телефон умеет делиться файлами), «Скопировать текст».
   * render() — дорисовать картинку перед сохранением, fileName() и text() — по текущему состоянию.
   */
  function bindActions({ canvas, render, fileName, text, download, share, copy }) {
    const toBlob = () => {
      render();
      return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    };

    download?.addEventListener("click", async () => {
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

    if (share && navigator.canShare && navigator.canShare({ files: [new File([new Blob()], "x.png", { type: "image/png" })] })) {
      share.hidden = false;
      share.addEventListener("click", async () => {
        const blob = await toBlob();
        if (!blob) return;
        try {
          await navigator.share({ files: [new File([blob], fileName(), { type: "image/png" })] });
        } catch {
          // окно «Поделиться» закрыли
        }
      });
    }

    if (copy) {
      const label = copy.textContent;
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(text());
          copy.textContent = "Скопировано ✓";
          setTimeout(() => {
            copy.textContent = label;
          }, 1800);
        } catch {
          window.prompt("Скопируйте текст:", text());
        }
      });
    }
  }

  /** Сохранение в браузере (только на этом устройстве). Ошибки молча пропускаем. */
  function storage(key) {
    return {
      load() {
        try {
          return JSON.parse(localStorage.getItem(key) || "null");
        } catch {
          return null;
        }
      },
      save(value) {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch {
          // приватный режим — не страшно
        }
      },
    };
  }

  /** Перерисовка не чаще кадра. */
  function scheduler(fn) {
    let frame = 0;
    return () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fn);
    };
  }

  /** Шрифт картинки (Inter, включая казахские буквы). Не бросает. */
  function fontsReady() {
    const fonts = document.fonts;
    if (!fonts) return Promise.resolve();
    return Promise.all([
      fonts.load(`900 160px "Inter"`),
      fonts.load(`800 60px "Inter"`, "әғқңөұүһі"),
      fonts.load(`600 40px "Inter"`),
      fonts.load(`500 34px "Inter"`),
    ]).catch(() => null);
  }

  return {
    FONT,
    STYLES,
    findStyle,
    makePainter,
    begin,
    ticket,
    sticker,
    drawStamp,
    drawWatermark,
    drawFooter,
    howLines,
    qrTarget,
    drawQr,
    qrDark,
    styleButtons,
    renderTemplates,
    setPressed,
    bindActions,
    storage,
    scheduler,
    fontsReady,
  };
})();
