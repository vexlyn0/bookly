/**
 * Версии статики для сайта: /css/site.css → /css/site.css?v=<8 знаков хеша содержимого>.
 * Cloudflare и браузер держат CSS/JS в кеше часами — с меткой новый файл подхватывается сразу после деплоя.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const config = require("../config");

const cache = new Map();

function versionOf(urlPath) {
  if (config.nodeEnv === "production" && cache.has(urlPath)) return cache.get(urlPath);
  let version = "";
  try {
    const file = path.join(config.publicDir, urlPath.replace(/^\/+/, ""));
    version = crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex").slice(0, 8);
  } catch {
    version = "";
  }
  cache.set(urlPath, version);
  return version;
}

/** Проставить ?v= всем локальным /css/*.css и /js/*.js в HTML. */
function versionAssets(html) {
  return String(html).replace(/(href|src)="(\/(?:css|js)\/[^"?#]+\.(?:css|js))"/g, (match, attr, url) => {
    const v = versionOf(url);
    return v ? `${attr}="${url}?v=${v}"` : match;
  });
}

module.exports = { versionAssets, versionOf };
