/**
 * Middleware: только platform admin (таблица platform_admins).
 */

const { getSupabaseAdmin } = require("../lib/supabase-admin");

async function requirePlatformAdmin(req, res, next) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        ok: false,
        code: "UNAUTHORIZED",
        message: "Требуется авторизация.",
      });
    }

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("platform_admins")
      .select("role")
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (error) {
      console.error("[platform-admin] lookup failed");
      return res.status(500).json({
        ok: false,
        code: "INTERNAL_ERROR",
        message: "Не удалось проверить права администратора.",
      });
    }

    if (!data) {
      return res.status(403).json({
        ok: false,
        code: "FORBIDDEN",
        message: "Нет доступа.",
      });
    }

    req.platformAdmin = data;
    return next();
  } catch (error) {
    console.error("[platform-admin]", error.message);
    return res.status(500).json({
      ok: false,
      code: "INTERNAL_ERROR",
      message: "Ошибка проверки прав администратора.",
    });
  }
}

module.exports = { requirePlatformAdmin };
