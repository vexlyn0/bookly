-- =============================================================================
-- Jazyl — Миграция 026: Telegram владельца салона
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001–025
--
-- Владелец подключает свой Telegram (раздел «Уведомления» → ссылка t.me/<бот>?start=o_<токен>):
--   - оплаты Kaspi «Проверьте Kaspi» с кнопками «Деньги пришли» / «Не пришли» — всегда;
--   - копии новых онлайн-записей по всем мастерам — owner_notify_bookings;
--   - отмены и переносы, сделанные клиентом, — owner_notify_changes.
-- =============================================================================

begin;

alter table public.organizations
  add column if not exists owner_telegram_chat_id text,
  add column if not exists owner_telegram_link_token text not null default replace(gen_random_uuid()::text, '-', ''),
  add column if not exists owner_notify_bookings boolean not null default true,
  add column if not exists owner_notify_changes boolean not null default true;

update public.organizations
set owner_telegram_link_token = replace(gen_random_uuid()::text, '-', '')
where owner_telegram_link_token is null or owner_telegram_link_token = '';

create unique index if not exists organizations_owner_telegram_link_token_unique
  on public.organizations(owner_telegram_link_token);

create index if not exists idx_organizations_owner_telegram_chat_id
  on public.organizations(owner_telegram_chat_id)
  where owner_telegram_chat_id is not null;

commit;
