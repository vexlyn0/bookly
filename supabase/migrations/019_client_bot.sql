-- =============================================================================
-- Bookly — Миграция 019: Telegram-бот для клиентов
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001–018
--
--   1. telegram_clients — клиент поделился номером в боте: чат ↔ номер.
--      По номеру бот находит записи клиента во всех салонах («Мои записи»)
--      и сообщает об изменениях. Доступ только у сервера.
--   2. bookings.reminder_day_sent_at / reminder_2h_sent_at — напоминания
--      клиенту (Pro) отправлены; защищают от повторной отправки.
--   3. bookings.client_confirmed_at — клиент нажал «Приду» в напоминании.
-- =============================================================================

begin;

create table if not exists public.telegram_clients (
  chat_id          text primary key,
  phone_key        text not null check (phone_key ~ '^[0-9]{10,15}$'),
  telegram_user_id bigint,
  linked_at        timestamptz not null default now()
);

create index if not exists idx_telegram_clients_phone_key
  on public.telegram_clients (phone_key);

alter table public.telegram_clients enable row level security;
revoke all on public.telegram_clients from anon, authenticated;
grant all on public.telegram_clients to service_role;

alter table public.bookings
  add column if not exists reminder_day_sent_at timestamptz,
  add column if not exists reminder_2h_sent_at timestamptz,
  add column if not exists client_confirmed_at timestamptz;

create index if not exists idx_bookings_reminders
  on public.bookings (booking_date)
  where status in ('pending', 'confirmed')
    and (reminder_day_sent_at is null or reminder_2h_sent_at is null);

commit;
