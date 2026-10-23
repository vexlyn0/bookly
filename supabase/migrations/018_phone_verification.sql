-- =============================================================================
-- Bookly — Миграция 018: подтверждение номера клиента через Telegram-бота
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001–017
--
--   1. organizations.require_phone_verification — владелец включает проверку
--      номера при онлайн-записи (по умолчанию выключено).
--   2. phone_verifications — заявки на подтверждение: клиент открывает бота
--      по ссылке с токеном и делится контактом; Telegram передаёт номер,
--      привязанный к аккаунту. Доступ только у сервера (service role).
--   3. bookings.client_telegram_chat_id — чат клиента с ботом (подтверждение
--      записи сейчас, напоминания — позже).
-- =============================================================================

begin;

alter table public.organizations
  add column if not exists require_phone_verification boolean not null default false;

create table if not exists public.phone_verifications (
  id              uuid primary key default gen_random_uuid(),
  token           text not null unique check (token ~ '^[0-9a-f]{32}$'),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  phone_key       text not null,
  chat_id         text,
  status          text not null default 'pending'
    check (status in ('pending', 'verified', 'mismatch', 'used')),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '15 minutes',
  verified_at     timestamptz
);

create index if not exists idx_phone_verifications_chat
  on public.phone_verifications (chat_id, created_at desc);

-- RLS без политик: anon/authenticated доступа нет, работает только сервер.
alter table public.phone_verifications enable row level security;
revoke all on public.phone_verifications from anon, authenticated;
grant all on public.phone_verifications to service_role;

alter table public.bookings
  add column if not exists client_telegram_chat_id text;

commit;
