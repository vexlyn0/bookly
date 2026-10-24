-- =============================================================================
-- Bookly — Миграция 021: цена в записи и подтверждение визита мастером
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001–020
--
--   1. bookings.price — цена услуги на момент записи (смена прайса не меняет
--      прошлые записи). Заполняется автоматически; при смене услуги — заново.
--   2. bookings.paid_amount — сколько клиент реально заплатил (мастер отмечает
--      в Telegram «Другая сумма»). Пусто — значит по цене записи.
--   3. bookings.completed_at — когда визит отмечен завершённым.
--   4. bookings.visit_check_sent_at — мастеру отправлен вопрос «Визит завершён?».
--   5. staff.pending_amount_booking_id — мастер нажал «Другая сумма» и бот
--      ждёт от него число.
-- =============================================================================

begin;

alter table public.bookings
  add column if not exists price integer,
  add column if not exists paid_amount integer,
  add column if not exists completed_at timestamptz,
  add column if not exists visit_check_sent_at timestamptz;

alter table public.bookings drop constraint if exists bookings_price_check;
alter table public.bookings
  add constraint bookings_price_check check (price is null or price >= 0);

alter table public.bookings drop constraint if exists bookings_paid_amount_check;
alter table public.bookings
  add constraint bookings_paid_amount_check check (paid_amount is null or paid_amount between 0 and 100000000);

-- Старые записи: цена по текущему прайсу (другой у нас нет)
update public.bookings b
set price = s.price
from public.services s
where s.id = b.service_id
  and b.price is null;

-- Прошлые завершённые: время завершения неизвестно — берём время записи
update public.bookings
set completed_at = coalesce(updated_at, created_at)
where status = 'completed'
  and completed_at is null;

-- Прошедшие записи не тревожим вопросом «Визит завершён?» задним числом
update public.bookings
set visit_check_sent_at = now()
where visit_check_sent_at is null
  and booking_date < current_date;

create or replace function public.bookings_set_price()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.price is null then
      select s.price into new.price from public.services s where s.id = new.service_id;
    end if;
  elsif new.service_id is distinct from old.service_id
    and new.price is not distinct from old.price then
    select s.price into new.price from public.services s where s.id = new.service_id;
  end if;

  if new.status = 'completed'
    and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'completed' then
    new.completed_at := null;
    new.paid_amount := null;
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_set_price on public.bookings;
create trigger bookings_set_price
  before insert or update on public.bookings
  for each row execute function public.bookings_set_price();

alter table public.staff
  add column if not exists pending_amount_booking_id uuid
  references public.bookings(id) on delete set null;

commit;
