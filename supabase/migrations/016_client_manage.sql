-- =============================================================================
-- Bookly — Миграция 016: клиент сам отменяет / переносит запись
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001–015
--
--   1. bookings.manage_token — секретный код личной ссылки клиента на запись
--      (/b/<token>). 122 бита случайности, подобрать невозможно.
--   2. bookings.client_reschedule_count — сколько раз клиент сам переносил запись
--      (лимит проверяет сервер).
--   3. organizations.client_manage_cutoff_hours — не позже чем за сколько часов
--      до визита клиент может отменить / перенести запись онлайн.
--      null — только через салон. По умолчанию 2 часа.
-- =============================================================================

begin;

alter table public.bookings
  add column if not exists manage_token text;

alter table public.bookings
  alter column manage_token set default replace(gen_random_uuid()::text, '-', '');

update public.bookings
set manage_token = default
where manage_token is null;

alter table public.bookings
  alter column manage_token set not null;

create unique index if not exists bookings_manage_token_unique
  on public.bookings (manage_token);

alter table public.bookings
  add column if not exists client_reschedule_count integer not null default 0;

alter table public.organizations
  add column if not exists client_manage_cutoff_hours integer default 2;

alter table public.organizations
  drop constraint if exists organizations_client_manage_cutoff_hours_check;

alter table public.organizations
  add constraint organizations_client_manage_cutoff_hours_check
  check (client_manage_cutoff_hours is null or client_manage_cutoff_hours between 0 and 168);

commit;
