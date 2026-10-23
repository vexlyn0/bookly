# Telegram-уведомления Bookly

Сотрудник подключает бота из кабинета и получает сообщение о каждой новой
онлайн-записи. Если организация работает в режиме ручного подтверждения
(`booking_confirmation_mode = manual`), в сообщении есть кнопки
«Подтвердить» / «Отклонить».

## Настройка (один раз)

1. Создайте бота у [@BotFather](https://t.me/BotFather) → получите токен.
2. Сгенерируйте секрет webhook (16–256 символов `A-Za-z0-9_-`), например:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
3. Добавьте в Render → Environment (по одной переменной, см. RENDER_ENV_RECOVERY.md):
   ```
   TELEGRAM_BOT_TOKEN
   TELEGRAM_WEBHOOK_SECRET
   TELEGRAM_BOT_USERNAME   (необязательно — без @)
   ```
4. Примените миграции 012–014 (SQL Editor или `npm run db:staff-telegram`).
5. Зарегистрируйте webhook (локально, с теми же значениями в `.env`):
   `npm run telegram:setup -- https://<ваш-домен>`
   Проверка: `npm run telegram:setup -- --info`, `GET /api/health` →
   `telegram_webhook_configured: true`.

## Как это работает

- **Привязка:** кабинет → «Сотрудники» → «Подключить Telegram» открывает
  `t.me/<bot>?start=<telegram_link_token>`. Бот сохраняет `telegram_chat_id`
  и меняет токен (ссылка одноразовая). Работает только в личном чате.
- **Отвязка:** `/stop` в боте или «Отключить Telegram» в карточке сотрудника.
  Если сотрудник заблокировал бота, привязка снимается автоматически.
- **Кнопки:** меняют статус только из `pending` и только для записей
  сотрудника, привязанного к этому чату. «Отклонить» → `canceled`.
- **Безопасность:** `POST /api/telegram/webhook` принимает запросы только с
  заголовком `X-Telegram-Bot-Api-Secret-Token`; без `TELEGRAM_WEBHOOK_SECRET`
  endpoint отключён (404). Ошибки Telegram не влияют на создание записи.

## Тесты

`npm run test:telegram-unit` — без сети и без Supabase.
