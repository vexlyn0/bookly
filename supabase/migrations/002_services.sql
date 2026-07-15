-- =============================================================================
-- Bookly — Миграция 002: Services (Услуги компании)
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001_organizations.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Таблица: services
-- -----------------------------------------------------------------------------
create table if not exists public.services (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null check (char_length(trim(name)) >= 2),
  description      text,
  price            integer not null default 0 check (price >= 0),
  duration_minutes integer not null check (duration_minutes >= 5 and duration_minutes <= 1440),
  category         text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Индексы
-- -----------------------------------------------------------------------------
create index if not exists idx_services_organization on public.services(organization_id);
create index if not exists idx_services_org_active on public.services(organization_id, is_active);
create index if not exists idx_services_org_name on public.services(organization_id, name);

-- -----------------------------------------------------------------------------
-- Триггер updated_at
-- -----------------------------------------------------------------------------
drop trigger if exists services_set_updated_at on public.services;
create trigger services_set_updated_at
  before update on public.services
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.services enable row level security;

drop policy if exists "services_select_member" on public.services;
create policy "services_select_member"
  on public.services
  for select
  to authenticated
  using (
    organization_id in (select public.get_my_organization_ids())
  );

drop policy if exists "services_insert_member" on public.services;
create policy "services_insert_member"
  on public.services
  for insert
  to authenticated
  with check (
    organization_id in (select public.get_my_organization_ids())
  );

drop policy if exists "services_update_member" on public.services;
create policy "services_update_member"
  on public.services
  for update
  to authenticated
  using (
    organization_id in (select public.get_my_organization_ids())
  )
  with check (
    organization_id in (select public.get_my_organization_ids())
  );

drop policy if exists "services_delete_member" on public.services;
create policy "services_delete_member"
  on public.services
  for delete
  to authenticated
  using (
    organization_id in (select public.get_my_organization_ids())
  );

-- -----------------------------------------------------------------------------
-- Права
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.services to authenticated;
