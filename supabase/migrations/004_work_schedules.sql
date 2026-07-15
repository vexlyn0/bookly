-- =============================================================================
-- Bookly — Миграция 004: Work Schedules (Рабочие графики сотрудников)
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001_organizations.sql, 003_staff.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Таблица: staff_schedules
-- day_of_week: 0 = понедельник … 6 = воскресенье
-- -----------------------------------------------------------------------------
create table if not exists public.staff_schedules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  staff_id         uuid not null references public.staff(id) on delete cascade,
  day_of_week      integer not null check (day_of_week >= 0 and day_of_week <= 6),
  is_working       boolean not null default true,
  start_time       time,
  end_time         time,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (staff_id, day_of_week),
  check (
    (is_working = false)
    or (
      is_working = true
      and start_time is not null
      and end_time is not null
      and end_time > start_time
    )
  )
);

-- -----------------------------------------------------------------------------
-- Индексы
-- -----------------------------------------------------------------------------
create index if not exists idx_staff_schedules_organization on public.staff_schedules(organization_id);
create index if not exists idx_staff_schedules_staff on public.staff_schedules(staff_id);
create index if not exists idx_staff_schedules_staff_day on public.staff_schedules(staff_id, day_of_week);

-- -----------------------------------------------------------------------------
-- Триггер updated_at
-- -----------------------------------------------------------------------------
drop trigger if exists staff_schedules_set_updated_at on public.staff_schedules;
create trigger staff_schedules_set_updated_at
  before update on public.staff_schedules
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Сотрудник и график должны принадлежать одной организации
-- -----------------------------------------------------------------------------
create or replace function public.validate_staff_schedule_org()
returns trigger
language plpgsql
as $$
declare
  staff_org uuid;
begin
  select organization_id into staff_org
  from public.staff
  where id = new.staff_id;

  if staff_org is null then
    raise exception 'staff not found';
  end if;

  if new.organization_id <> staff_org then
    raise exception 'organization_id must match staff organization';
  end if;

  return new;
end;
$$;

drop trigger if exists staff_schedules_validate_org on public.staff_schedules;
create trigger staff_schedules_validate_org
  before insert or update on public.staff_schedules
  for each row execute function public.validate_staff_schedule_org();

-- -----------------------------------------------------------------------------
-- График по умолчанию для нового сотрудника
-- Пн–Пт 09:00–18:00, Сб 10:00–15:00, Вс выходной
-- -----------------------------------------------------------------------------
create or replace function public.create_default_staff_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.staff_schedules (
    organization_id,
    staff_id,
    day_of_week,
    is_working,
    start_time,
    end_time
  )
  values
    (new.organization_id, new.id, 0, true, '09:00', '18:00'),
    (new.organization_id, new.id, 1, true, '09:00', '18:00'),
    (new.organization_id, new.id, 2, true, '09:00', '18:00'),
    (new.organization_id, new.id, 3, true, '09:00', '18:00'),
    (new.organization_id, new.id, 4, true, '09:00', '18:00'),
    (new.organization_id, new.id, 5, true, '10:00', '15:00'),
    (new.organization_id, new.id, 6, false, null, null);

  return new;
end;
$$;

drop trigger if exists staff_create_default_schedule on public.staff;
create trigger staff_create_default_schedule
  after insert on public.staff
  for each row execute function public.create_default_staff_schedule();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.staff_schedules enable row level security;

drop policy if exists "staff_schedules_select_member" on public.staff_schedules;
create policy "staff_schedules_select_member"
  on public.staff_schedules
  for select
  to authenticated
  using (
    organization_id in (select public.get_my_organization_ids())
  );

drop policy if exists "staff_schedules_insert_member" on public.staff_schedules;
create policy "staff_schedules_insert_member"
  on public.staff_schedules
  for insert
  to authenticated
  with check (
    organization_id in (select public.get_my_organization_ids())
  );

drop policy if exists "staff_schedules_update_member" on public.staff_schedules;
create policy "staff_schedules_update_member"
  on public.staff_schedules
  for update
  to authenticated
  using (
    organization_id in (select public.get_my_organization_ids())
  )
  with check (
    organization_id in (select public.get_my_organization_ids())
  );

drop policy if exists "staff_schedules_delete_member" on public.staff_schedules;
create policy "staff_schedules_delete_member"
  on public.staff_schedules
  for delete
  to authenticated
  using (
    organization_id in (select public.get_my_organization_ids())
  );

-- -----------------------------------------------------------------------------
-- Права
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.staff_schedules to authenticated;
