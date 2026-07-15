/**
 * HTTP-утилиты Bookly
 */
(function () {
  window.booklyApiUrl = function booklyApiUrl(path) {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    const base = (window.BOOKLY_CONFIG && window.BOOKLY_CONFIG.apiBase) || "";
    return `${base}${normalized}`;
  };
})();
