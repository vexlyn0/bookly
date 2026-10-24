-- =============================================================================
-- Jazyl — Миграция 024: профиль салона на странице записи
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001–023
--
--   1. organizations: instagram, whatsapp, gis_url (ссылка 2ГИС), logo_url, cover_url.
--   2. services: photo_url, is_popular (категория — уже есть: services.category).
--   3. staff: photo_url.
--   4. portfolio_photos — «Наши работы» (до 24 фото на салон).
--   5. Хранилище фото: публичный bucket «media», файлы лежат в папке <id салона>/…,
--      загружать и удалять может только участник этого салона.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Контакты и фото салона
-- -----------------------------------------------------------------------------
alter table public.organizations
  add column if not exists instagram text,
  add column if not exists whatsapp text,
  add column if not exists gis_url text,
  add column if not exists logo_url text,
  add column if not exists cover_url text;

alter table public.organizations drop constraint if exists organizations_profile_check;
alter table public.organizations
  add constraint organizations_profile_check check (
    (instagram is null or char_length(instagram) <= 100)
    and (whatsapp is null or char_length(whatsapp) <= 30)
    and (gis_url is null or (char_length(gis_url) <= 500 and gis_url ~ '^https://'))
    and (logo_url is null or (char_length(logo_url) <= 500 and logo_url ~ '^https://'))
    and (cover_url is null or (char_length(cover_url) <= 500 and cover_url ~ '^https://'))
  );

-- -----------------------------------------------------------------------------
-- 2–3. Фото услуг и мастеров, «популярное»
-- -----------------------------------------------------------------------------
alter table public.services
  add column if not exists photo_url text,
  add column if not exists is_popular boolean not null default false;

alter table public.services drop constraint if exists services_photo_url_check;
alter table public.services
  add constraint services_photo_url_check check (
    photo_url is null or (char_length(photo_url) <= 500 and photo_url ~ '^https://')
  );

alter table public.staff
  add column if not exists photo_url text;

alter table public.staff drop constraint if exists staff_photo_url_check;
alter table public.staff
  add constraint staff_photo_url_check check (
    photo_url is null or (char_length(photo_url) <= 500 and photo_url ~ '^https://')
  );

-- -----------------------------------------------------------------------------
-- 4. «Наши работы»
-- -----------------------------------------------------------------------------
create table if not exists public.portfolio_photos (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  url             text not null check (char_length(url) <= 500 and url ~ '^https://'),
  created_at      timestamptz not null default now()
);

create index if not exists idx_portfolio_photos_org
  on public.portfolio_photos (organization_id, created_at desc);

create or replace function public.portfolio_photos_limit()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.portfolio_photos where organization_id = new.organization_id) >= 24 then
    raise exception 'PORTFOLIO_LIMIT';
  end if;
  return new;
end;
$$;

drop trigger if exists portfolio_photos_limit on public.portfolio_photos;
create trigger portfolio_photos_limit
  before insert on public.portfolio_photos
  for each row execute function public.portfolio_photos_limit();

drop trigger if exists portfolio_photos_enforce_subscription on public.portfolio_photos;
create trigger portfolio_photos_enforce_subscription
  before insert or update or delete on public.portfolio_photos
  for each row execute function public.enforce_subscription_access();

alter table public.portfolio_photos enable row level security;

drop policy if exists "portfolio_photos_select_member" on public.portfolio_photos;
create policy "portfolio_photos_select_member" on public.portfolio_photos
  for select to authenticated
  using (organization_id in (select public.get_my_organization_ids()));

drop policy if exists "portfolio_photos_insert_member" on public.portfolio_photos;
create policy "portfolio_photos_insert_member" on public.portfolio_photos
  for insert to authenticated
  with check (organization_id in (select public.get_my_organization_ids()));

drop policy if exists "portfolio_photos_delete_member" on public.portfolio_photos;
create policy "portfolio_photos_delete_member" on public.portfolio_photos
  for delete to authenticated
  using (organization_id in (select public.get_my_organization_ids()));

grant select, insert, delete on public.portfolio_photos to authenticated;
grant all on public.portfolio_photos to service_role;

-- -----------------------------------------------------------------------------
-- 5. Хранилище фото: bucket «media» (публичное чтение, до 2 МБ, только картинки)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Первая папка пути — id салона: media/<organization_id>/…
drop policy if exists "media_select_member" on storage.objects;
create policy "media_select_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (select org_id::text from public.get_my_organization_ids() as org_id)
  );

drop policy if exists "media_insert_member" on storage.objects;
create policy "media_insert_member" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (select org_id::text from public.get_my_organization_ids() as org_id)
  );

drop policy if exists "media_update_member" on storage.objects;
create policy "media_update_member" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (select org_id::text from public.get_my_organization_ids() as org_id)
  );

drop policy if exists "media_delete_member" on storage.objects;
create policy "media_delete_member" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (select org_id::text from public.get_my_organization_ids() as org_id)
  );

notify pgrst, 'reload schema';

commit;
