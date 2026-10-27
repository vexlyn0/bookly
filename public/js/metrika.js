/**
 * Jazyl — Яндекс Метрика (счётчик 113814956).
 * Подключается только на сайте, регистрации и демо-салоне — не в кабинете и не на
 * страницах записи настоящих салонов, чтобы данные их клиентов не уходили в Яндекс.
 *
 *   <script src="/js/metrika.js" data-webvisor="1" async></script>
 *   data-webvisor="1" — записывать визиты (Вебвизор); там, где вводят личные данные, — без него.
 *
 * Цели (Метрика → Цели → «JavaScript-событие»): register, register_google, demo_booking.
 * Вызывать: window.jazylGoal?.("register").
 */
(function () {
  var COUNTER_ID = 113814956;
  var script = document.currentScript;
  var webvisor = Boolean(script && script.dataset.webvisor === "1");

  (function (m, e, t, r, i, k, a) {
    m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
    m[i].l = 1 * new Date();
    for (var j = 0; j < document.scripts.length; j++) {
      if (document.scripts[j].src === r) return;
    }
    k = e.createElement(t);
    a = e.getElementsByTagName(t)[0];
    k.async = 1;
    k.src = r;
    a.parentNode.insertBefore(k, a);
  })(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");

  window.ym(COUNTER_ID, "init", {
    clickmap: true,
    trackLinks: true,
    accurateTrackBounce: true,
    webvisor: webvisor,
  });

  window.jazylGoal = function (name) {
    try {
      window.ym(COUNTER_ID, "reachGoal", name);
    } catch (error) {
      // Метрику заблокировал браузер — запись и регистрация работают и без неё.
    }
  };
})();
