-- =============================================================================
-- Bookly — Миграция 005: Bookings (Записи клиентов)
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001–004
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Таблица: bookings
-- -----------------------------------------------------------------------------
create table if not exists public.bookings (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  service_id       uuid not null references public.services(id),
  staff_id         uuid not null references public.staff(id),
  client_name      text not null check (char_length(trim(client_name)) >= 2),
  client_phone     text not null check (char_length(trim(client_phone)) >= 5),
  client_email     text,
  client_comment   text,
  booking_date     date not null,
  start_time       time not null,
  end_time         time not null,
  status           text not null default 'confirmed'
    check (status in ('pending', 'confirmed', 'completed', 'canceled', 'no_show')),
  source           text not null default 'manual'
    check (source in ('manual', 'public_booking')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (end_time > start_time)
);

-- -----------------------------------------------------------------------------
-- Индексы
-- -----------------------------------------------------------------------------
create index if not exists idx_bookings_organization on public.bookings(organization_id);
create index if not exists idx_bookings_org_date on public.bookings(organization_id, booking_date);
create index if not exists idx_bookings_staff_date on public.bookings(staff_id, booking_date);
create index if not exists idx_bookings_service on public.bookings(service_id);
create index if not exists idx_bookings_status on public.bookings(status);
create index if not exists idx_bookings_staff_date_time on public.bookings(staff_id, booking_date, start_time);

-- -----------------------------------------------------------------------------
-- Триггер updated_at
-- -----------------------------------------------------------------------------
drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Валидация бронирования (организация, услуга, график, пересечения, end_time)
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
  day_index integer;
  pg_dow integer;
begin
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

  if new.status in ('pending', 'confirmed') then
    if exists (
      select 1
      from public.bookings b
      where b.staff_id = new.staff_id
        and b.booking_date = new.booking_date
        and b.status in ('pending', 'confirmed')
        and b.id is distinct from new.id
        and b.start_time < new.end_time
        and b.end_time > new.start_time
    ) then
      raise exception 'BOOKING_TIME_CONFLICT';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_validate on public.bookings;
create trigger bookings_validate
  before insert or update on public.bookings
  for each row execute function public.validate_booking();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.bookings enable row level security;

drop policy if exists "bookings_select_member" on public.bookings;
create policy "bookings_select_member"
  on public.bookings
  for select
  to authenticated
  using (
    organization_id in (select public.get_my_organization_ids())
  );

drop policy if exists "bookings_insert_member" on public.bookings;
create policy "bookings_insert_member"
  on public.bookings
  for insert
  to authenticated
  with check (
    organization_id in (select public.get_my_organization_ids())
  );

drop policy if exists "bookings_update_member" on public.bookings;
create policy "bookings_update_member"
  on public.bookings
  for update
  to authenticated
  using (
    organization_id in (select public.get_my_organization_ids())
  )
  with check (
    organization_id in (select public.get_my_organization_ids())
  );

drop policy if exists "bookings_delete_member" on public.bookings;
create policy "bookings_delete_member"
  on public.bookings
  for delete
  to authenticated
  using (
    organization_id in (select public.get_my_organization_ids())
  );

-- -----------------------------------------------------------------------------
-- Права
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.bookings to authenticated;
