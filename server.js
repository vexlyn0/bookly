/**
 * Bookly — точка входа сервера
 */

const config = require("./server/config");

config.assertRequiredEnvOrExit();

const app = require("./server/app");

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`Bookly running at http://localhost:${config.port}`);
  console.log(`Landing:    http://localhost:${config.port}/`);
  console.log(`Login:      http://localhost:${config.port}/login`);
  console.log(`Register:   http://localhost:${config.port}/register`);
  console.log(`Onboarding: http://localhost:${config.port}/onboarding`);
  console.log(`Dashboard:  http://localhost:${config.port}/app`);
  console.log(`Admin:      http://localhost:${config.port}/admin`);
  console.log(`Booking:    http://localhost:${config.port}/book/:slug`);
  console.log(`Supabase:   ${config.supabase.isConfigured ? "configured" : "not configured"}`);
  console.log(`Kaspi:      ${config.kaspi.isConfigured ? "configured" : "not configured"}`);
  console.log(`Запуск: npm run dev`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`[error] Порт ${config.port} занят.`);
    process.exit(1);
  }

  console.error(`[error] ${error.message}`);
  process.exit(1);
});
