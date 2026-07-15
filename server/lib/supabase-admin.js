/**
 * Supabase-клиент с service role для серверных операций
 */

const { createClient } = require("@supabase/supabase-js");
const config = require("../config");

let adminClient = null;

function getSupabaseAdmin() {
  if (!config.supabase.isConfigured) {
    throw new Error("Supabase is not configured");
  }

  if (!config.supabase.serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for public booking API");
  }

  if (!adminClient) {
    adminClient = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return adminClient;
}

module.exports = { getSupabaseAdmin };
