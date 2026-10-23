-- =============================================================================
-- Bookly — Миграция 017: защита онлайн-записи от злоупотреблений
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001–016
--
--   1. phone_key(text) — номер в едином виде (только цифры, 8XXXXXXXXXX → 7…,
--      10 цифр → 7 + номер), чтобы «8 701 123-45-67» и «+77011234567» совпадали.
--   2. bookings.client_phone_key — вычисляемая колонка + индекс: сервер считает
--      активные записи на номер (лимит онлайн-записи — 2).
--   3. client_blacklist — чёрный список номеров организации: с них нельзя
--      записаться онлайн.
-- =============================================================================

begin;

create or replace function public.phone_key(p_phone text)
returns text
language sql
immutable
as $$
  select case
    when length(d) = 11 and left(d, 1) = '8' then '7' || substr(d, 2)
    when length(d) = 10 then '7' || d
    else d
  end
  from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as d) as digits;
$$;

alter table public.bookings
  add column if not exists client_phone_key text
  generated always as (public.phone_key(client_phone)) stored;

create index if not exists idx_bookings_org_phone_key
  on public.bookings (organization_id, client_phone_key);

-- -----------------------------------------------------------------------------
-- Чёрный список
-- -----------------------------------------------------------------------------
create table if not exists public.client_blacklist (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  phone           text not null check (char_length(trim(phone)) between 5 and 30),
  phone_key       text generated always as (public.phone_key(phone)) stored,
  client_name     text check (client_name is null or char_length(client_name) <= 100),
  note            text check (note is null or char_length(note) <= 300),
  created_at      timestamptz not null default now(),
  unique (organization_id, phone_key)
);

alter table public.client_blacklist enable row level security;

drop policy if exists "client_blacklist_select_member" on public.client_blacklist;
create policy "client_blacklist_select_member"
  on public.client_blacklist
  for select
  to authenticated
  using (organization_id in (select public.get_my_organization_ids()));

drop policy if exists "client_blacklist_insert_member" on public.client_blacklist;
create policy "client_blacklist_insert_member"
  on public.client_blacklist
  for insert
  to authenticated
  with check (organization_id in (select public.get_my_organization_ids()));

drop policy if exists "client_blacklist_delete_member" on public.client_blacklist;
create policy "client_blacklist_delete_member"
  on public.client_blacklist
  for delete
  to authenticated
  using (organization_id in (select public.get_my_organization_ids()));

grant select, insert, delete on public.client_blacklist to authenticated;
grant all on public.client_blacklist to service_role;

commit;
