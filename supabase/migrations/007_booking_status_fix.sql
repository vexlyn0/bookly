-- =============================================================================
-- Bookly — Миграция 007: Booking Status Fix
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001–006
-- =============================================================================

-- -----------------------------------------------------------------------------
-- validate_booking v3: статус и данные клиента без проверки активности/графика
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
  starts_at timestamptz;
begin
  if tg_op = 'UPDATE' then
    scheduling_changed := (
      old.organization_id is distinct from new.organization_id
      or old.service_id is distinct from new.service_id
      or old.staff_id is distinct from new.staff_id
      or old.booking_date is distinct from new.booking_date
      or old.start_time is distinct from new.start_time
    );

    -- Только статус или данные клиента: не трогаем end_time, не проверяем активность.
    -- Конфликты pending/confirmed контролирует EXCLUDE constraint bookings_no_active_overlap.
    if not scheduling_changed then
      return new;
    end if;
  end if;

  -- INSERT новой записи или UPDATE с изменением расписания — полная валидация.

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

drop trigger if exists bookings_validate on public.bookings;
create trigger bookings_validate
  before insert or update on public.bookings
  for each row execute function public.validate_booking();
