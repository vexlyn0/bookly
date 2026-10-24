-- =============================================================================
-- Bookly — Миграция 023: перерывы, выходные, отпуска, блоки времени
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001–022
--
--   1. staff_schedules.break_start / break_end — перерыв (обед) в рабочем дне.
--   2. staff_time_off — исключения графика мастера:
--        off   — выходной / отпуск / больничный на дни date_from..date_to;
--        block — занятое время в конкретный день (start_time..end_time);
--        hours — другие часы работы в конкретный день (вместо обычного графика).
--   3. validate_booking(): учитывает «другие часы» и выходные.
--   4. bookings_check_time_off(): онлайн-запись не попадает на перерыв и блоки
--      (запись из кабинета на перерыв владелец сделать может — его решение).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Перерыв в графике
-- -----------------------------------------------------------------------------
alter table public.staff_schedules
  add column if not exists break_start time,
  add column if not exists break_end time;

alter table public.staff_schedules drop constraint if exists staff_schedules_break_check;
alter table public.staff_schedules
  add constraint staff_schedules_break_check check (
    (break_start is null and break_end is null)
    or (break_start is not null and break_end is not null and break_end > break_start)
  );

-- -----------------------------------------------------------------------------
-- 2. Исключения графика
-- -----------------------------------------------------------------------------
create table if not exists public.staff_time_off (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  staff_id        uuid not null references public.staff(id) on delete cascade,
  kind            text not null check (kind in ('off', 'block', 'hours')),
  date_from       date not null,
  date_to         date not null,
  start_time      time,
  end_time        time,
  note            text check (note is null or char_length(note) <= 200),
  created_at      timestamptz not null default now(),
  check (date_to >= date_from),
  check (date_to - date_from <= 366),
  check (
    (kind = 'off' and start_time is null and end_time is null)
    or (kind in ('block', 'hours') and start_time is not null and end_time is not null and end_time > start_time)
  )
);

create index if not exists idx_staff_time_off_staff_dates
  on public.staff_time_off (staff_id, date_from, date_to);
create index if not exists idx_staff_time_off_org
  on public.staff_time_off (organization_id);

-- Мастер должен быть из той же организации
create or replace function public.staff_time_off_check_org()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.staff s
    where s.id = new.staff_id and s.organization_id = new.organization_id
  ) then
    raise exception 'TIME_OFF_ORG_MISMATCH';
  end if;
  return new;
end;
$$;

drop trigger if exists staff_time_off_check_org on public.staff_time_off;
create trigger staff_time_off_check_org
  before insert or update on public.staff_time_off
  for each row execute function public.staff_time_off_check_org();

drop trigger if exists staff_time_off_enforce_subscription on public.staff_time_off;
create trigger staff_time_off_enforce_subscription
  before insert or update or delete on public.staff_time_off
  for each row execute function public.enforce_subscription_access();

alter table public.staff_time_off enable row level security;

drop policy if exists "staff_time_off_select_member" on public.staff_time_off;
create policy "staff_time_off_select_member" on public.staff_time_off
  for select to authenticated
  using (organization_id in (select public.get_my_organization_ids()));

drop policy if exists "staff_time_off_insert_member" on public.staff_time_off;
create policy "staff_time_off_insert_member" on public.staff_time_off
  for insert to authenticated
  with check (organization_id in (select public.get_my_organization_ids()));

drop policy if exists "staff_time_off_update_member" on public.staff_time_off;
create policy "staff_time_off_update_member" on public.staff_time_off
  for update to authenticated
  using (organization_id in (select public.get_my_organization_ids()))
  with check (organization_id in (select public.get_my_organization_ids()));

drop policy if exists "staff_time_off_delete_member" on public.staff_time_off;
create policy "staff_time_off_delete_member" on public.staff_time_off
  for delete to authenticated
  using (organization_id in (select public.get_my_organization_ids()));

grant select, insert, update, delete on public.staff_time_off to authenticated;
grant all on public.staff_time_off to service_role;

-- -----------------------------------------------------------------------------
-- 3. validate_booking: «другие часы» и выходные
-- -----------------------------------------------------------------------------
create or replace function public.validate_booking()
returns trigger
language plpgsql
as $$
declare
  service_org uuid;
  staff_org uuid;
  service_duration integer;
  service_active boolean;
  staff_active boolean;
  schedule_row public.staff_schedules%rowtype;
  hours_row public.staff_time_off%rowtype;
  day_index integer;
  pg_dow integer;
  reschedule_changed boolean;
  starts_at timestamptz;
begin
  if tg_op = 'UPDATE' then
    reschedule_changed := (
      old.organization_id is distinct from new.organization_id
      or old.service_id is distinct from new.service_id
      or old.staff_id is distinct from new.staff_id
      or old.booking_date is distinct from new.booking_date
      or old.start_time is distinct from new.start_time
    );

    -- Только status или данные клиента: без проверки активности и графика.
    if not reschedule_changed then
      return new;
    end if;
  end if;

  select organization_id, duration_minutes, is_active
  into service_org, service_duration, service_active
  from public.services
  where id = new.service_id;

  if service_org is null then
    raise exception 'BOOKING_SERVICE_NOT_FOUND';
  end if;

  select organization_id, is_active
  into staff_org, staff_active
  from public.staff
  where id = new.staff_id;

  if staff_org is null then
    raise exception 'BOOKING_STAFF_NOT_FOUND';
  end if;

  if new.organization_id <> service_org or new.organization_id <> staff_org then
    raise exception 'BOOKING_ORG_MISMATCH';
  end if;

  if service_active is not true then
    raise exception 'BOOKING_SERVICE_INACTIVE';
  end if;

  if staff_active is not true then
    raise exception 'BOOKING_STAFF_INACTIVE';
  end if;

  if not exists (
    select 1
    from public.staff_services ss
    where ss.staff_id = new.staff_id
      and ss.service_id = new.service_id
      and ss.organization_id = new.organization_id
  ) then
    raise exception 'BOOKING_STAFF_SERVICE_MISMATCH';
  end if;

  if service_duration is null or service_duration < 1 then
    raise exception 'BOOKING_INVALID_DURATION';
  end if;

  new.end_time := new.start_time + (service_duration * interval '1 minute');

  if new.end_time <= new.start_time then
    raise exception 'BOOKING_INVALID_DURATION';
  end if;

  starts_at := public.booking_local_timestamptz(
    new.organization_id,
    new.booking_date,
    new.start_time
  );

  if starts_at < now() then
    raise exception 'BOOKING_IN_PAST';
  end if;

  -- Выходной / отпуск
  if exists (
    select 1 from public.staff_time_off t
    where t.staff_id = new.staff_id
      and t.kind = 'off'
      and new.booking_date between t.date_from and t.date_to
  ) then
    raise exception 'BOOKING_STAFF_DAY_OFF';
  end if;

  -- «Другие часы» в этот день заменяют обычный график
  select * into hours_row
  from public.staff_time_off t
  where t.staff_id = new.staff_id
    and t.kind = 'hours'
    and new.booking_date between t.date_from and t.date_to
  order by t.created_at desc
  limit 1;

  if found then
    if new.start_time < hours_row.start_time or new.end_time > hours_row.end_time then
      raise exception 'BOOKING_OUTSIDE_SCHEDULE';
    end if;
    return new;
  end if;

  pg_dow := extract(dow from new.booking_date)::integer;
  day_index := (pg_dow + 6) % 7;

  select *
  into schedule_row
  from public.staff_schedules
  where staff_id = new.staff_id
    and day_of_week = day_index;

  if not found or schedule_row.is_working is not true then
    raise exception 'BOOKING_STAFF_DAY_OFF';
  end if;

  if new.start_time < schedule_row.start_time
    or new.end_time > schedule_row.end_time then
    raise exception 'BOOKING_OUTSIDE_SCHEDULE';
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Онлайн-запись не попадает на перерыв и блоки времени
-- Срабатывает после validate_booking (имя триггера — по алфавиту позже),
-- когда end_time уже рассчитан.
-- -----------------------------------------------------------------------------
create or replace function public.bookings_check_time_off()
returns trigger
language plpgsql
as $$
declare
  schedule_row public.staff_schedules%rowtype;
begin
  if new.source <> 'public_booking' or new.status not in ('pending', 'confirmed') then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.staff_id is not distinct from new.staff_id
    and old.booking_date is not distinct from new.booking_date
    and old.start_time is not distinct from new.start_time
    and old.end_time is not distinct from new.end_time then
    return new;
  end if;

  if exists (
    select 1 from public.staff_time_off t
    where t.staff_id = new.staff_id
      and t.kind = 'block'
      and new.booking_date between t.date_from and t.date_to
      and new.start_time < t.end_time
      and new.end_time > t.start_time
  ) then
    raise exception 'BOOKING_OUTSIDE_SCHEDULE';
  end if;

  -- Перерыв из графика (если в этот день нет «других часов»)
  if not exists (
    select 1 from public.staff_time_off t
    where t.staff_id = new.staff_id
      and t.kind = 'hours'
      and new.booking_date between t.date_from and t.date_to
  ) then
    select * into schedule_row
    from public.staff_schedules
    where staff_id = new.staff_id
      and day_of_week = (extract(dow from new.booking_date)::integer + 6) % 7;

    if found
      and schedule_row.break_start is not null
      and new.start_time < schedule_row.break_end
      and new.end_time > schedule_row.break_start then
      raise exception 'BOOKING_OUTSIDE_SCHEDULE';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_zz_check_time_off on public.bookings;
create trigger bookings_zz_check_time_off
  before insert or update on public.bookings
  for each row execute function public.bookings_check_time_off();

commit;
