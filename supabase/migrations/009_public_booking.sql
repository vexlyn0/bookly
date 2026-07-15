-- =============================================================================
-- Bookly — Миграция 009: Public Booking (hardened)
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001–008
--
-- Безопасность:
-- - НЕ создаёт anon/public RLS-политики на приватные таблицы
-- - Публичный доступ только через Express API + service_role
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Колонки организации (идемпотентно)
-- -----------------------------------------------------------------------------
alter table public.organizations
  add column if not exists public_name text,
  add column if not exists description text,
  add column if not exists phone text,
  add column if not exists address text;

alter table public.organizations
  add column if not exists public_booking_enabled boolean;

update public.organizations
set public_booking_enabled = false
where public_booking_enabled is null;

alter table public.organizations
  alter column public_booking_enabled set default false;

alter table public.organizations
  alter column public_booking_enabled set not null;

alter table public.organizations
  add column if not exists booking_confirmation_mode text;

update public.organizations
set booking_confirmation_mode = 'auto'
where booking_confirmation_mode is null;

alter table public.organizations
  alter column booking_confirmation_mode set default 'auto';

alter table public.organizations
  alter column booking_confirmation_mode set not null;

alter table public.organizations
  drop constraint if exists organizations_booking_confirmation_mode_check;

alter table public.organizations
  add constraint organizations_booking_confirmation_mode_check
  check (booking_confirmation_mode in ('auto', 'manual'));

-- public_name: backfill из name, не затирая заполненные значения
update public.organizations
set public_name = trim(name)
where public_name is null
   or char_length(trim(public_name)) = 0;

alter table public.organizations
  drop constraint if exists organizations_public_name_not_blank;

alter table public.organizations
  add constraint organizations_public_name_not_blank
  check (
    public_name is null
    or char_length(trim(public_name)) >= 2
  );

-- -----------------------------------------------------------------------------
-- Транслитерация slug (последовательные replace, не translate для digraph)
-- -----------------------------------------------------------------------------
create or replace function public.slugify_organization_base(p_name text)
returns text
language plpgsql
immutable
as $$
declare
  v text;
begin
  v := lower(trim(coalesce(p_name, '')));

  v := replace(v, 'ё', 'e');
  v := replace(v, 'ж', 'zh');
  v := replace(v, 'х', 'kh');
  v := replace(v, 'ц', 'ts');
  v := replace(v, 'ч', 'ch');
  v := replace(v, 'ш', 'sh');
  v := replace(v, 'щ', 'shch');
  v := replace(v, 'ю', 'yu');
  v := replace(v, 'я', 'ya');
  v := replace(v, 'й', 'y');
  v := replace(v, 'ъ', '');
  v := replace(v, 'ь', '');

  v := translate(
    v,
    'абвгдезийклмнопрстуфыэ',
    'abvgdezijklmnoprstufye'
  );

  v := regexp_replace(v, '[^a-z0-9]+', '-', 'g');
  v := regexp_replace(v, '-{2,}', '-', 'g');
  v := trim(both '-' from v);

  if v = '' then
    v := 'company';
  end if;

  if length(v) > 50 then
    v := left(v, 50);
    v := trim(both '-' from v);
  end if;

  if length(v) < 3 then
    v := v || '-org';
  end if;

  v := left(v, 60);
  v := trim(both '-' from v);

  if length(v) < 3 then
    v := 'org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
  end if;

  return v;
end;
$$;

create or replace function public.generate_unique_organization_slug(
  p_name text,
  p_exclude_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_slug text;
  v_suffix text;
  v_attempt integer := 0;
begin
  v_base := public.slugify_organization_base(p_name);

  loop
    if v_attempt = 0 then
      v_slug := v_base;
    else
      v_suffix := substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
      v_slug := v_base || '-' || v_suffix;
    end if;

    v_slug := left(v_slug, 60);
    v_slug := trim(both '-' from v_slug);

    if length(v_slug) < 3 then
      v_slug := 'org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    end if;

    exit when not exists (
      select 1
      from public.organizations o
      where o.slug = v_slug
        and (p_exclude_id is null or o.id <> p_exclude_id)
    );

    v_attempt := v_attempt + 1;
    if v_attempt > 50 then
      raise exception 'Unable to generate unique organization slug';
    end if;
  end loop;

  return v_slug;
end;
$$;

revoke all on function public.generate_unique_organization_slug(text, uuid) from public;
revoke all on function public.generate_unique_organization_slug(text, uuid) from anon;
revoke all on function public.generate_unique_organization_slug(text, uuid) from authenticated;

-- -----------------------------------------------------------------------------
-- Backfill slug: null/некорректные + дубликаты (стабильный порядок)
-- -----------------------------------------------------------------------------
do $$
declare
  org_row record;
  dup record;
  row_num integer;
  new_slug text;
begin
  for org_row in
    select id, name, slug
    from public.organizations
    order by created_at nulls last, id
  loop
    if org_row.slug is null
      or org_row.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      or length(org_row.slug) < 3
      or length(org_row.slug) > 60
    then
      new_slug := public.generate_unique_organization_slug(
        coalesce(org_row.name, 'company'),
        org_row.id
      );
      update public.organizations
      set slug = new_slug
      where id = org_row.id;
    end if;
  end loop;

  for dup in
    select slug
    from public.organizations
    group by slug
    having count(*) > 1
  loop
    row_num := 0;
    for org_row in
      select id, name, slug
      from public.organizations
      where slug = dup.slug
      order by created_at nulls last, id
    loop
      row_num := row_num + 1;
      if row_num > 1 then
        new_slug := public.generate_unique_organization_slug(
          coalesce(org_row.name, 'company'),
          org_row.id
        );
        update public.organizations
        set slug = new_slug
        where id = org_row.id;
      end if;
    end loop;
  end loop;
end;
$$;

alter table public.organizations
  drop constraint if exists organizations_slug_format;

alter table public.organizations
  add constraint organizations_slug_format
  check (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and length(slug) between 3 and 60
  );

alter table public.organizations
  drop constraint if exists organizations_slug_key;

drop index if exists organizations_slug_unique;
create unique index if not exists organizations_slug_unique
  on public.organizations (slug);

-- -----------------------------------------------------------------------------
-- Публичный номер записи
-- -----------------------------------------------------------------------------
alter table public.bookings
  add column if not exists public_reference text;

drop index if exists bookings_public_reference_unique;
create unique index if not exists bookings_public_reference_unique
  on public.bookings (public_reference)
  where public_reference is not null;

create or replace function public.generate_booking_public_reference()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_i integer;
  v_pos integer;
begin
  v_code := 'BK-';
  for v_i in 1..6 loop
    v_pos := 1 + floor(random() * length(v_chars))::integer;
    v_code := v_code || substr(v_chars, v_pos, 1);
  end loop;
  return v_code;
end;
$$;

revoke all on function public.generate_booking_public_reference() from public;
revoke all on function public.generate_booking_public_reference() from anon;
revoke all on function public.generate_booking_public_reference() from authenticated;
grant execute on function public.generate_booking_public_reference() to service_role;

create or replace function public.bookings_assign_public_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt integer := 0;
  v_ref text;
begin
  if new.source = 'public_booking'
    and coalesce(trim(new.public_reference), '') = ''
  then
    loop
      v_attempt := v_attempt + 1;
      if v_attempt > 20 then
        raise exception 'BOOKING_REFERENCE_GENERATION_FAILED';
      end if;

      v_ref := public.generate_booking_public_reference();

      if not exists (
        select 1
        from public.bookings b
        where b.public_reference = v_ref
      ) then
        new.public_reference := v_ref;
        exit;
      end if;
    end loop;
  end if;

  return new;
end;
$$;

create or replace function public.bookings_protect_public_reference()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
    and old.public_reference is not null
    and new.public_reference is distinct from old.public_reference
  then
    new.public_reference := old.public_reference;
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_assign_public_reference on public.bookings;
create trigger bookings_assign_public_reference
  before insert on public.bookings
  for each row execute function public.bookings_assign_public_reference();

drop trigger if exists bookings_protect_public_reference on public.bookings;
create trigger bookings_protect_public_reference
  before update on public.bookings
  for each row execute function public.bookings_protect_public_reference();

-- -----------------------------------------------------------------------------
-- RPC create_organization: slug, public_name, booking disabled by default
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

  v_slug := public.generate_unique_organization_slug(trim(p_name));

  insert into public.organizations (
    name,
    business_type,
    timezone,
    slug,
    public_name,
    public_booking_enabled,
    booking_confirmation_mode
  )
  values (
    trim(p_name),
    p_business_type,
    coalesce(nullif(trim(p_timezone), ''), 'Europe/Moscow'),
    v_slug,
    trim(p_name),
    false,
    'auto'
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
    'public_name', v_org.public_name,
    'public_booking_enabled', v_org.public_booking_enabled,
    'booking_confirmation_mode', v_org.booking_confirmation_mode,
    'role', 'owner',
    'created_at', v_org.created_at
  );
end;
$$;

grant execute on function public.create_organization(text, public.organization_business_type, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Самопроверка slugify (падает до применения constraint, если логика сломана)
-- -----------------------------------------------------------------------------
do $$
declare
  v_slug text;
begin
  v_slug := public.slugify_organization_base('Моя компания');
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) < 3 then
    raise exception 'slugify test failed: Моя компания -> %', v_slug;
  end if;

  v_slug := public.slugify_organization_base('Ёжик');
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'slugify test failed: Ёжик -> %', v_slug;
  end if;

  v_slug := public.slugify_organization_base('Чай & Кофе');
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'slugify test failed: Чай & Кофе -> %', v_slug;
  end if;

  v_slug := public.slugify_organization_base('!!!');
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) < 3 then
    raise exception 'slugify test failed: special chars -> %', v_slug;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Проверка отсутствия публичных anon-политик на приватных таблицах
-- -----------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select count(*)::integer
  into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename in ('organizations', 'services', 'staff', 'bookings')
    and 'anon' = any (roles)
    and cmd in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL');

  if v_count > 0 then
    raise exception
      'Migration 009 safety check failed: found % anon policies on private tables',
      v_count;
  end if;
end;
$$;
