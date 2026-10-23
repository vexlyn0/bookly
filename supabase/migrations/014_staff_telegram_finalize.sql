-- =============================================================================
-- Bookly — Миграция 014: Staff Telegram (доводка)
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001–013
--
-- 1. Изменение только Telegram-полей сотрудника не проверяет подписку:
--    отвязать бота должно быть можно и при неактивной подписке.
-- 2. Токен привязки генерируется автоматически для новых сотрудников,
--    у существующих — заполняется, токен уникален.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- enforce_subscription_access для staff: UPDATE только Telegram-полей пропускаем
-- -----------------------------------------------------------------------------
drop trigger if exists staff_enforce_subscription on public.staff;
drop trigger if exists staff_enforce_subscription_update on public.staff;

create trigger staff_enforce_subscription
  before insert or delete on public.staff
  for each row execute function public.enforce_subscription_access();

create trigger staff_enforce_subscription_update
  before update on public.staff
  for each row
  when (
    (to_jsonb(old) - array['telegram_chat_id', 'telegram_link_token', 'updated_at'])
      is distinct from
    (to_jsonb(new) - array['telegram_chat_id', 'telegram_link_token', 'updated_at'])
  )
  execute function public.enforce_subscription_access();

-- -----------------------------------------------------------------------------
-- Токен привязки: default, backfill, уникальность
-- -----------------------------------------------------------------------------
alter table public.staff
  alter column telegram_link_token set default replace(gen_random_uuid()::text, '-', '');

update public.staff
set telegram_link_token = replace(gen_random_uuid()::text, '-', '')
where telegram_link_token is null or telegram_link_token = '';

alter table public.staff
  alter column telegram_link_token set not null;

drop index if exists public.idx_staff_telegram_token;
create unique index if not exists staff_telegram_link_token_unique
  on public.staff(telegram_link_token);

commit;
