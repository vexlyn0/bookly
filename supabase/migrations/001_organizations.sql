-- =============================================================================
-- Bookly — Миграция 001: Organizations (Workspaces)
-- Выполните в Supabase Dashboard → SQL Editor
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Расширения
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Типы
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.organization_business_type as enum (
    'coffee_shop',
    'restaurant',
    'barbershop',
    'beauty_salon',
    'auto_service',
    'dental',
    'other'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.organization_role as enum (
    'owner',
    'admin',
    'staff'
  );
exception
  when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- Таблица: organizations
-- -----------------------------------------------------------------------------
create table if not exists public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(trim(name)) >= 2),
  business_type public.organization_business_type not null default 'other',
  timezone      text not null default 'Europe/Moscow',
  slug          text not null unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_organizations_slug on public.organizations(slug);

-- -----------------------------------------------------------------------------
-- Таблица: organization_members
-- -----------------------------------------------------------------------------
create table if not exists public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            public.organization_role not null default 'owner',
  created_at      timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (user_id)
);

create index if not exists idx_org_members_user on public.organization_members(user_id);
create index if not exists idx_org_members_org on public.organization_members(organization_id);

-- -----------------------------------------------------------------------------
-- Триггер updated_at
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Вспомогательные функции для RLS
-- -----------------------------------------------------------------------------
create or replace function public.get_my_organization_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select organization_id
  from public.organization_members
  where user_id = auth.uid();
$$;

create or replace function public.user_has_organization()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where user_id = auth.uid()
  );
$$;

-- -----------------------------------------------------------------------------
-- RPC: создание компании (атомарно)
-- -----------------------------------------------------------------------------
create or replace function public.create_organization(
  p_name text,
  p_business_type public.organization_business_type,
  p_timezone text default 'Europe/Moscow'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_org public.organizations;
  v_slug text;
  v_base text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if exists (
    select 1 from public.organization_members where user_id = v_user_id
  ) then
    raise exception 'User already belongs to an organization' using errcode = '23505';
  end if;

  if char_length(trim(p_name)) < 2 then
    raise exception 'Organization name must be at least 2 characters' using errcode = '22023';
  end if;

  v_base := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9а-яА-ЯёЁ]+', '-', 'g'));
  v_base := trim(both '-' from v_base);
  if v_base = '' then
    v_base := 'company';
  end if;
  v_slug := v_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  insert into public.organizations (name, business_type, timezone, slug)
  values (
    trim(p_name),
    p_business_type,
    coalesce(nullif(trim(p_timezone), ''), 'Europe/Moscow'),
    v_slug
  )
  returning * into v_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org.id, v_user_id, 'owner');

  return json_build_object(
    'id', v_org.id,
    'name', v_org.name,
    'business_type', v_org.business_type,
    'timezone', v_org.timezone,
    'slug', v_org.slug,
    'role', 'owner',
    'created_at', v_org.created_at
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

-- organizations: читать только свою компанию
drop policy if exists "organizations_select_member" on public.organizations;
create policy "organizations_select_member"
  on public.organizations
  for select
  to authenticated
  using (id in (select public.get_my_organization_ids()));

-- organizations: обновлять только владелец (пока owner)
drop policy if exists "organizations_update_owner" on public.organizations;
create policy "organizations_update_owner"
  on public.organizations
  for update
  to authenticated
  using (
    id in (
      select organization_id
      from public.organization_members
      where user_id = auth.uid() and role = 'owner'
    )
  )
  with check (
    id in (
      select organization_id
      from public.organization_members
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- organization_members: видеть только свою запись
drop policy if exists "org_members_select_own" on public.organization_members;
create policy "org_members_select_own"
  on public.organization_members
  for select
  to authenticated
  using (user_id = auth.uid());

-- INSERT в organizations/members — только через RPC create_organization (security definer)
-- Прямой INSERT заблокирован отсутствием политик INSERT

-- -----------------------------------------------------------------------------
-- Права
-- -----------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select on public.organizations to authenticated;
grant select on public.organization_members to authenticated;
grant execute on function public.create_organization(text, public.organization_business_type, text) to authenticated;
grant execute on function public.get_my_organization_ids() to authenticated;
grant execute on function public.user_has_organization() to authenticated;
