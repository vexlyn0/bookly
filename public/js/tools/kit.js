/**
 * Jazyl — общее для бесплатных инструментов-картинок (/instrumenty/*):
 * стили фона, рисование на canvas, выбор стиля, скачать / поделиться / скопировать текст.
 * Подключается перед скриптом инструмента.
 */
window.JazylToolKit = (() => {
  const SANS = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
  const SERIF = '"Lora", Georgia, "Times New Roman", serif';

  /** Стили картинки. chip: filled — заливка, outline — контур. decor — украшение фона. */
  const STYLES = [
    { id: "cream", name: "Крем", bg: ["#f8f1e7", "#efe2d0"], text: "#2b2118", sub: "#b0601f", font: "serif", chip: "outline", chipFill: "#fffaf3", chipLine: "#c27a3a", chipText: "#2b2118", card: "rgba(255,255,255,0.55)", decor: "circles", decorColor: "#ead7bf" },
    { id: "chocolate", name: "Шоколад", bg: ["#2c2019", "#16100c"], text: "#f6e9d8", sub: "#d9a86c", font: "serif", chip: "outline", chipFill: "rgba(217,168,108,0.12)", chipLine: "#d9a86c", chipText: "#f6e9d8", card: "rgba(255,255,255,0.06)", decor: "rings", decorColor: "rgba(217,168,108,0.35)" },
    { id: "powder", name: "Пудра", bg: ["#fce6ee", "#f2c4d3"], text: "#4b1528", sub: "#a33a60", font: "serif", chip: "filled", chipFill: "#ffffff", chipText: "#993556", card: "rgba(255,255,255,0.45)", decor: "circles", decorColor: "rgba(255,255,255,0.55)" },
    { id: "sage", name: "Шалфей", bg: ["#e6ede1", "#d2ddcc"], text: "#1f3a2a", sub: "#4f6b55", font: "sans", chip: "filled", chipFill: "#ffffff", chipText: "#1f3a2a", card: "rgba(255,255,255,0.5)", decor: "blob", decorColor: "#bccdb5" },
    { id: "minimal", name: "Минимал", bg: ["#ffffff", "#ffffff"], text: "#111111", sub: "#555555", font: "sans", chip: "filled", chipFill: "#111111", chipText: "#ffffff", card: "#f3f3f3", decor: "frame", decorColor: "#111111" },
    { id: "terracotta", name: "Терракота", bg: ["#d36a42", "#b9512d"], text: "#fff5ee", sub: "#ffe0cf", font: "sans", chip: "filled", chipFill: "#fff1e8", chipText: "#b9512d", card: "rgba(255,255,255,0.12)", decor: "circles", decorColor: "rgba(255,255,255,0.12)" },
    { id: "night", name: "Ночь", bg: ["#2a2550", "#0d0c14"], text: "#ffffff", sub: "#afa9ec", font: "sans", chip: "filled", chipFill: "#7f77dd", chipText: "#ffffff", card: "rgba(255,255,255,0.08)", decor: "glow", decorColor: "rgba(127,119,221,0.35)" },
    { id: "lavender", name: "Лаванда", bg: ["#f6f5ff", "#cecbf6"], text: "#26215c", sub: "#534ab7", font: "serif", chip: "filled", chipFill: "#534ab7", chipText: "#ffffff", card: "rgba(255,255,255,0.6)", decor: "circles", decorColor: "rgba(255,255,255,0.6)" },
  ];

  const findStyle = (id) => STYLES.find((st) => st.id === id) || STYLES[0];

  function makePainter(ctx) {
    return {
      font(size, weight, family = SANS) {
        ctx.font = `${weight} ${Math.round(size)}px ${family}`;
      },
      spacing(px) {
        if ("letterSpacing" in ctx) ctx.letterSpacing = `${px}px`;
      },
      roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
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
      /** Обрезает строку с «…», чтобы влезла в ширину. */
      fit(text, maxWidth) {
        let value = String(text);
        if (ctx.measureText(value).width <= maxWidth) return value;
        while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1);
        return `${value.trimEnd()}…`;
      },
    };
  }

  function drawDecor(ctx, style, W, H) {
    ctx.save();
    ctx.fillStyle = style.decorColor;
    ctx.strokeStyle = style.decorColor;
    if (style.decor === "circles") {
      ctx.beginPath();
      ctx.arc(W * 0.95, H * 0.03, W * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(W * 0.02, H * 0.97, W * 0.26, 0, Math.PI * 2);
      ctx.fill();
    } else if (style.decor === "rings") {
      ctx.lineWidth = 3;
      for (const r of [0.34, 0.44, 0.54]) {
        ctx.beginPath();
        ctx.arc(W * 1.02, H * 0.05, W * r, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (style.decor === "blob") {
      ctx.beginPath();
      ctx.ellipse(W * 0.92, H * 0.06, W * 0.36, W * 0.2, -0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(W * 0.06, H * 0.96, W * 0.3, W * 0.16, -0.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (style.decor === "frame") {
      ctx.lineWidth = 3;
      ctx.strokeRect(40, 40, W - 80, H - 80);
    } else if (style.decor === "glow") {
      const glow = ctx.createRadialGradient(W * 0.9, H * 0.08, 0, W * 0.9, H * 0.08, W * 0.8);
      glow.addColorStop(0, style.decorColor);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  /** Готовит canvas под размер W×H (с масштабом) и рисует фон стиля. */
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
    const gradient = ctx.createLinearGradient(0, 0, W * 0.4, H);
    gradient.addColorStop(0, style.bg[0]);
    gradient.addColorStop(1, style.bg[1]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
    drawDecor(ctx, style, W, H);
    return { ctx, p: makePainter(ctx) };
  }

  /** Маленькая подпись Jazyl по центру внизу. */
  function drawWatermark(ctx, p, style, text, W, y) {
    ctx.textBaseline = "alphabetic";
    p.font(24, 500);
    p.spacing(1);
    ctx.fillStyle = style.sub;
    ctx.globalAlpha = 0.7;
    ctx.textAlign = "center";
    ctx.fillText(text, W / 2, y);
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    p.spacing(0);
  }

  /** Кнопки выбора стиля (разметка .ok-style, состояние — aria-pressed). */
  function styleButtons() {
    return STYLES.map(
      (st) => `
      <button type="button" class="ok-style" data-style="${st.id}" aria-pressed="false" title="${st.name}">
        <span class="ok-style__bg" style="background:linear-gradient(160deg, ${st.bg[0]}, ${st.bg[1]})"></span>
        <span class="ok-style__dot" style="background:${st.chip === "outline" ? st.chipLine : st.chipFill}"></span>
        <span class="ok-style__name">${st.name}</span>
      </button>`
    ).join("");
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

  /** Шрифты картинки (Inter и Lora с казахскими буквами). Не бросает. */
  function fontsReady() {
    const fonts = document.fonts;
    if (!fonts) return Promise.resolve();
    return Promise.all([
      fonts.load(`800 124px "Inter"`),
      fonts.load(`700 52px "Inter"`),
      fonts.load(`500 40px "Inter"`),
      fonts.load(`700 132px "Lora"`),
      fonts.load(`700 132px "Lora"`, "әғқңөұүһі"),
    ]).catch(() => null);
  }

  return { SANS, SERIF, STYLES, findStyle, makePainter, drawDecor, begin, drawWatermark, styleButtons, bindActions, fontsReady };
})();
