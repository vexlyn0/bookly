-- =============================================================================
-- Bookly — Миграция 006: Booking Hardening
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001–005
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Расширение для EXCLUDE USING gist
-- -----------------------------------------------------------------------------
create extension if not exists btree_gist;

-- -----------------------------------------------------------------------------
-- Вспомогательная функция: локальное время записи в timezone организации
-- -----------------------------------------------------------------------------
create or replace function public.booking_local_timestamptz(
  p_organization_id uuid,
  p_booking_date date,
  p_booking_time time
)
returns timestamptz
language plpgsql
stable
as $$
declare
  tz text;
begin
  select coalesce(nullif(trim(timezone), ''), 'UTC')
  into tz
  from public.organizations
  where id = p_organization_id;

  if tz is null then
    tz := 'UTC';
  end if;

  begin
    return (p_booking_date + p_booking_time) at time zone tz;
  exception
    when invalid_parameter_value then
      return (p_booking_date + p_booking_time) at time zone 'UTC';
  end;
end;
$$;

-- -----------------------------------------------------------------------------
-- Проверка существующих пересечений перед EXCLUDE constraint
-- -----------------------------------------------------------------------------
do $$
declare
  conflict_count integer;
begin
  select count(*)::integer
  into conflict_count
  from public.bookings a
  join public.bookings b
    on a.staff_id = b.staff_id
   and a.booking_date = b.booking_date
   and a.id < b.id
   and a.status in ('pending', 'confirmed')
   and b.status in ('pending', 'confirmed')
   and a.start_time < b.end_time
   and a.end_time > b.start_time;

  if conflict_count > 0 then
    raise exception
      'Migration 006 aborted: found % overlapping active bookings. Resolve conflicts manually, then re-run this migration.',
      conflict_count;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- EXCLUDE: гарантия отсутствия пересечений (pending / confirmed)
-- Полуинтервал [) — запись ровно после окончания предыдущей разрешена
-- -----------------------------------------------------------------------------
alter table public.bookings
  drop constraint if exists bookings_no_active_overlap;

alter table public.bookings
  add constraint bookings_no_active_overlap
  exclude using gist (
    staff_id with =,
    booking_date with =,
    tsrange(
      (booking_date + start_time)::timestamp,
      (booking_date + end_time)::timestamp,
      '[)'
    ) with &&
  )
  where (status in ('pending', 'confirmed'));

-- -----------------------------------------------------------------------------
-- validate_booking v2: разделение логики расписания и смены статуса
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
  scheduling_changed boolean;
  needs_scheduling_validation boolean;
  reactivating boolean;
  starts_at timestamptz;
begin
  if tg_op = 'UPDATE' then
    scheduling_changed := (
      old.service_id is distinct from new.service_id
      or old.staff_id is distinct from new.staff_id
      or old.booking_date is distinct from new.booking_date
      or old.start_time is distinct from new.start_time
    );

    reactivating := (
      not scheduling_changed
      and new.status in ('pending', 'confirmed')
      and old.status not in ('pending', 'confirmed')
    );

    needs_scheduling_validation := scheduling_changed or reactivating;
  else
    needs_scheduling_validation := true;
  end if;

  if not needs_scheduling_validation then
    return new;
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

-- Пересоздать триггер (функция обновлена)
drop trigger if exists bookings_validate on public.bookings;
create trigger bookings_validate
  before insert or update on public.bookings
  for each row execute function public.validate_booking();

-- -----------------------------------------------------------------------------
-- Права на вспомогательную функцию
-- -----------------------------------------------------------------------------
grant execute on function public.booking_local_timestamptz(uuid, date, time) to authenticated;
