-- =============================================================================
-- Jazyl — Миграция 028: Telegram администратора платформы
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001–027
--
-- Администратор подключает свой Telegram в админке (/admin → «Оплаты»):
-- ссылка t.me/<бот>?start=pa_<токен>. Новые заявки на оплату Pro приходят ему
-- с кнопками «Оплата пришла» / «Отклонить» — подтверждение идёт через ту же
-- функцию admin_approve_manual_payment, что и в админке.
-- Существующие данные не меняются: только две новые колонки.
-- =============================================================================

begin;

alter table public.platform_admins
  add column if not exists telegram_chat_id text,
  add column if not exists telegram_link_token text not null default replace(gen_random_uuid()::text, '-', '');

create unique index if not exists platform_admins_telegram_link_token_unique
  on public.platform_admins(telegram_link_token);

create index if not exists idx_platform_admins_telegram_chat_id
  on public.platform_admins(telegram_chat_id)
  where telegram_chat_id is not null;

commit;
