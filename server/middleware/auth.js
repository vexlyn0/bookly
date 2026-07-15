/**
 * Middleware проверки JWT Supabase Auth
 * Используется для защищённых API-маршрутов (будущие модули)
 */

const { createClient } = require("@supabase/supabase-js");
const config = require("../config");

let supabaseAuth = null;

if (config.supabase.isConfigured) {
  supabaseAuth = createClient(config.supabase.url, config.supabase.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function requireAuth(req, res, next) {
  try {
    if (!supabaseAuth) {
      return res.status(503).json({
        ok: false,
        message: "Supabase Auth не настроен.",
      });
    }

    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (!token) {
      return res.status(401).json({
        ok: false,
        message: "Требуется авторизация.",
      });
    }

    const { data, error } = await supabaseAuth.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({
        ok: false,
        message: "Сессия недействительна или истекла.",
      });
    }

    req.user = data.user;
    return next();
  } catch (error) {
    console.error(`[auth] ${error.message}`);
    return res.status(401).json({
      ok: false,
      message: "Ошибка проверки авторизации.",
    });
  }
}

module.exports = { requireAuth };
