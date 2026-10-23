-- =============================================================================
-- Bookly — Миграция 015: Freemium (Free навсегда + Pro)
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001–014
--
-- Модель:
--   * Free — навсегда, без подписки: услуги, мастера (до 5 активных), графики,
--     записи, онлайн-запись. На странице записи — подпись «Запись через Bookly».
--   * Pro  — строка organization_subscriptions с действующим доступом
--     (trialing / active / past_due в grace / canceled до конца периода).
--     Без лимита мастеров, без подписи; будущие Pro-функции.
--   * suspended (решение platform admin) — единственное, что блокирует работу.
--
-- Изменения:
--   1. enforce_subscription_access(): блокирует только suspended.
--   2. Лимит 5 активных мастеров на Free (триггер на staff).
--   3. get_organization_entitlements[_internal](): тариф, лимиты, пробный период.
--   4. _apply_free_plan_limits(): после окончания Pro ставит на паузу
--      самых новых мастеров сверх лимита.
--   5. create_organization(): без автоматического trial — старт на Free.
--   6. billing_start_pro_trial(): 14 дней Pro по кнопке, один раз на пользователя.
--   7. Новые типы бизнеса.
-- =============================================================================

-- Новые значения enum нельзя использовать в той же транзакции, поэтому — до begin.
alter type public.organization_business_type add value if not exists 'nail_studio';
alter type public.organization_business_type add value if not exists 'massage';
alter type public.organization_business_type add value if not exists 'cosmetology';
alter type public.organization_business_type add value if not exists 'tattoo';
alter type public.organization_business_type add value if not exists 'clinic';
alter type public.organization_business_type add value if not exists 'fitness';
alter type public.organization_business_type add value if not exists 'education';

begin;

-- -----------------------------------------------------------------------------
-- Константы тарифа Free
-- -----------------------------------------------------------------------------
create or replace function public.bookly_free_staff_limit()
returns integer
language sql
immutable
as $$
  select 5;
$$;

grant execute on function public.bookly_free_staff_limit() to authenticated, service_role;

update public.subscription_plans
set
  trial_days = 14,
  description = 'Без лимита мастеров, без подписи Bookly на странице записи и расширенные функции.',
  features = features || jsonb_build_object('staff_limit', null, 'remove_branding', true)
where code = 'pro';

-- -----------------------------------------------------------------------------
-- Является ли организация Pro прямо сейчас (внутренняя, без membership-проверки)
-- -----------------------------------------------------------------------------
create or replace function public._organization_is_pro(p_organization_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select a.allowed from public.get_subscription_access_internal(p_organization_id) a limit 1),
    false
  );
$$;

revoke all on function public._organization_is_pro(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. enforce_subscription_access: блокирует только приостановленные организации
-- -----------------------------------------------------------------------------
create or replace function public.enforce_subscription_access()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
begin
  if tg_op = 'DELETE' then
    v_org_id := old.organization_id;
  else
    v_org_id := new.organization_id;

    if tg_op = 'UPDATE' and old.organization_id is distinct from new.organization_id then
      raise exception 'ORGANIZATION_ID_IMMUTABLE';
    end if;
  end if;

  if v_org_id is not null and exists (
    select 1
    from public.organization_subscriptions os
    where os.organization_id = v_org_id
      and os.status = 'suspended'
  ) then
    raise exception 'ORGANIZATION_SUSPENDED';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Лимит активных мастеров на Free
-- Срабатывает, когда мастер становится активным (INSERT активного или
-- UPDATE is_active false → true). Pro — без лимита.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_staff_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_active_count integer;
begin
  if new.is_active is not true then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.is_active is true then
    return new;
  end if;

  if public._organization_is_pro(new.organization_id) then
    return new;
  end if;

  -- Сериализуем параллельные добавления мастеров в одной организации.
  perform pg_advisory_xact_lock(hashtext('bookly_staff_limit:' || new.organization_id::text));

  select count(*)
  into v_active_count
  from public.staff s
  where s.organization_id = new.organization_id
    and s.is_active = true
    and s.id is distinct from new.id;

  if v_active_count >= public.bookly_free_staff_limit() then
    raise exception 'STAFF_LIMIT_REACHED';
  end if;

  return new;
end;
$$;

drop trigger if exists staff_enforce_plan_limit on public.staff;
create trigger staff_enforce_plan_limit
  before insert or update of is_active on public.staff
  for each row execute function public.enforce_staff_plan_limit();

-- -----------------------------------------------------------------------------
-- 3. Entitlements: что доступно организации
-- -----------------------------------------------------------------------------
create or replace function public.get_organization_entitlements_internal(p_organization_id uuid)
returns table (
  plan_code            text,
  is_pro               boolean,
  is_trial             boolean,
  is_suspended         boolean,
  status               text,
  reason               text,
  trial_ends_at        timestamptz,
  current_period_end   timestamptz,
  grace_period_ends_at timestamptz,
  days_remaining       integer,
  staff_limit          integer,
  active_staff_count   integer,
  trial_available      boolean,
  show_branding        boolean
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_access record;
  v_owner_id uuid;
begin
  select *
  into v_access
  from public.get_subscription_access_internal(p_organization_id)
  limit 1;

  is_pro := coalesce(v_access.allowed, false);
  is_suspended := coalesce(v_access.status = 'suspended', false);
  is_trial := is_pro and v_access.status = 'trialing';
  plan_code := case when is_pro then 'pro' else 'free' end;
  status := v_access.status;
  reason := v_access.reason;
  trial_ends_at := v_access.trial_ends_at;
  current_period_end := v_access.current_period_end;
  grace_period_ends_at := v_access.grace_period_ends_at;
  days_remaining := case when is_pro then v_access.days_remaining else null end;
  staff_limit := case when is_pro then null else public.bookly_free_staff_limit() end;
  show_branding := not is_pro;

  select count(*)::integer
  into active_staff_count
  from public.staff s
  where s.organization_id = p_organization_id
    and s.is_active = true;

  select m.user_id
  into v_owner_id
  from public.organization_members m
  where m.organization_id = p_organization_id
    and m.role = 'owner'
  order by m.created_at asc
  limit 1;

  trial_available := not is_pro
    and not is_suspended
    and v_owner_id is not null
    and not exists (
      select 1 from public.subscription_trial_claims c where c.user_id = v_owner_id
    )
    and not exists (
      select 1 from public.subscription_trial_claims c where c.organization_id = p_organization_id
    );

  return next;
end;
$$;

revoke all on function public.get_organization_entitlements_internal(uuid)
  from public, anon, authenticated;
grant execute on function public.get_organization_entitlements_internal(uuid) to service_role;

create or replace function public.get_organization_entitlements(p_organization_id uuid)
returns table (
  plan_code            text,
  is_pro               boolean,
  is_trial             boolean,
  is_suspended         boolean,
  status               text,
  reason               text,
  trial_ends_at        timestamptz,
  current_period_end   timestamptz,
  grace_period_ends_at timestamptz,
  days_remaining       integer,
  staff_limit          integer,
  active_staff_count   integer,
  trial_available      boolean,
  show_branding        boolean
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.organization_id = p_organization_id
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return query
  select * from public.get_organization_entitlements_internal(p_organization_id);
end;
$$;

revoke all on function public.get_organization_entitlements(uuid) from public, anon, service_role;
grant execute on function public.get_organization_entitlements(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. После окончания Pro: пауза самых новых мастеров сверх лимита Free.
-- Записи и данные не трогаются. Возвращает число поставленных на паузу.
-- -----------------------------------------------------------------------------
create or replace function public._apply_free_plan_limits(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_paused integer := 0;
begin
  if public._organization_is_pro(p_organization_id) then
    return 0;
  end if;

  if exists (
    select 1 from public.organization_subscriptions os
    where os.organization_id = p_organization_id and os.status = 'suspended'
  ) then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtext('bookly_staff_limit:' || p_organization_id::text));

  with ranked as (
    select s.id,
           row_number() over (order by s.created_at asc, s.id asc) as position
    from public.staff s
    where s.organization_id = p_organization_id
      and s.is_active = true
  )
  update public.staff s
  set is_active = false
  from ranked r
  where s.id = r.id
    and r.position > public.bookly_free_staff_limit();

  get diagnostics v_paused = row_count;
  return v_paused;
end;
$$;

revoke all on function public._apply_free_plan_limits(uuid) from public, anon, authenticated;
grant execute on function public._apply_free_plan_limits(uuid) to service_role;

-- Вызывается кабинетом при загрузке: только участник организации.
create or replace function public.sync_organization_plan_limits(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.organization_id = p_organization_id
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return public._apply_free_plan_limits(p_organization_id);
end;
$$;

revoke all on function public.sync_organization_plan_limits(uuid) from public, anon, service_role;
grant execute on function public.sync_organization_plan_limits(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. create_organization: старт на Free, без автоматического пробного периода.
-- Строка organization_subscriptions создаётся со статусом 'expired' (= нет Pro),
-- чтобы оплата Kaspi и действия platform admin работали без изменений.
-- -----------------------------------------------------------------------------
create or replace function public.create_organization(
  p_name text,
  p_business_type public.organization_business_type,
  p_timezone text default 'Asia/Almaty'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid;
  v_org        public.organizations;
  v_slug       text;
  v_plan_id    uuid;
  v_sub_status text;
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

  select id
  into v_plan_id
  from public.subscription_plans
  where code = 'pro' and is_active = true
  limit 1;

  if v_plan_id is null then
    raise exception 'SUBSCRIPTION_PLAN_NOT_FOUND';
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
    coalesce(nullif(trim(p_timezone), ''), 'Asia/Almaty'),
    v_slug,
    trim(p_name),
    false,
    'auto'
  )
  returning * into v_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org.id, v_user_id, 'owner');

  insert into public.organization_subscriptions (organization_id, plan_id, status)
  values (v_org.id, v_plan_id, 'expired')
  returning status into v_sub_status;

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
    'created_at', v_org.created_at,
    'subscription', json_build_object('status', v_sub_status, 'plan_code', 'free')
  );
end;
$$;

revoke all on function public.create_organization(text, public.organization_business_type, text)
  from public, anon, service_role;
grant execute on function public.create_organization(text, public.organization_business_type, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Пробный Pro на 14 дней по кнопке (service_role, сервер передаёт user_id из JWT)
-- Один раз на пользователя и один раз на организацию.
-- -----------------------------------------------------------------------------
create or replace function public.billing_start_pro_trial(p_user_id uuid)
returns public.organization_subscriptions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id     uuid;
  v_sub        public.organization_subscriptions;
  v_plan       public.subscription_plans;
  v_claim_id   uuid;
begin
  v_org_id := public._require_owner_organization_id(p_user_id);

  select *
  into v_sub
  from public.organization_subscriptions
  where organization_id = v_org_id
  for update;

  if not found then
    raise exception 'SUBSCRIPTION_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_sub.status = 'suspended' then
    raise exception 'ORGANIZATION_SUSPENDED' using errcode = 'P0001';
  end if;

  if public._organization_is_pro(v_org_id) then
    raise exception 'ALREADY_PRO' using errcode = 'P0001';
  end if;

  select * into v_plan from public._get_active_pro_plan();
  if v_plan.id is null then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into public.subscription_trial_claims (user_id, organization_id)
  values (p_user_id, v_org_id)
  on conflict do nothing
  returning id into v_claim_id;

  if v_claim_id is null then
    raise exception 'TRIAL_ALREADY_USED' using errcode = 'P0001';
  end if;

  update public.organization_subscriptions
  set
    plan_id = v_plan.id,
    status = 'trialing',
    trial_started_at = now(),
    trial_ends_at = now() + (greatest(coalesce(v_plan.trial_days, 14), 1) || ' days')::interval,
    trial_started_by_user_id = p_user_id,
    grace_period_ends_at = null
  where organization_id = v_org_id
  returning * into v_sub;

  return v_sub;
end;
$$;

revoke all on function public.billing_start_pro_trial(uuid) from public, anon, authenticated;
grant execute on function public.billing_start_pro_trial(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Сброс автоматически выданных ранее пробных периодов: каждый пользователь
-- сможет один раз запустить Pro-пробу сам. Идущие пробные периоды не трогаются.
-- -----------------------------------------------------------------------------
delete from public.subscription_trial_claims c
where not exists (
  select 1
  from public.organization_subscriptions os
  where os.organization_id = c.organization_id
    and os.status = 'trialing'
    and os.trial_ends_at > now()
);

commit;
