/**
 * Bookly — язык страниц клиента (онлайн-запись и «Моя запись»): русский и казахский.
 *
 * Язык: ?lang=kk|ru → сохранённый выбор → язык телефона (kk*) → русский.
 * Статичный текст в HTML помечается data-i18n="ключ" (и data-i18n-html для разметки).
 */
window.PublicBookingI18n = (() => {
  const STORAGE_KEY = "bookly:lang";
  const LANGS = ["ru", "kk"];

  const DICT = {
    ru: {
      loading: "Загрузка…",
      page_unavailable: "Страница недоступна",
      booking_unavailable: "Онлайн-запись недоступна",
      no_slug: "Не указан адрес организации.",
      page_title: "{org} — онлайн-запись",

      success_title: "Вы записаны!",
      success_pending: "Салон подтвердит запись — мы сообщим",
      success_confirmed: "Ждём вас!",
      when: "Когда",
      service: "Услуга",
      master: "Мастер",
      reference: "Номер записи",
      save_link_title: "Сохраните ссылку на запись",
      save_link_text: "По ней можно перенести или отменить запись, если планы изменятся.",
      save_whatsapp: "Сохранить в WhatsApp",
      copy_link: "Скопировать ссылку",
      copied: "Скопировано ✓",
      copy_prompt: "Скопируйте ссылку:",
      whatsapp_message: "Моя запись{org}: {service}, {date} в {time}. Перенести или отменить: {url}",
      whatsapp_org: " в «{org}»",
      book_again: "Записаться ещё раз",
      powered: 'Онлайн-запись через <a href="/?utm_source=booking_page" target="_blank" rel="noopener">Bookly</a> — создайте свою бесплатно',

      step_service: "Услуга",
      step_staff: "Мастер",
      step_time: "Дата и время",
      step_client: "Ваши данные",
      step_count: "Шаг {n} из {total}",
      back: "Назад",

      no_services: "Сейчас нет доступных услуг для онлайн-записи.",
      choose_service: "Выберите услугу",
      choose: "Выбрать",
      choose_master: "Выберите мастера",
      no_masters: "Для этой услуги сейчас нет свободных мастеров.",
      any_master: "Любой мастер",
      any_master_hint: "к кому раньше",
      masters_hint: "Нажмите на время под мастером — запишем на ближайшее.",
      no_windows: "Нет окон на 2 недели",
      book_this_time: "Записаться на это время",

      choose_time: "Выберите дату и время",
      today: "Сегодня",
      tomorrow: "Завтра",
      today_short: "сег",
      weekdays_short: "вс,пн,вт,ср,чт,пт,сб",
      day_off: "Выходной",
      other_date: "Другая дата",
      date: "Дата",
      no_free_time: "В этот день свободного времени нет.",
      nearest: "Ближайшее: {when} →",
      morning: "Утро",
      afternoon: "День",
      evening: "Вечер",

      almost_done: "Почти готово",
      your_name: "Ваше имя",
      phone: "Телефон",
      comment: "Комментарий",
      optional: "— необязательно",
      add_comment: "+ Добавить комментарий",
      consent: "Нажимая «Записаться», вы соглашаетесь на обработку имени и телефона для записи.",
      submit: "Записаться",
      submitting: "Создание записи…",
      please_wait: "Подождите…",
      err_name: "Как вас зовут? Имя — минимум 2 буквы.",
      err_phone: "Укажите номер телефона полностью.",

      verify_title: "Остался один шаг — подтвердите номер {phone}",
      verify_step1: "Откройте Telegram кнопкой ниже.",
      verify_step2: "Нажмите <b>Start</b>, затем <b>«Поделиться номером»</b>.",
      verify_step3: "Вернитесь сюда — запись создастся сама.",
      verify_open: "Открыть Telegram",
      verify_wait: "Ждём подтверждения…",
      verify_note: "Это нужно только в первый раз — дальше записывайтесь без подтверждения.",
      verify_mismatch: "Номер вашего Telegram не совпадает с {phone}. Укажите номер, к которому привязан Telegram.",
      verify_expired: "Время на подтверждение истекло. Попробуйте ещё раз.",
      verify_retry: "Подтвердить ещё раз",
      change_phone: "Изменить номер",

      duration_h: "{h} ч",
      duration_m: "{m} мин",

      // «Моя запись»
      my_booking: "Моя запись",
      manage_title: "Моя запись — Bookly",
      not_found_title: "Запись не найдена",
      not_found_text: "Проверьте ссылку или свяжитесь с салоном.",
      status: "Статус",
      time: "Время",
      name: "Имя",
      status_pending: "Ожидает подтверждения",
      status_confirmed: "Подтверждена",
      status_canceled: "Отменена",
      status_completed: "Завершена",
      status_no_show: "Визит не состоялся",
      phone_label: "Телефон: {phone}",
      address_label: "Адрес: {address}",
      call: "Позвонить: {phone}",
      reason_too_late: "Отменить или перенести запись онлайн можно не позже чем за {hours} ч до визита. Сейчас — только по телефону.",
      reason_disabled: "Чтобы отменить или перенести запись, свяжитесь с салоном.",
      reason_limit: "Онлайн-перенос уже использован. Чтобы перенести ещё раз, позвоните в салон.",
      cutoff_hint: "Перенести или отменить онлайн можно не позже чем за {hours} ч до визита.",
      book_again_short: "Записаться снова",
      reschedule: "Перенести",
      cancel_booking: "Отменить запись",
      you_are_booked: "Вы записаны",
      booking: "Запись",
      cancel_question: "Отменить запись?",
      cancel_hint: "Время освободится, и на него сможет записаться другой клиент.",
      keep: "Не отменять",
      canceling: "Отмена…",
      yes_cancel: "Да, отменить",
      reschedule_title: "Перенести запись",
      now_booked: "Сейчас: {date}, {time} · мастер {staff}",
      new_date: "Новая дата",
      no_slots_date: "На эту дату свободного времени нет. Выберите другой день.",
      rescheduling: "Перенос…",
      reschedule_to: "Перенести на {time}",
      choose_time_btn: "Выберите время",
      canceled_notice: "Запись отменена. Спасибо, что предупредили!",
      rescheduled_notice: "Готово! Запись перенесена.",
    },

    kk: {
      loading: "Жүктелуде…",
      page_unavailable: "Бет қолжетімсіз",
      booking_unavailable: "Онлайн жазылу қолжетімсіз",
      no_slug: "Ұйымның мекенжайы көрсетілмеген.",
      page_title: "{org} — онлайн жазылу",

      success_title: "Сіз жазылдыңыз!",
      success_pending: "Салон жазылуды растайды — біз хабарлаймыз",
      success_confirmed: "Сізді күтеміз!",
      when: "Қашан",
      service: "Қызмет",
      master: "Шебер",
      reference: "Жазылу нөмірі",
      save_link_title: "Жазылу сілтемесін сақтап қойыңыз",
      save_link_text: "Жоспарыңыз өзгерсе, осы сілтеме арқылы жазылуды ауыстыруға немесе одан бас тартуға болады.",
      save_whatsapp: "WhatsApp-қа сақтау",
      copy_link: "Сілтемені көшіру",
      copied: "Көшірілді ✓",
      copy_prompt: "Сілтемені көшіріп алыңыз:",
      whatsapp_message: "Менің жазылуым{org}: {service}, {date}, {time}. Ауыстыру немесе бас тарту: {url}",
      whatsapp_org: " («{org}»)",
      book_again: "Тағы жазылу",
      powered: '<a href="/?utm_source=booking_page" target="_blank" rel="noopener">Bookly</a> арқылы онлайн жазылу — өзіңіздікін тегін жасаңыз',

      step_service: "Қызмет",
      step_staff: "Шебер",
      step_time: "Күні мен уақыты",
      step_client: "Сіздің деректеріңіз",
      step_count: "{n}-қадам, барлығы {total}",
      back: "Артқа",

      no_services: "Қазір онлайн жазылуға қолжетімді қызметтер жоқ.",
      choose_service: "Қызметті таңдаңыз",
      choose: "Таңдау",
      choose_master: "Шеберді таңдаңыз",
      no_masters: "Бұл қызметке қазір бос шебер жоқ.",
      any_master: "Кез келген шебер",
      any_master_hint: "ең ерте босайтыны",
      masters_hint: "Шебердің астындағы уақытты басыңыз — ең жақын уақытқа жазамыз.",
      no_windows: "2 аптада бос уақыт жоқ",
      book_this_time: "Осы уақытқа жазылу",

      choose_time: "Күн мен уақытты таңдаңыз",
      today: "Бүгін",
      tomorrow: "Ертең",
      today_short: "бүг",
      weekdays_short: "жс,дс,сс,ср,бс,жм,сб",
      day_off: "Демалыс",
      other_date: "Басқа күн",
      date: "Күні",
      no_free_time: "Бұл күні бос уақыт жоқ.",
      nearest: "Ең жақын: {when} →",
      morning: "Таңертең",
      afternoon: "Күндіз",
      evening: "Кешке",

      almost_done: "Аз қалды",
      your_name: "Атыңыз",
      phone: "Телефон",
      comment: "Түсініктеме",
      optional: "— міндетті емес",
      add_comment: "+ Түсініктеме қосу",
      consent: "«Жазылу» батырмасын басу арқылы сіз жазылу үшін атыңыз бен телефоныңыздың өңделуіне келісесіз.",
      submit: "Жазылу",
      submitting: "Жазылу жасалуда…",
      please_wait: "Күте тұрыңыз…",
      err_name: "Атыңыз кім? Аты кемінде 2 әріптен тұруы керек.",
      err_phone: "Телефон нөмірін толық көрсетіңіз.",

      verify_title: "Бір қадам қалды — {phone} нөмірін растаңыз",
      verify_step1: "Төмендегі батырма арқылы Telegram-ды ашыңыз.",
      verify_step2: "<b>Start</b>, содан кейін <b>«Поделиться номером»</b> батырмасын басыңыз.",
      verify_step3: "Осында оралыңыз — жазылу өздігінен жасалады.",
      verify_open: "Telegram-ды ашу",
      verify_wait: "Растауды күтудеміз…",
      verify_note: "Бұл тек бірінші рет қажет — кейін растаусыз жазыла бересіз.",
      verify_mismatch: "Telegram нөміріңіз {phone} нөмірімен сәйкес келмейді. Telegram тіркелген нөмірді көрсетіңіз.",
      verify_expired: "Растау уақыты өтіп кетті. Қайталап көріңіз.",
      verify_retry: "Қайта растау",
      change_phone: "Нөмірді өзгерту",

      duration_h: "{h} сағ",
      duration_m: "{m} мин",

      my_booking: "Менің жазылуым",
      manage_title: "Менің жазылуым — Bookly",
      not_found_title: "Жазылу табылмады",
      not_found_text: "Сілтемені тексеріңіз немесе салонға хабарласыңыз.",
      status: "Күйі",
      time: "Уақыты",
      name: "Аты",
      status_pending: "Растауды күтуде",
      status_confirmed: "Расталды",
      status_canceled: "Жойылды",
      status_completed: "Аяқталды",
      status_no_show: "Келмеді",
      phone_label: "Телефон: {phone}",
      address_label: "Мекенжайы: {address}",
      call: "Қоңырау шалу: {phone}",
      reason_too_late: "Жазылуды онлайн ауыстыру немесе одан бас тарту келуге {hours} сағат қалғанға дейін ғана мүмкін. Қазір — тек телефон арқылы.",
      reason_disabled: "Жазылуды ауыстыру немесе одан бас тарту үшін салонға хабарласыңыз.",
      reason_limit: "Онлайн ауыстыру мүмкіндігі пайдаланылды. Тағы ауыстыру үшін салонға қоңырау шалыңыз.",
      cutoff_hint: "Онлайн ауыстыру немесе бас тарту келуге {hours} сағат қалғанға дейін мүмкін.",
      book_again_short: "Қайта жазылу",
      reschedule: "Ауыстыру",
      cancel_booking: "Жазылудан бас тарту",
      you_are_booked: "Сіз жазылдыңыз",
      booking: "Жазылу",
      cancel_question: "Жазылудан бас тартасыз ба?",
      cancel_hint: "Уақыт босайды, оған басқа клиент жазыла алады.",
      keep: "Жазылуды қалдыру",
      canceling: "Бас тартылуда…",
      yes_cancel: "Иә, бас тарту",
      reschedule_title: "Жазылуды ауыстыру",
      now_booked: "Қазір: {date}, {time} · шебер {staff}",
      new_date: "Жаңа күн",
      no_slots_date: "Бұл күні бос уақыт жоқ. Басқа күнді таңдаңыз.",
      rescheduling: "Ауыстырылуда…",
      reschedule_to: "{time} уақытына ауыстыру",
      choose_time_btn: "Уақытты таңдаңыз",
      canceled_notice: "Жазылу жойылды. Ескерткеніңізге рахмет!",
      rescheduled_notice: "Дайын! Жазылу ауыстырылды.",
    },
  };

  /** Ошибки сервера по коду. Нет перевода — показываем текст сервера. */
  const ERRORS = {
    ru: {
      ORGANIZATION_NOT_FOUND: "Организация не найдена.",
      PUBLIC_BOOKING_DISABLED: "Онлайн-запись временно недоступна.",
      SERVICE_NOT_FOUND: "Услуга не найдена.",
      SERVICE_INACTIVE: "Услуга недоступна для записи.",
      STAFF_NOT_FOUND: "Сотрудник не найден.",
      STAFF_INACTIVE: "Сотрудник недоступен для записи.",
      STAFF_SERVICE_MISMATCH: "Сотрудник не оказывает выбранную услугу.",
      NO_WORK_SCHEDULE: "На выбранную дату нет рабочего времени.",
      BOOKING_IN_PAST: "Нельзя записаться на прошедшее время.",
      BOOKING_TIME_CONFLICT: "Это время уже занято. Выберите другой слот.",
      VALIDATION_ERROR: "Проверьте введённые данные.",
      TOO_MANY_BOOKING_ATTEMPTS: "Слишком много попыток. Попробуйте позже.",
      NETWORK_ERROR: "Ошибка соединения. Проверьте интернет и попробуйте снова.",
      GENERIC: "Не удалось выполнить запрос. Попробуйте позже.",
      BOOKING_NOT_FOUND: "Запись не найдена. Проверьте ссылку.",
      CANCEL_NOT_ALLOWED: "Отменить эту запись онлайн уже нельзя. Позвоните в салон.",
      RESCHEDULE_NOT_ALLOWED: "Перенести эту запись онлайн уже нельзя. Позвоните в салон.",
      BOOKING_CHANGED: "Запись только что изменилась. Страница обновлена.",
    },
    kk: {
      ORGANIZATION_NOT_FOUND: "Ұйым табылмады.",
      PUBLIC_BOOKING_DISABLED: "Онлайн жазылу уақытша қолжетімсіз.",
      ORGANIZATION_SUSPENDED: "Онлайн жазылу уақытша қолжетімсіз. Салонға қоңырау шалыңыз.",
      SUBSCRIPTION_REQUIRED: "Онлайн жазылу уақытша қолжетімсіз.",
      SERVICE_NOT_FOUND: "Қызмет табылмады.",
      SERVICE_INACTIVE: "Бұл қызметке жазылу мүмкін емес.",
      BOOKING_SERVICE_INACTIVE: "Бұл қызметке жазылу мүмкін емес.",
      STAFF_NOT_FOUND: "Шебер табылмады.",
      STAFF_INACTIVE: "Бұл шеберге жазылу мүмкін емес.",
      BOOKING_STAFF_INACTIVE: "Бұл шеберге жазылу мүмкін емес.",
      STAFF_SERVICE_MISMATCH: "Шебер таңдалған қызметті көрсетпейді.",
      BOOKING_STAFF_SERVICE_MISMATCH: "Шебер таңдалған қызметті көрсетпейді.",
      NO_WORK_SCHEDULE: "Таңдалған уақытта шебер жұмыс істемейді.",
      BOOKING_OUTSIDE_SCHEDULE: "Таңдалған уақытта шебер жұмыс істемейді.",
      BOOKING_STAFF_DAY_OFF: "Бұл күні шебер жұмыс істемейді.",
      BOOKING_IN_PAST: "Өткен уақытқа жазылуға болмайды.",
      BOOKING_TIME_CONFLICT: "Бұл уақыт бос емес. Басқа уақытты таңдаңыз.",
      SLOT_UNAVAILABLE: "Бұл уақыт қолжетімсіз. Басқасын таңдаңыз.",
      VALIDATION_ERROR: "Енгізілген деректерді тексеріңіз.",
      TOO_MANY_BOOKING_ATTEMPTS: "Тым көп әрекет. Кейінірек қайталаңыз.",
      TOO_MANY_ACTIVE_BOOKINGS:
        "Бұл нөмірге алдағы 2 жазылу бар. Тағы жазылу үшін біреуін растау хабарламасындағы сілтеме арқылы ауыстырыңыз немесе одан бас тартыңыз — немесе салонға қоңырау шалыңыз.",
      CLIENT_BLOCKED: "Бұл нөмір үшін онлайн жазылу қолжетімсіз. Салонға телефон арқылы хабарласыңыз.",
      VERIFICATION_UNAVAILABLE: "Нөмірді растау уақытша қолжетімсіз.",
      VERIFICATION_NOT_FOUND: "Растау өтінімі табылмады. Қайталап көріңіз.",
      NETWORK_ERROR: "Байланыс қатесі. Интернетті тексеріп, қайталаңыз.",
      GENERIC: "Сұрауды орындау мүмкін болмады. Кейінірек қайталаңыз.",
      INTERNAL_ERROR: "Сұрауды орындау мүмкін болмады. Кейінірек қайталаңыз.",
      BOOKING_NOT_FOUND: "Жазылу табылмады. Сілтемені тексеріңіз.",
      CANCEL_NOT_ALLOWED: "Бұл жазылудан енді онлайн бас тарту мүмкін емес. Салонға қоңырау шалыңыз.",
      RESCHEDULE_NOT_ALLOWED: "Бұл жазылуды енді онлайн ауыстыру мүмкін емес. Салонға қоңырау шалыңыз.",
      BOOKING_CHANGED: "Жазылу жаңа ғана өзгерді. Бет жаңартылды.",
    },
  };

  function detect() {
    const fromUrl = new URLSearchParams(window.location.search).get("lang");
    if (LANGS.includes(fromUrl)) return fromUrl;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (LANGS.includes(saved)) return saved;
    } catch {
      // приватный режим
    }
    const browser = (navigator.languages || [navigator.language || ""]).map((l) => String(l).toLowerCase());
    return browser.some((l) => l.startsWith("kk")) ? "kk" : "ru";
  }

  let lang = detect();

  function t(key, vars = {}) {
    const template = DICT[lang][key] ?? DICT.ru[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? ""));
  }

  /** Текст ошибки: перевод по коду, иначе текст сервера, иначе общий. */
  function error(code, serverMessage) {
    return ERRORS[lang][code] || (lang === "ru" ? serverMessage : "") || serverMessage || ERRORS[lang].GENERIC;
  }

  // Казахские названия свои: во многих браузерах нет данных kk для Intl («M10» вместо «қазан»).
  const KK_MONTHS = ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым", "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"];
  const KK_WEEKDAYS = ["жексенбі", "дүйсенбі", "сейсенбі", "сәрсенбі", "бейсенбі", "жұма", "сенбі"];
  const RU_OPTIONS = {
    full: { day: "numeric", month: "long", year: "numeric" },
    weekdayShort: { weekday: "short", day: "numeric", month: "long" },
    weekdayLong: { weekday: "long", day: "numeric", month: "long" },
    monthYear: { month: "long", year: "numeric" },
  };

  /**
   * Дата на текущем языке.
   * full «24 октября 2026 г.» · weekdayShort «пт, 24 октября» · weekdayLong «пятница, 24 октября» · monthYear «октябрь 2026»
   */
  function formatDate(date, kind = "full") {
    if (lang !== "kk") {
      const text = date.toLocaleDateString("ru-RU", RU_OPTIONS[kind] || RU_OPTIONS.full);
      return kind === "monthYear" ? text.replace(/\s*г\.?$/, "") : text;
    }
    const day = `${date.getDate()} ${KK_MONTHS[date.getMonth()]}`;
    switch (kind) {
      case "weekdayShort":
        return `${t("weekdays_short").split(",")[date.getDay()]}, ${day}`;
      case "weekdayLong":
        return `${KK_WEEKDAYS[date.getDay()]}, ${day}`;
      case "monthYear":
        return `${KK_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
      default:
        return `${day} ${date.getFullYear()} ж.`;
    }
  }

  function apply(root = document) {
    document.documentElement.lang = lang;
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    document.querySelectorAll(".pb-lang button").forEach((button) => {
      const active = button.dataset.lang === lang;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function setLang(next) {
    if (!LANGS.includes(next) || next === lang) return;
    lang = next;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // приватный режим
    }
    apply();
    document.dispatchEvent(new CustomEvent("pb:lang", { detail: { lang } }));
  }

  /** Переключатель «РУС | ҚАЗ» в правом верхнем углу. */
  function mountSwitcher() {
    if (document.querySelector(".pb-lang")) return;
    const box = document.createElement("div");
    box.className = "pb-lang";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "Язык / Тіл");
    box.innerHTML = `
      <button type="button" data-lang="ru">РУС</button>
      <button type="button" data-lang="kk">ҚАЗ</button>`;
    box.addEventListener("click", (event) => {
      const button = event.target.closest("[data-lang]");
      if (button) setLang(button.dataset.lang);
    });
    document.body.appendChild(box);
  }

  function init() {
    mountSwitcher();
    apply();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return {
    t,
    error,
    formatDate,
    apply,
    setLang,
    get lang() {
      return lang;
    },
  };
})();
