/**
 * Jazyl — загрузка фото в хранилище (bucket «media», папка = id салона).
 *
 * Перед загрузкой фото уменьшается и сжимается прямо в браузере:
 * фото с телефона 5–10 МБ превращается в ~150–400 КБ.
 */
window.BooklyMedia = (() => {
  const BUCKET = "media";
  const MAX_INPUT_BYTES = 20 * 1024 * 1024;

  /** Насколько уменьшать: длинная сторона в пикселях. */
  const SIZES = {
    cover: 1600,
    portfolio: 1400,
    logo: 512,
    service: 640,
    staff: 512,
  };

  async function loadImage(file) {
    if (window.createImageBitmap) {
      try {
        return await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch {
        // старый браузер — ниже через <img>
      }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  /** Уменьшает фото до maxSide и сжимает в WebP (или JPEG, если WebP не поддерживается). */
  async function compress(file, maxSide) {
    if (!file || !/^image\//.test(file.type)) throw new Error("Выберите фото (JPG, PNG или WebP).");
    if (file.size > MAX_INPUT_BYTES) throw new Error("Фото слишком большое — до 20 МБ.");

    const image = await loadImage(file);
    const w = image.width;
    const h = image.height;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (image.close) image.close();

    let blob = await canvasToBlob(canvas, "image/webp", 0.82);
    if (!blob || blob.type !== "image/webp") blob = await canvasToBlob(canvas, "image/jpeg", 0.85);
    if (!blob) throw new Error("Не удалось обработать фото.");
    return blob;
  }

  function randomId() {
    return (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/[^a-z0-9-]/gi, "");
  }

  /**
   * Загружает фото и возвращает публичную ссылку.
   * @param {string} organizationId
   * @param {"cover"|"logo"|"portfolio"|"service"|"staff"} kind
   */
  async function upload(organizationId, kind, file) {
    const blob = await compress(file, SIZES[kind] || 1200);
    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    const path = `${organizationId}/${kind}/${randomId()}.${ext}`;
    const supabase = await BooklyAuth.getClient();

    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
      contentType: blob.type,
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) {
      BooklyAuth.log?.("[Media] upload error:", error.message);
      throw new Error("Не удалось загрузить фото. Попробуйте ещё раз.");
    }
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  /** Удаляет файл по публичной ссылке. Чужие и внешние ссылки молча пропускает. */
  async function removeByUrl(url) {
    const marker = `/storage/v1/object/public/${BUCKET}/`;
    const index = String(url || "").indexOf(marker);
    if (index === -1) return;
    const path = decodeURIComponent(url.slice(index + marker.length).split("?")[0]);
    try {
      const supabase = await BooklyAuth.getClient();
      await supabase.storage.from(BUCKET).remove([path]);
    } catch {
      // файл остался — не страшно, ссылка на него уже убрана
    }
  }

  // ---------------------------------------------------------------------------
  // Поле «фото» в форме (услуга, мастер): <div data-photo-field> с превью,
  // кнопкой выбора и скрытым input name="photo_url". Фото грузится сразу при выборе,
  // в базу ссылка попадает вместе с остальной формой.
  // ---------------------------------------------------------------------------

  function setPhotoField(field, url) {
    if (!field) return;
    const value = url || "";
    field.querySelector('input[name="photo_url"]').value = value;
    const preview = field.querySelector(".photo-field__preview");
    preview.innerHTML = value ? `<img src="${value.replace(/"/g, "&quot;")}" alt="">` : `<span aria-hidden="true">+</span>`;
    field.querySelector("[data-photo-clear]").hidden = !value;
    field.querySelector(".photo-field__error").hidden = true;
  }

  /** @param {() => string} getOrganizationId */
  function bindPhotoField(field, kind, getOrganizationId) {
    if (!field) return;
    const input = field.querySelector('input[type="file"]');
    const label = field.querySelector(".photo-field__pick-text");
    const error = field.querySelector(".photo-field__error");

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      const original = label.textContent;
      label.textContent = "Загрузка…";
      field.classList.add("is-loading");
      try {
        setPhotoField(field, await upload(getOrganizationId(), kind, file));
      } catch (err) {
        error.textContent = err.message || "Не удалось загрузить фото.";
        error.hidden = false;
      } finally {
        label.textContent = original;
        field.classList.remove("is-loading");
      }
    });

    field.querySelector("[data-photo-clear]").addEventListener("click", () => setPhotoField(field, ""));
  }

  return { upload, removeByUrl, compress, bindPhotoField, setPhotoField };
})();
