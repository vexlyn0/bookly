-- =============================================================================
-- Jazyl — Миграция 025: предоплата через Kaspi (ручное подтверждение)
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001–024
--
-- Как работает:
--   клиент записывается → видит реквизиты Kaspi салона → переводит → «Я оплатил»
--   → мастер в Telegram (или владелец в кабинете) жмёт «Деньги пришли» / «Не пришли».
--   Не нажал «Я оплатил» за prepay_hold_minutes — запись отменяется сама.
--
--   1. organizations: kaspi_phone, kaspi_name, kaspi_link, prepay_hold_minutes, prepay_note.
--   2. services: prepay_type (none | fixed | percent), prepay_value.
--   3. bookings: prepay_amount, prepay_status, prepay_deadline, prepay_claimed_at, prepay_confirmed_at.
--      prepay_status: awaiting — ждём перевод; claimed — клиент нажал «Я оплатил»;
--                     paid — салон подтвердил; rejected — «Не пришли»; expired — не оплатил вовремя.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Реквизиты Kaspi салона
-- -----------------------------------------------------------------------------
alter table public.organizations
  add column if not exists kaspi_phone text,
  add column if not exists kaspi_name text,
  add column if not exists kaspi_link text,
  add column if not exists prepay_hold_minutes integer not null default 30,
  add column if not exists prepay_note text;

alter table public.organizations drop constraint if exists organizations_prepay_check;
alter table public.organizations
  add constraint organizations_prepay_check check (
    (kaspi_phone is null or char_length(kaspi_phone) <= 30)
    and (kaspi_name is null or char_length(kaspi_name) <= 60)
    and (kaspi_link is null or (char_length(kaspi_link) <= 500 and kaspi_link ~ '^https://'))
    and prepay_hold_minutes in (15, 30, 60)
    and (prepay_note is null or char_length(prepay_note) <= 300)
  );

-- -----------------------------------------------------------------------------
-- 2. Предоплата у услуги
-- -----------------------------------------------------------------------------
alter table public.services
  add column if not exists prepay_type text not null default 'none',
  add column if not exists prepay_value integer;

alter table public.services drop constraint if exists services_prepay_check;
alter table public.services
  add constraint services_prepay_check check (
    (prepay_type = 'none')
    or (prepay_type = 'fixed' and prepay_value is not null and prepay_value between 100 and 1000000)
    or (prepay_type = 'percent' and prepay_value is not null and prepay_value between 1 and 100)
  );

-- -----------------------------------------------------------------------------
-- 3. Предоплата у записи
-- -----------------------------------------------------------------------------
alter table public.bookings
  add column if not exists prepay_amount integer,
  add column if not exists prepay_status text,
  add column if not exists prepay_deadline timestamptz,
  add column if not exists prepay_claimed_at timestamptz,
  add column if not exists prepay_confirmed_at timestamptz;

alter table public.bookings drop constraint if exists bookings_prepay_check;
alter table public.bookings
  add constraint bookings_prepay_check check (
    (prepay_status is null and prepay_amount is null)
    or (
      prepay_status in ('awaiting', 'claimed', 'paid', 'rejected', 'expired')
      and prepay_amount is not null and prepay_amount > 0
    )
  );

-- Для автоотмены неоплаченных: ищем по сроку только среди ждущих перевода
create index if not exists idx_bookings_prepay_awaiting
  on public.bookings (prepay_deadline)
  where prepay_status = 'awaiting';

notify pgrst, 'reload schema';

commit;
