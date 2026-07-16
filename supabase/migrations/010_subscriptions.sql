-- =============================================================================
-- Bookly — Миграция 010: Подписки (тариф, пробный период, DB-level ограничение)
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001–009
--
-- Область: только тариф Bookly Pro, 14-дневный trial, статусы подписки,
-- защита на уровне базы для services/staff/staff_services/staff_schedules/bookings,
-- проверка entitlement для публичной записи.
--
-- Не подключает платёжного провайдера, webhook, /admin-панель, новые тарифы.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Таблица: subscription_plans
-- -----------------------------------------------------------------------------
create table if not exists public.subscription_plans (
  id               uuid primary key default gen_random_uuid(),
  code             text unique not null,
  name             text not null,
  description      text,
  price_amount     integer not null check (price_amount >= 0),
  currency         text not null default 'KZT',
  billing_interval text not null default 'month'
    check (billing_interval in ('month', 'year')),
  trial_days       integer not null default 14
    check (trial_days >= 0 and trial_days <= 90),
  is_active        boolean not null default true,
  features         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint subscription_plans_code_format check (code ~ '^[a-z0-9_-]+$')
);

drop trigger if exists subscription_plans_set_updated_at on public.subscription_plans;
create trigger subscription_plans_set_updated_at
  before update on public.subscription_plans
  for each row execute function public.set_updated_at();

-- Единственный тариф на данном этапе: Bookly Pro (услуги, сотрудники, расписания,
-- ручные и публичные записи, защита от конфликтов расписания).
insert into public.subscription_plans (
  code, name, description, price_amount, currency, billing_interval, trial_days, is_active, features
)
values (
  'pro',
  'Bookly Pro',
  'Услуги, сотрудники, расписания, ручные и онлайн-записи, защита от конфликтов расписания.',
  6990,
  'KZT',
  'month',
  14,
  true,
  jsonb_build_object(
    'services', true,
    'staff', true,
    'schedules', true,
    'manual_bookings', true,
    'public_booking', true,
    'conflict_protection', true
  )
)
on conflict (code) do nothing;

alter table public.subscription_plans enable row level security;

drop policy if exists "subscription_plans_select_active" on public.subscription_plans;
create policy "subscription_plans_select_active"
  on public.subscription_plans
  for select
  to authenticated
  using (is_active = true);

revoke all on public.subscription_plans from public, anon;
grant select on public.subscription_plans to authenticated;

-- -----------------------------------------------------------------------------
-- Таблица: organization_subscriptions
-- -----------------------------------------------------------------------------
create table if not exists public.organization_subscriptions (
  id                                   uuid primary key default gen_random_uuid(),
  organization_id                      uuid not null unique references public.organizations(id) on delete cascade,
  plan_id                              uuid not null references public.subscription_plans(id),
  status                               text not null
    check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired', 'suspended')),
  trial_started_at                    timestamptz,
  trial_ends_at                       timestamptz,
  current_period_start                timestamptz,
  current_period_end                  timestamptz,
  grace_period_ends_at                timestamptz,
  cancel_at_period_end                boolean not null default false,
  canceled_at                         timestamptz,
  payment_provider                    text,
  provider_customer_id                text,
  provider_subscription_id            text,
  provider_payment_method_fingerprint text,
  last_payment_status                 text,
  trial_started_by_user_id            uuid,
  created_at                          timestamptz not null default now(),
  updated_at                          timestamptz not null default now()
);

create index if not exists idx_org_subscriptions_organization
  on public.organization_subscriptions(organization_id);
create index if not exists idx_org_subscriptions_status
  on public.organization_subscriptions(status);
create index if not exists idx_org_subscriptions_trial_ends
  on public.organization_subscriptions(trial_ends_at);
create index if not exists idx_org_subscriptions_period_end
  on public.organization_subscriptions(current_period_end);
create index if not exists idx_org_subscriptions_provider_customer
  on public.organization_subscriptions(provider_customer_id);
create index if not exists idx_org_subscriptions_provider_subscription
  on public.organization_subscriptions(provider_subscription_id);
create index if not exists idx_org_subscriptions_provider_fingerprint
  on public.organization_subscriptions(provider_payment_method_fingerprint);

drop trigger if exists organization_subscriptions_set_updated_at on public.organization_subscriptions;
create trigger organization_subscriptions_set_updated_at
  before update on public.organization_subscriptions
  for each row execute function public.set_updated_at();

alter table public.organization_subscriptions enable row level security;

-- Прямой SELECT для authenticated/anon/public запрещён: provider IDs, fingerprint
-- и внутренние поля не должны попадать в браузер. Состояние подписки доступно
-- только через get_organization_subscription_access(uuid), которая возвращает
-- безопасный набор столбцов (allowed, status, reason, plan_code, даты, days_remaining).
-- Запись в таблицу — только security definer RPC (create_organization, будущие
-- webhook-обработчики и platform admin RPC).
drop policy if exists "organization_subscriptions_select_member" on public.organization_subscriptions;

revoke all on public.organization_subscriptions from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Таблица: subscription_trial_claims
-- Учёт одного пробного периода на один Supabase user_id.
-- Не хранит пароли, номера карт, CVC, полный IP или браузерный fingerprint.
-- -----------------------------------------------------------------------------
-- organization_id — "on delete set null" (а не cascade и не запрет удаления):
-- сама запись о использованном trial должна сохраняться даже после удаления
-- организации (иначе тот же user_id мог бы получить новый trial повторно),
-- но при этом строка claim не должна блокировать удаление organizations.
create table if not exists public.subscription_trial_claims (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users(id) on delete cascade,
  organization_id            uuid references public.organizations(id) on delete set null,
  email_normalized_hash      text,
  phone_normalized_hash      text,
  payment_method_fingerprint text,
  claimed_at                 timestamptz not null default now(),
  constraint subscription_trial_claims_user_unique unique (user_id)
);

-- Partial unique index: допускает множество строк с organization_id = null
-- (claim, оставшиеся после удаления организации), но не более одной активной
-- claim-строки на организацию.
create unique index if not exists idx_trial_claims_org_unique
  on public.subscription_trial_claims (organization_id)
  where organization_id is not null;

create unique index if not exists idx_trial_claims_fingerprint_unique
  on public.subscription_trial_claims (payment_method_fingerprint)
  where payment_method_fingerprint is not null;

-- RLS включён, политик нет: ни anon, ни authenticated не имеют доступа.
-- Таблица читается/пишется только security definer функциями (create_organization,
-- get_subscription_access_internal и будущие серверные RPC).
alter table public.subscription_trial_claims enable row level security;
revoke all on public.subscription_trial_claims from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Функции проверки доступа к подписке
--
-- get_subscription_access_internal(): чистое вычисление allowed/status/reason
-- по данным organization_subscriptions/subscription_plans. Не выполняет
-- membership-проверку и не читает auth.uid()/auth.role() — вызывающая сторона
-- (публичная RPC или DB-trigger) уже обязана быть безопасно авторизована.
-- Не выдаётся public/anon/authenticated — используется только внутренне
-- (DB-триггерами) и сервером через service_role (после того как сервер сам
-- безопасно определил organization_id, например по slug).
--
-- get_organization_subscription_access(): пользовательская RPC. Проверяет
-- auth.uid() и membership вызывающего пользователя в организации, и только
-- затем делегирует вычисление внутренней функции. Доступна только authenticated.
-- -----------------------------------------------------------------------------
create or replace function public.get_subscription_access_internal(p_organization_id uuid)
returns table (
  allowed              boolean,
  status               text,
  reason               text,
  plan_code            text,
  trial_ends_at        timestamptz,
  current_period_end   timestamptz,
  grace_period_ends_at timestamptz,
  days_remaining       integer
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_status                text;
  v_trial_ends_at         timestamptz;
  v_current_period_end   timestamptz;
  v_grace_period_ends_at timestamptz;
  v_plan_code             text;
  v_boundary              timestamptz;
begin
  select
    os.status,
    os.trial_ends_at,
    os.current_period_end,
    os.grace_period_ends_at,
    sp.code
  into
    v_status,
    v_trial_ends_at,
    v_current_period_end,
    v_grace_period_ends_at,
    v_plan_code
  from public.organization_subscriptions os
  join public.subscription_plans sp on sp.id = os.plan_id
  where os.organization_id = p_organization_id;

  if not found then
    allowed := false;
    status := null;
    reason := 'SUBSCRIPTION_NOT_FOUND';
    plan_code := null;
    trial_ends_at := null;
    current_period_end := null;
    grace_period_ends_at := null;
    days_remaining := null;
    return next;
    return;
  end if;

  status := v_status;
  plan_code := v_plan_code;
  trial_ends_at := v_trial_ends_at;
  current_period_end := v_current_period_end;
  grace_period_ends_at := v_grace_period_ends_at;
  v_boundary := null;

  if v_status = 'suspended' then
    allowed := false;
    reason := 'ORGANIZATION_SUSPENDED';

  elsif v_status = 'trialing' then
    if v_trial_ends_at is not null and now() <= v_trial_ends_at then
      allowed := true;
      reason := 'TRIAL_ACTIVE';
      v_boundary := v_trial_ends_at;
    else
      allowed := false;
      reason := 'TRIAL_EXPIRED';
    end if;

  elsif v_status = 'active' then
    if v_current_period_end is not null and now() <= v_current_period_end then
      allowed := true;
      reason := 'SUBSCRIPTION_ACTIVE';
      v_boundary := v_current_period_end;
    else
      allowed := false;
      reason := 'SUBSCRIPTION_EXPIRED';
    end if;

  elsif v_status = 'past_due' then
    if v_grace_period_ends_at is not null and now() <= v_grace_period_ends_at then
      allowed := true;
      reason := 'GRACE_PERIOD';
      v_boundary := v_grace_period_ends_at;
    else
      allowed := false;
      reason := 'PAYMENT_PAST_DUE';
    end if;

  elsif v_status = 'canceled' then
    if v_current_period_end is not null and now() <= v_current_period_end then
      allowed := true;
      reason := 'SUBSCRIPTION_CANCELED';
      v_boundary := v_current_period_end;
    else
      allowed := false;
      reason := 'SUBSCRIPTION_EXPIRED';
    end if;

  elsif v_status = 'expired' then
    allowed := false;
    reason := 'SUBSCRIPTION_EXPIRED';

  else
    -- Защитный случай для неизвестного статуса: доступа нет.
    allowed := false;
    reason := 'SUBSCRIPTION_EXPIRED';
  end if;

  if allowed and v_boundary is not null then
    days_remaining := greatest(
      0,
      ceil(extract(epoch from (v_boundary - now())) / 86400.0)::integer
    );
  else
    days_remaining := 0;
  end if;

  return next;
  return;
end;
$$;

revoke all on function public.get_subscription_access_internal(uuid)
  from public, anon, authenticated;
grant execute on function public.get_subscription_access_internal(uuid) to service_role;

create or replace function public.get_organization_subscription_access(p_organization_id uuid)
returns table (
  allowed              boolean,
  status               text,
  reason               text,
  plan_code            text,
  trial_ends_at        timestamptz,
  current_period_end   timestamptz,
  grace_period_ends_at timestamptz,
  days_remaining       integer
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  -- Только authenticated-пользователь и только собственная организация.
  -- service_role сюда не допускается намеренно (см. get_subscription_access_internal
  -- для внутреннего/серверного использования) — эта RPC предназначена браузеру.
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
  select * from public.get_subscription_access_internal(p_organization_id);
end;
$$;

-- organization_has_subscription_access() делегирует пользовательской RPC
-- (а не внутренней функции), поэтому membership-проверка наследуется
-- автоматически — обычный пользователь не может узнать статус чужой организации.
create or replace function public.organization_has_subscription_access(p_organization_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(allowed, false)
  from public.get_organization_subscription_access(p_organization_id)
  limit 1;
$$;

revoke all on function public.get_organization_subscription_access(uuid)
  from public, anon, service_role;
grant execute on function public.get_organization_subscription_access(uuid) to authenticated;

revoke all on function public.organization_has_subscription_access(uuid)
  from public, anon, service_role;
grant execute on function public.organization_has_subscription_access(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- DB-level защита записи для бизнес-таблиц
-- Блокирует INSERT/UPDATE/DELETE при отсутствии доступа. Чтение не блокируется.
--
-- Действует для ЛЮБОЙ роли, включая service_role: сознательно нет ветвления
-- по auth.role(). Это вторая линия защиты после server/lib/public-booking-service.js
-- и server/lib/subscription-service.js — она не должна обходиться сервером,
-- будущими маршрутами или прямым service_role доступом. Единственный
-- легитимный обход в будущем — отдельная, явно названная security-definer
-- platform-admin RPC (не создаётся в этой миграции).
--
-- Используется public.get_subscription_access_internal(), а не пользовательская
-- RPC get_organization_subscription_access() — триггер не должен зависеть от
-- auth.uid()/membership, так как срабатывает независимо от того, кто пишет.
--
-- OLD/NEW organization_id: проверены реальные структуры таблиц services,
-- staff, staff_services, staff_schedules, bookings (миграции 002–005) — во
-- всех пяти organization_id присутствует напрямую как NOT NULL столбец,
-- поэтому обходной запрос через связанную сущность не требуется.
-- INSERT — проверяется NEW.organization_id; DELETE — OLD.organization_id;
-- UPDATE — organization_id менять запрещено полностью (см. ниже), поэтому
-- OLD и NEW всегда совпадают и проверяется NEW.organization_id.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_subscription_access()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id  uuid;
  v_allowed boolean;
  v_status  text;
begin
  if tg_op = 'DELETE' then
    v_org_id := old.organization_id;
  else
    v_org_id := new.organization_id;

    -- Запрет переноса строки между организациями: иначе можно было бы
    -- обойти проверку, перенеся строку из заблокированной организации в
    -- организацию с активной подпиской (или наоборот) через один UPDATE.
    if tg_op = 'UPDATE' and old.organization_id is distinct from new.organization_id then
      raise exception 'ORGANIZATION_ID_IMMUTABLE';
    end if;
  end if;

  if v_org_id is not null then
    select allowed, status
    into v_allowed, v_status
    from public.get_subscription_access_internal(v_org_id)
    limit 1;

    if v_allowed is not true then
      if v_status = 'suspended' then
        raise exception 'ORGANIZATION_SUSPENDED';
      else
        raise exception 'SUBSCRIPTION_REQUIRED';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists services_enforce_subscription on public.services;
create trigger services_enforce_subscription
  before insert or update or delete on public.services
  for each row execute function public.enforce_subscription_access();

drop trigger if exists staff_enforce_subscription on public.staff;
create trigger staff_enforce_subscription
  before insert or update or delete on public.staff
  for each row execute function public.enforce_subscription_access();

drop trigger if exists staff_services_enforce_subscription on public.staff_services;
create trigger staff_services_enforce_subscription
  before insert or update or delete on public.staff_services
  for each row execute function public.enforce_subscription_access();

drop trigger if exists staff_schedules_enforce_subscription on public.staff_schedules;
create trigger staff_schedules_enforce_subscription
  before insert or update or delete on public.staff_schedules
  for each row execute function public.enforce_subscription_access();

drop trigger if exists bookings_enforce_subscription on public.bookings;
create trigger bookings_enforce_subscription
  before insert or update or delete on public.bookings
  for each row execute function public.enforce_subscription_access();

-- -----------------------------------------------------------------------------
-- create_organization(): выдача пробного периода (один trial на один user_id)
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
  v_user_id       uuid;
  v_org           public.organizations;
  v_slug          text;
  v_plan_id       uuid;
  v_trial_days    integer;
  v_claim_id      uuid;
  v_sub_status    text;
  v_trial_ends_at timestamptz;
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

  -- Активный тариф pro обязателен до создания организации: без плана организация
  -- и membership не должны сохраняться.
  select id, trial_days
  into v_plan_id, v_trial_days
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
    coalesce(nullif(trim(p_timezone), ''), 'Europe/Moscow'),
    v_slug,
    trim(p_name),
    false,
    'auto'
  )
  returning * into v_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org.id, v_user_id, 'owner');

  -- Атомарная выдача trial: INSERT ... ON CONFLICT исключает гонку между
  -- параллельными create_organization() для одного user_id.
  insert into public.subscription_trial_claims (user_id, organization_id)
  values (v_user_id, v_org.id)
  on conflict (user_id) do nothing
  returning id into v_claim_id;

  if v_claim_id is not null then
    v_trial_ends_at := now() + (coalesce(v_trial_days, 14) || ' days')::interval;

    insert into public.organization_subscriptions (
      organization_id, plan_id, status,
      trial_started_at, trial_ends_at, trial_started_by_user_id
    )
    values (
      v_org.id, v_plan_id, 'trialing',
      now(), v_trial_ends_at, v_user_id
    )
    returning status, trial_ends_at into v_sub_status, v_trial_ends_at;
  else
    -- Trial уже был использован этим user_id: подписка без пробного периода.
    insert into public.organization_subscriptions (
      organization_id, plan_id, status
    )
    values (
      v_org.id, v_plan_id, 'expired'
    )
    returning status, trial_ends_at into v_sub_status, v_trial_ends_at;
  end if;

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
    'subscription', json_build_object('status', v_sub_status, 'trial_ends_at', v_trial_ends_at)
  );
end;
$$;

revoke all on function public.create_organization(text, public.organization_business_type, text)
  from public, anon, service_role;
grant execute on function public.create_organization(text, public.organization_business_type, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Backfill: подписка Bookly Pro (trial) для организаций, созданных до этой миграции
-- Идемпотентно: затрагивает только организации без организации-подписки.
-- -----------------------------------------------------------------------------
do $$
declare
  v_plan_id    uuid;
  v_trial_days integer;
begin
  select id, trial_days
  into v_plan_id, v_trial_days
  from public.subscription_plans
  where code = 'pro'
  limit 1;

  if v_plan_id is null then
    raise notice 'Migration 010: план "pro" не найден — backfill подписок пропущен';
    return;
  end if;

  create temporary table if not exists _bookly_migration_010_backfill_orgs (
    organization_id uuid primary key
  ) on commit drop;

  delete from _bookly_migration_010_backfill_orgs;

  insert into _bookly_migration_010_backfill_orgs (organization_id)
  select o.id
  from public.organizations o
  where not exists (
    select 1
    from public.organization_subscriptions os
    where os.organization_id = o.id
  );

  insert into public.organization_subscriptions (
    organization_id, plan_id, status, trial_started_at, trial_ends_at
  )
  select
    b.organization_id,
    v_plan_id,
    'trialing',
    now(),
    now() + (coalesce(v_trial_days, 14) || ' days')::interval
  from _bookly_migration_010_backfill_orgs b;

  -- Trial claim для владельца, если его можно определить однозначно.
  -- Устойчиво к нестандартным/повреждённым данным:
  --   - организация без owner: не попадает в per_org, просто не получает claim
  --     (backfill подписки для самой организации уже выполнен выше);
  --   - несколько owner у одной организации: берётся самая ранняя строка
  --     organization_members (order by created_at asc, user_id asc);
  --   - один user_id, ассоциированный (по повреждённым данным) с несколькими
  --     организациями: берётся самая ранняя по created_at организация
  --     (order by o.created_at asc, organization_id asc), остальные пропускаются;
  --   - claim для user_id уже существует (из другого прогона/create_organization):
  --     "on conflict do nothing" пропускает строку без ошибки и без отката
  --     всей миграции — как для конфликта с уже существующей строкой, так и
  --     для дублей внутри одного INSERT.
  -- Итог: организация всегда получает organization_subscription (выше), один
  -- user_id — не более одного claim, повторный запуск не продлевает trial и
  -- не создаёт лишних claim-строк.
  insert into public.subscription_trial_claims (user_id, organization_id)
  select final_row.user_id, final_row.organization_id
  from (
    select distinct on (per_org.user_id)
      per_org.user_id,
      per_org.organization_id
    from (
      select distinct on (om.organization_id)
        om.organization_id,
        om.user_id,
        o.created_at as org_created_at
      from public.organization_members om
      join _bookly_migration_010_backfill_orgs b on b.organization_id = om.organization_id
      join public.organizations o on o.id = om.organization_id
      where om.role = 'owner'
      order by om.organization_id, om.created_at asc, om.user_id asc
    ) per_org
    order by per_org.user_id, per_org.org_created_at asc, per_org.organization_id asc
  ) final_row
  on conflict do nothing;
end;
$$;

-- -----------------------------------------------------------------------------
-- Проверка безопасности: нет anon/public-доступа к таблицам/функциям подписок
-- -----------------------------------------------------------------------------
do $$
declare
  v_count integer;
  v_create_org_def text;
begin
  -- Политики TO anon или TO public на таблицах подписок запрещены.
  select count(*)::integer
  into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename in ('organization_subscriptions', 'subscription_trial_claims', 'subscription_plans')
    and ('anon' = any (roles) or 'public' = any (roles));

  if v_count > 0 then
    raise exception
      'Migration 010 safety check failed: found % anon/public policies on subscription tables',
      v_count;
  end if;

  -- organization_subscriptions: authenticated не должен иметь прямой SELECT
  -- (provider IDs и fingerprint не должны попадать в браузер).
  if has_table_privilege('authenticated', 'public.organization_subscriptions', 'SELECT') then
    raise exception
      'Migration 010 safety check failed: authenticated has direct SELECT on organization_subscriptions';
  end if;

  -- На organization_subscriptions не должно быть SELECT-политик для браузера.
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_subscriptions'
  ) then
    raise exception
      'Migration 010 safety check failed: organization_subscriptions must have no RLS policies (browser uses RPC only)';
  end if;

  -- Активный тариф pro обязателен.
  if not exists (
    select 1
    from public.subscription_plans
    where code = 'pro' and is_active = true
  ) then
    raise exception
      'Migration 010 safety check failed: active subscription plan "pro" not found';
  end if;

  if exists (
    select 1
    from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name in (
        'get_organization_subscription_access',
        'organization_has_subscription_access',
        'get_subscription_access_internal'
      )
      and grantee in ('anon', 'public')
  ) then
    raise exception
      'Migration 010 safety check failed: anon/public has EXECUTE on subscription access functions';
  end if;

  -- create_organization недоступна anon/public/service_role.
  if has_function_privilege(
    'anon',
    'public.create_organization(text, public.organization_business_type, text)',
    'EXECUTE'
  ) then
    raise exception
      'Migration 010 safety check failed: anon has EXECUTE on create_organization';
  end if;

  if has_function_privilege(
    'public',
    'public.create_organization(text, public.organization_business_type, text)',
    'EXECUTE'
  ) then
    raise exception
      'Migration 010 safety check failed: public has EXECUTE on create_organization';
  end if;

  -- Внутренняя функция не должна быть доступна даже authenticated —
  -- иначе браузерный клиент мог бы читать/обходить membership-проверку.
  if exists (
    select 1
    from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name = 'get_subscription_access_internal'
      and grantee = 'authenticated'
  ) then
    raise exception
      'Migration 010 safety check failed: authenticated has EXECUTE on the internal subscription function';
  end if;

  -- Пользовательская RPC не должна быть доступна service_role — иначе её
  -- легко было бы перепутать с внутренней функцией и обойти membership-проверку.
  if exists (
    select 1
    from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name in (
        'get_organization_subscription_access',
        'organization_has_subscription_access'
      )
      and grantee = 'service_role'
  ) then
    raise exception
      'Migration 010 safety check failed: service_role has EXECUTE on the user-facing subscription RPC';
  end if;

  -- Публичная RPC не должна возвращать provider-поля (только безопасный набор).
  select pg_get_functiondef(
    'public.get_organization_subscription_access(uuid)'::regprocedure
  ) into v_create_org_def;

  if v_create_org_def ~* 'provider_customer_id'
    or v_create_org_def ~* 'provider_subscription_id'
    or v_create_org_def ~* 'provider_payment_method_fingerprint'
    or v_create_org_def ~* 'payment_provider'
    or v_create_org_def ~* 'last_payment_status'
    or v_create_org_def ~* 'trial_started_by_user_id'
  then
    raise exception
      'Migration 010 safety check failed: user-facing subscription RPC must not expose provider/internal fields';
  end if;

  -- create_organization() должна использовать атомарную вставку claim.
  select pg_get_functiondef(
    'public.create_organization(text, public.organization_business_type, text)'::regprocedure
  ) into v_create_org_def;

  if v_create_org_def !~* 'on conflict \(user_id\) do nothing' then
    raise exception
      'Migration 010 safety check failed: create_organization must use atomic ON CONFLICT trial claim insert';
  end if;

  if not (v_create_org_def ~* 'SUBSCRIPTION_PLAN_NOT_FOUND') then
    raise exception
      'Migration 010 safety check failed: create_organization must reject missing active pro plan';
  end if;

  -- subscription_trial_claims.organization_id должен быть nullable с
  -- on delete set null, чтобы claim не блокировал удаление организации.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'subscription_trial_claims'
      and column_name = 'organization_id'
      and is_nullable = 'NO'
  ) then
    raise exception
      'Migration 010 safety check failed: subscription_trial_claims.organization_id must be nullable';
  end if;
end;
$$;
