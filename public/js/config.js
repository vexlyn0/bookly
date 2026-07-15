/**
 * Клиентская конфигурация Bookly
 */
(function () {
  window.BOOKLY_CONFIG = {
    apiBase: "",
    assetBase: "",
  };

  window.booklyPath = function booklyPath(pathPart) {
    const normalized = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
    return `${window.BOOKLY_CONFIG.assetBase}${normalized}`;
  };
})();
