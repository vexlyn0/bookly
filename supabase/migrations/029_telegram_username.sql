-- =============================================================================
-- Jazyl — Миграция 029: кто подключил Telegram
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001–028
--
-- Бот запоминает @ник (или имя) того, кто нажал Start по ссылке, — в кабинете
-- видно, к чьему Telegram привязан мастер и владелец. Если ссылку открыл
-- не тот человек, владелец это сразу заметит.
--
--   1. staff.telegram_username, organizations.owner_telegram_username.
--   2. Изменение только Telegram-полей мастера по-прежнему не проверяет подписку
--      (как в 014): добавляем telegram_username в исключения триггера.
-- Существующие данные не меняются.
-- =============================================================================

begin;

alter table public.staff
  add column if not exists telegram_username text;

alter table public.organizations
  add column if not exists owner_telegram_username text;

drop trigger if exists staff_enforce_subscription_update on public.staff;

create trigger staff_enforce_subscription_update
  before update on public.staff
  for each row
  when (
    (to_jsonb(old) - array['telegram_chat_id', 'telegram_link_token', 'telegram_username', 'updated_at'])
      is distinct from
    (to_jsonb(new) - array['telegram_chat_id', 'telegram_link_token', 'telegram_username', 'updated_at'])
  )
  execute function public.enforce_subscription_access();

commit;
