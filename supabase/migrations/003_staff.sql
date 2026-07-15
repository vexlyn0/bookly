-- =============================================================================
-- Bookly — Миграция 003: Staff (Сотрудники компании)
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001_organizations.sql, 002_services.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Таблица: staff
-- -----------------------------------------------------------------------------
create table if not exists public.staff (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null check (char_length(trim(name)) >= 2),
  position         text,
  phone            text,
  email            text check (
    email is null
    or (
      char_length(trim(email)) > 0
      and email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'
    )
  ),
  description      text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Таблица: staff_services (связь сотрудник ↔ услуга)
-- -----------------------------------------------------------------------------
create table if not exists public.staff_services (
  staff_id         uuid not null references public.staff(id) on delete cascade,
  service_id       uuid not null references public.services(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (staff_id, service_id)
);

-- -----------------------------------------------------------------------------
-- Индексы
-- -----------------------------------------------------------------------------
create index if not exists idx_staff_organization on public.staff(organization_id);
create index if not exists idx_staff_org_active on public.staff(organization_id, is_active);
create index if not exists idx_staff_org_name on public.staff(organization_id, name);

create index if not exists idx_staff_services_staff on public.staff_services(staff_id);
create index if not exists idx_staff_services_service on public.staff_services(service_id);
create index if not exists idx_staff_services_org on public.staff_services(organization_id);

-- -----------------------------------------------------------------------------
-- Триггер updated_at (staff)
-- -----------------------------------------------------------------------------
drop trigger if exists staff_set_updated_at on public.staff;
create trigger staff_set_updated_at
  before update on public.staff
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Защита: сотрудник и услуга должны принадлежать одной организации
-- -----------------------------------------------------------------------------
create or replace function public.validate_staff_service_org()
returns trigger
language plpgsql
as $$
declare
  staff_org uuid;
  service_org uuid;
begin
  select organization_id into staff_org
  from public.staff
  where id = new.staff_id;

  if staff_org is null then
    raise exception 'staff not found';
  end if;

  select organization_id into service_org
  from public.services
  where id = new.service_id;

  if service_org is null then
    raise exception 'service not found';
  end if;

  if staff_org <> service_org then
    raise exception 'staff and service must belong to the same organization';
  end if;

  if new.organization_id <> staff_org then
    raise exception 'organization_id must match staff organization';
  end if;

  return new;
end;
$$;

drop trigger if exists staff_services_validate_org on public.staff_services;
create trigger staff_services_validate_org
  before insert or update on public.staff_services
  for each row execute function public.validate_staff_service_org();

-- -----------------------------------------------------------------------------
-- Row Level Security: staff
-- -----------------------------------------------------------------------------
alter table public.staff enable row level security;

drop policy if exists "staff_select_member" on public.staff;
create policy "staff_select_member"
  on public.staff
  for select
  to authenticated
  using (
    organization_id in (select public.get_my_organization_ids())
  );

drop policy if exists "staff_insert_member" on public.staff;
create policy "staff_insert_member"
  on public.staff
  for insert
  to authenticated
  with check (
    organization_id in (select public.get_my_organization_ids())
  );

drop policy if exists "staff_update_member" on public.staff;
create policy "staff_update_member"
  on public.staff
  for update
  to authenticated
  using (
    organization_id in (select public.get_my_organization_ids())
  )
  with check (
    organization_id in (select public.get_my_organization_ids())
  );

drop policy if exists "staff_delete_member" on public.staff;
create policy "staff_delete_member"
  on public.staff
  for delete
  to authenticated
  using (
    organization_id in (select public.get_my_organization_ids())
  );

-- -----------------------------------------------------------------------------
-- Row Level Security: staff_services
-- -----------------------------------------------------------------------------
alter table public.staff_services enable row level security;

drop policy if exists "staff_services_select_member" on public.staff_services;
create policy "staff_services_select_member"
  on public.staff_services
  for select
  to authenticated
  using (
    organization_id in (select public.get_my_organization_ids())
  );

drop policy if exists "staff_services_insert_member" on public.staff_services;
create policy "staff_services_insert_member"
  on public.staff_services
  for insert
  to authenticated
  with check (
    organization_id in (select public.get_my_organization_ids())
  );

drop policy if exists "staff_services_update_member" on public.staff_services;
create policy "staff_services_update_member"
  on public.staff_services
  for update
  to authenticated
  using (
    organization_id in (select public.get_my_organization_ids())
  )
  with check (
    organization_id in (select public.get_my_organization_ids())
  );

drop policy if exists "staff_services_delete_member" on public.staff_services;
create policy "staff_services_delete_member"
  on public.staff_services
  for delete
  to authenticated
  using (
    organization_id in (select public.get_my_organization_ids())
  );

-- -----------------------------------------------------------------------------
-- Права
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.staff to authenticated;
grant select, insert, update, delete on public.staff_services to authenticated;
