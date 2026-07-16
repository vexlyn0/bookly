# Восстановление Environment Variables Bookly на Render

Этот документ **не содержит секретов**. Cursor не может восстановить значения,
если они удалены из Render и отсутствуют у вас локально/в менеджере паролей.

## Что случилось

Частая ошибка Render: при добавлении новых переменных (Kaspi) через массовую
замену или «Replace all» старые ключи (Supabase) могут быть удалены или
перезаписаны. Без `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
ломаются регистрация, вход и данные `/app`, даже если Kaspi-ключи заданы.

Kaspi env **не должны** влиять на Supabase. В текущем коде отсутствие Kaspi
лишь отключает реквизиты оплаты (`kaspi.configured = false`).

## Перед правками

1. Откройте Render → ваш сервис Bookly → **Environment**.
2. **Не** используйте массовую замену всего списка переменных.
3. Добавляйте/правьте **по одной** паре Key / Value.
4. Сохраните значения из локального `.env` (или менеджера секретов) у себя —
   не вставляйте их в чат и не коммитьте в Git.

## Обязательные ключи (REQUIRED)

Добавьте/проверьте наличие (значения — из вашего рабочего источника):

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Допустимые алиасы (если уже используете):

- вместо `SUPABASE_ANON_KEY` → `SUPABASE_PUBLISHABLE_KEY`
- вместо `SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SECRET_KEY`

Канонические имена предпочтительнее.

`PORT` задаёт Render автоматически — обычно **не** нужно добавлять вручную.

`NODE_ENV=production` — рекомендуется.

## Необязательные ключи (OPTIONAL) — Kaspi

Все три должны быть заданы вместе, иначе оплата считается ненастроенной:

```
KASPI_PAYMENT_RECIPIENT
KASPI_PAYMENT_PHONE
KASPI_PAYMENT_INSTRUCTIONS
```

## Не добавлять в production

```
TEST_EMAIL
TEST_PASSWORD
TEST_EMAIL_B
TEST_PASSWORD_B
DATABASE_URL
BOOKLY_DISABLE_BOOKING_RATE_LIMIT
BOOKLY_DISABLE_BILLING_RATE_LIMIT
```

## Шаги восстановления

1. Render → Bookly → **Environment**.
2. Убедитесь, что три REQUIRED Supabase-ключа присутствуют.
3. Если ключ отсутствует — **Add Environment Variable** → вставьте Key и Value.
4. Добавьте три Kaspi-ключа только если реквизиты готовы (все сразу).
5. Нажмите **Save and deploy** (нужен новый deploy после смены env).
6. Откройте **Logs** — не должно быть:
   - `Missing required variable: SUPABASE_...`
7. Проверьте:
   - `GET /api/health` → `supabase_configured: true`
   - `kaspi_configured: true` только если все три Kaspi заданы
   - `/register`, `/login`, `/app`, `/admin`
8. Локально (без вывода секретов):
   - `npm run env:check`
   - `npm run env:render-template` — шаблон ключей без значений

## Если секрет утерян

- Anon/publishable и service role можно заново скопировать из
  Supabase Dashboard → Project Settings → API.
- `SUPABASE_URL` — Project URL (без `/rest/v1/`).
- Kaspi-реквизиты берутся из ваших бизнес-данных.

Cursor **не** может прочитать удалённые Render secrets и **не** должен
получать значения ключей в чат.

## После восстановления

1. Дождитесь успешного deploy.
2. Hard refresh браузера на `/register` и `/app`.
3. Если `kaspi_configured: false` — UI покажет «Реквизиты оплаты пока не настроены»,
   регистрация и `/admin` при этом должны работать.
