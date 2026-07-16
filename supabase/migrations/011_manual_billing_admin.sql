-- =============================================================================
-- Bookly migration 011: ручная оплата Kaspi + панель platform admin
-- Не изменяет логику trial из 010 (14 дней trialing при create_organization).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- platform_admins
-- -----------------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  role        text not null default 'admin'
    check (role in ('admin', 'owner')),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null
);

alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- is_platform_admin — только self-check для authenticated
-- -----------------------------------------------------------------------------
create or replace function public.is_platform_admin(p_user_id uuid default auth.uid())
returns boolean
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  if p_user_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
  );
end;
$$;

revoke all on function public.is_platform_admin(uuid) from public, anon;
grant execute on function public.is_platform_admin(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- manual_payment_requests
-- -----------------------------------------------------------------------------
create table if not exists public.manual_payment_requests (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  plan_id               uuid not null references public.subscription_plans(id),
  requested_by_user_id  uuid references auth.users(id) on delete set null,
  amount                integer not null,
  currency              text not null default 'KZT',
  billing_months        integer not null default 1,
  payer_name            text not null,
  payer_phone           text,
  payment_reference     text,
  payment_date          timestamptz,
  customer_note         text,
  status                text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'canceled')),
  reviewed_by_user_id   uuid references auth.users(id) on delete set null,
  reviewed_at           timestamptz,
  admin_note            text,
  approved_period_start timestamptz,
  approved_period_end   timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint manual_payment_requests_amount_positive check (amount > 0),
  constraint manual_payment_requests_billing_months_range check (billing_months between 1 and 12),
  constraint manual_payment_requests_payer_name_len check (
    char_length(trim(payer_name)) between 2 and 100
  ),
  constraint manual_payment_requests_payer_phone_len check (
    payer_phone is null or char_length(payer_phone) <= 30
  ),
  constraint manual_payment_requests_payment_reference_len check (
    payment_reference is null or char_length(payment_reference) <= 150
  ),
  constraint manual_payment_requests_customer_note_len check (
    customer_note is null or char_length(customer_note) <= 500
  ),
  constraint manual_payment_requests_admin_note_len check (
    admin_note is null or char_length(admin_note) <= 500
  )
);

create unique index if not exists idx_manual_payment_requests_one_pending_per_org
  on public.manual_payment_requests (organization_id)
  where status = 'pending';

create index if not exists idx_manual_payment_requests_org_created
  on public.manual_payment_requests (organization_id, created_at desc);

create index if not exists idx_manual_payment_requests_status_created
  on public.manual_payment_requests (status, created_at desc);

drop trigger if exists manual_payment_requests_set_updated_at on public.manual_payment_requests;
create trigger manual_payment_requests_set_updated_at
  before update on public.manual_payment_requests
  for each row execute function public.set_updated_at();

alter table public.manual_payment_requests enable row level security;
revoke all on public.manual_payment_requests from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- platform_admin_audit_log
-- -----------------------------------------------------------------------------
create table if not exists public.platform_admin_audit_log (
  id                 uuid primary key default gen_random_uuid(),
  admin_user_id      uuid references auth.users(id) on delete set null,
  action             text not null,
  organization_id    uuid references public.organizations(id) on delete set null,
  payment_request_id uuid references public.manual_payment_requests(id) on delete set null,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create index if not exists idx_platform_admin_audit_log_created
  on public.platform_admin_audit_log (created_at desc);

create index if not exists idx_platform_admin_audit_log_org
  on public.platform_admin_audit_log (organization_id, created_at desc);

alter table public.platform_admin_audit_log enable row level security;
revoke all on public.platform_admin_audit_log from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Поля приостановки организации в organization_subscriptions
-- -----------------------------------------------------------------------------
alter table public.organization_subscriptions
  add column if not exists status_before_suspension text,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_by_user_id uuid,
  add column if not exists suspension_reason text;

do $$
declare
  v_con text;
begin
  select c.conname
  into v_con
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
  where c.contype = 'f'
    and c.conrelid = 'public.organization_subscriptions'::regclass
    and a.attname = 'suspended_by_user_id'
  limit 1;

  if v_con is not null then
    execute format(
      'alter table public.organization_subscriptions drop constraint %I',
      v_con
    );
  end if;

  alter table public.organization_subscriptions
    add constraint organization_subscriptions_suspended_by_user_id_fkey
    foreign key (suspended_by_user_id)
    references auth.users(id)
    on delete set null;
exception
  when duplicate_object then
    null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Внутренние хелперы (только service_role)
-- -----------------------------------------------------------------------------
create or replace function public._assert_platform_admin(p_admin_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_admin_user_id is null then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.platform_admins where user_id = p_admin_user_id
  ) then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public._assert_platform_admin(uuid) from public, anon, authenticated;

create or replace function public._require_owner_organization_id(p_user_id uuid)
returns uuid
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_has_membership boolean;
begin
  if p_user_id is null then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  select om.organization_id
  into v_org_id
  from public.organization_members om
  where om.user_id = p_user_id
    and om.role = 'owner'
  order by om.created_at asc, om.organization_id asc
  limit 1;

  if v_org_id is not null then
    return v_org_id;
  end if;

  select exists (
    select 1
    from public.organization_members om
    where om.user_id = p_user_id
  )
  into v_has_membership;

  if v_has_membership then
    raise exception 'OWNER_REQUIRED' using errcode = 'P0001';
  end if;

  raise exception 'ORGANIZATION_NOT_FOUND' using errcode = 'P0001';
end;
$$;

revoke all on function public._require_owner_organization_id(uuid) from public, anon, authenticated;

create or replace function public._subscription_period_base(p_sub public.organization_subscriptions)
returns timestamptz
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_base timestamptz := now();
begin
  if p_sub.current_period_end is not null and p_sub.current_period_end > v_base then
    v_base := p_sub.current_period_end;
  end if;

  if (
       p_sub.status = 'trialing'
       or (
         p_sub.status = 'suspended'
         and p_sub.status_before_suspension = 'trialing'
       )
     )
     and p_sub.trial_ends_at is not null
     and p_sub.trial_ends_at > now()
     and p_sub.trial_ends_at > v_base then
    v_base := p_sub.trial_ends_at;
  end if;

  return v_base;
end;
$$;

revoke all on function public._subscription_period_base(public.organization_subscriptions)
  from public, anon, authenticated;

create or replace function public._get_active_pro_plan()
returns public.subscription_plans
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select sp.*
  from public.subscription_plans sp
  where sp.code = 'pro'
    and sp.is_active = true
  order by sp.created_at asc
  limit 1;
$$;

revoke all on function public._get_active_pro_plan() from public, anon, authenticated;

create or replace function public._write_admin_audit(
  p_admin_user_id uuid,
  p_action text,
  p_organization_id uuid,
  p_payment_request_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.platform_admin_audit_log (
    admin_user_id,
    action,
    organization_id,
    payment_request_id,
    metadata
  ) values (
    p_admin_user_id,
    p_action,
    p_organization_id,
    p_payment_request_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

revoke all on function public._write_admin_audit(uuid, text, uuid, uuid, jsonb)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- billing_create_manual_payment_request (service_role)
-- -----------------------------------------------------------------------------
create or replace function public.billing_create_manual_payment_request(
  p_user_id uuid,
  p_payer_name text,
  p_payer_phone text default null,
  p_payment_reference text default null,
  p_payment_date timestamptz default null,
  p_customer_note text default null,
  p_billing_months integer default 1
)
returns public.manual_payment_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_plan public.subscription_plans;
  v_amount integer;
  v_row public.manual_payment_requests;
  v_constraint_name text;
begin
  if p_user_id is null then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  v_org_id := public._require_owner_organization_id(p_user_id);

  v_plan := public._get_active_pro_plan();
  if v_plan.id is null then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_billing_months is null or p_billing_months < 1 or p_billing_months > 12 then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  if trim(coalesce(p_payer_name, '')) = ''
     or char_length(trim(p_payer_name)) < 2
     or char_length(trim(p_payer_name)) > 100 then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  if p_payer_phone is not null and char_length(p_payer_phone) > 30 then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  if p_payment_reference is not null and char_length(p_payment_reference) > 150 then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  if p_customer_note is not null and char_length(p_customer_note) > 500 then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  if p_payment_date is not null and p_payment_date > now() + interval '24 hours' then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  v_amount := v_plan.price_amount * p_billing_months;

  begin
    insert into public.manual_payment_requests (
      organization_id,
      plan_id,
      requested_by_user_id,
      amount,
      currency,
      billing_months,
      payer_name,
      payer_phone,
      payment_reference,
      payment_date,
      customer_note,
      status
    ) values (
      v_org_id,
      v_plan.id,
      p_user_id,
      v_amount,
      v_plan.currency,
      p_billing_months,
      trim(p_payer_name),
      nullif(trim(coalesce(p_payer_phone, '')), ''),
      nullif(trim(coalesce(p_payment_reference, '')), ''),
      p_payment_date,
      nullif(trim(coalesce(p_customer_note, '')), ''),
      'pending'
    )
    returning * into v_row;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'idx_manual_payment_requests_one_pending_per_org' then
        raise exception 'PAYMENT_REQUEST_ALREADY_PENDING' using errcode = 'P0001';
      end if;
      raise;
  end;

  return v_row;
end;
$$;

revoke all on function public.billing_create_manual_payment_request(uuid, text, text, text, timestamptz, text, integer)
  from public, anon, authenticated;
grant execute on function public.billing_create_manual_payment_request(uuid, text, text, text, timestamptz, text, integer)
  to service_role;

-- -----------------------------------------------------------------------------
-- billing_cancel_manual_payment_request (service_role)
-- -----------------------------------------------------------------------------
create or replace function public.billing_cancel_manual_payment_request(
  p_user_id uuid,
  p_request_id uuid
)
returns public.manual_payment_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_row public.manual_payment_requests;
begin
  v_org_id := public._require_owner_organization_id(p_user_id);

  select *
  into v_row
  from public.manual_payment_requests
  where id = p_request_id
    and organization_id = v_org_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;

  update public.manual_payment_requests
  set status = 'canceled'
  where id = p_request_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.billing_cancel_manual_payment_request(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.billing_cancel_manual_payment_request(uuid, uuid)
  to service_role;

-- -----------------------------------------------------------------------------
-- admin_approve_manual_payment (service_role)
-- -----------------------------------------------------------------------------
create or replace function public.admin_approve_manual_payment(
  p_request_id uuid,
  p_admin_user_id uuid,
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req public.manual_payment_requests;
  v_sub public.organization_subscriptions;
  v_plan public.subscription_plans;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_days integer;
  v_is_suspended boolean;
  v_new_status text;
begin
  perform public._assert_platform_admin(p_admin_user_id);

  if p_admin_note is not null and char_length(p_admin_note) > 500 then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  select *
  into v_req
  from public.manual_payment_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_req.status = 'approved' then
    return jsonb_build_object(
      'already_processed', true,
      'request', to_jsonb(v_req)
    );
  end if;

  if v_req.status <> 'pending' then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;

  select *
  into v_sub
  from public.organization_subscriptions
  where organization_id = v_req.organization_id
  for update;

  if not found then
    raise exception 'SUBSCRIPTION_NOT_FOUND' using errcode = 'P0001';
  end if;

  select *
  into v_plan
  from public.subscription_plans
  where id = v_req.plan_id;

  if not found or v_plan.is_active is distinct from true then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_req.billing_months is null
     or v_req.billing_months < 1
     or v_req.billing_months > 12 then
    raise exception 'PAYMENT_AMOUNT_MISMATCH' using errcode = 'P0001';
  end if;

  if v_req.plan_id is distinct from v_plan.id
     or v_req.currency is distinct from v_plan.currency
     or v_req.amount is distinct from (v_plan.price_amount * v_req.billing_months) then
    raise exception 'PAYMENT_AMOUNT_MISMATCH' using errcode = 'P0001';
  end if;

  v_is_suspended := v_sub.status = 'suspended';
  v_days := v_req.billing_months * 30;
  v_period_start := public._subscription_period_base(v_sub);
  v_period_end := v_period_start + make_interval(days => v_days);
  v_new_status := case when v_is_suspended then 'suspended' else 'active' end;

  update public.organization_subscriptions
  set
    status = v_new_status,
    status_before_suspension = case
      when v_is_suspended then 'active'
      else status_before_suspension
    end,
    current_period_start = v_period_start,
    current_period_end = v_period_end,
    grace_period_ends_at = null,
    cancel_at_period_end = false,
    canceled_at = null,
    payment_provider = 'manual_kaspi',
    last_payment_status = 'paid',
    updated_at = now()
  where organization_id = v_req.organization_id;

  update public.manual_payment_requests
  set
    status = 'approved',
    reviewed_by_user_id = p_admin_user_id,
    reviewed_at = now(),
    admin_note = nullif(trim(coalesce(p_admin_note, '')), ''),
    approved_period_start = v_period_start,
    approved_period_end = v_period_end
  where id = p_request_id
  returning * into v_req;

  perform public._write_admin_audit(
    p_admin_user_id,
    'PAYMENT_APPROVED',
    v_req.organization_id,
    v_req.id,
    jsonb_build_object(
      'amount', v_req.amount,
      'currency', v_req.currency,
      'billing_months', v_req.billing_months
    )
  );

  perform public._write_admin_audit(
    p_admin_user_id,
    'SUBSCRIPTION_EXTENDED',
    v_req.organization_id,
    v_req.id,
    jsonb_build_object(
      'period_start', v_period_start,
      'period_end', v_period_end,
      'days', v_days
    )
  );

  return jsonb_build_object(
    'already_processed', false,
    'request', to_jsonb(v_req),
    'period_start', v_period_start,
    'period_end', v_period_end
  );
end;
$$;

revoke all on function public.admin_approve_manual_payment(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_approve_manual_payment(uuid, uuid, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- admin_reject_manual_payment (service_role)
-- -----------------------------------------------------------------------------
create or replace function public.admin_reject_manual_payment(
  p_request_id uuid,
  p_admin_user_id uuid,
  p_admin_note text
)
returns public.manual_payment_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req public.manual_payment_requests;
begin
  perform public._assert_platform_admin(p_admin_user_id);

  if trim(coalesce(p_admin_note, '')) = '' then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  if char_length(trim(p_admin_note)) > 500 then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  select *
  into v_req
  from public.manual_payment_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;

  update public.manual_payment_requests
  set
    status = 'rejected',
    reviewed_by_user_id = p_admin_user_id,
    reviewed_at = now(),
    admin_note = trim(p_admin_note)
  where id = p_request_id
  returning * into v_req;

  perform public._write_admin_audit(
    p_admin_user_id,
    'PAYMENT_REJECTED',
    v_req.organization_id,
    v_req.id,
    jsonb_build_object('admin_note', v_req.admin_note)
  );

  return v_req;
end;
$$;

revoke all on function public.admin_reject_manual_payment(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_reject_manual_payment(uuid, uuid, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- admin_extend_subscription (service_role)
-- -----------------------------------------------------------------------------
create or replace function public.admin_extend_subscription(
  p_organization_id uuid,
  p_admin_user_id uuid,
  p_days integer,
  p_reason text
)
returns public.organization_subscriptions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.organization_subscriptions;
  v_base timestamptz;
  v_new_end timestamptz;
  v_is_suspended boolean;
  v_new_status text;
begin
  perform public._assert_platform_admin(p_admin_user_id);

  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  if char_length(trim(p_reason)) > 500 then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  select *
  into v_sub
  from public.organization_subscriptions
  where organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'SUBSCRIPTION_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_is_suspended := v_sub.status = 'suspended';
  v_base := public._subscription_period_base(v_sub);
  v_new_end := v_base + make_interval(days => p_days);
  v_new_status := case when v_is_suspended then 'suspended' else 'active' end;

  update public.organization_subscriptions
  set
    status = v_new_status,
    status_before_suspension = case
      when v_is_suspended then 'active'
      else status_before_suspension
    end,
    current_period_start = v_base,
    current_period_end = v_new_end,
    grace_period_ends_at = null,
    cancel_at_period_end = false,
    canceled_at = null,
    updated_at = now()
  where organization_id = p_organization_id
  returning * into v_sub;

  perform public._write_admin_audit(
    p_admin_user_id,
    'SUBSCRIPTION_EXTENDED',
    p_organization_id,
    null,
    jsonb_build_object(
      'days', p_days,
      'reason', trim(p_reason),
      'new_period_end', v_new_end
    )
  );

  return v_sub;
end;
$$;

revoke all on function public.admin_extend_subscription(uuid, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.admin_extend_subscription(uuid, uuid, integer, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- admin_suspend_organization (service_role)
-- -----------------------------------------------------------------------------
create or replace function public.admin_suspend_organization(
  p_organization_id uuid,
  p_admin_user_id uuid,
  p_reason text
)
returns public.organization_subscriptions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.organization_subscriptions;
begin
  perform public._assert_platform_admin(p_admin_user_id);

  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  if char_length(trim(p_reason)) > 500 then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  select *
  into v_sub
  from public.organization_subscriptions
  where organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'SUBSCRIPTION_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_sub.status = 'suspended' then
    return v_sub;
  end if;

  update public.organization_subscriptions
  set
    status_before_suspension = v_sub.status,
    status = 'suspended',
    suspended_at = now(),
    suspended_by_user_id = p_admin_user_id,
    suspension_reason = trim(p_reason),
    updated_at = now()
  where organization_id = p_organization_id
  returning * into v_sub;

  perform public._write_admin_audit(
    p_admin_user_id,
    'ORGANIZATION_SUSPENDED',
    p_organization_id,
    null,
    jsonb_build_object('reason', trim(p_reason))
  );

  return v_sub;
end;
$$;

revoke all on function public.admin_suspend_organization(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_suspend_organization(uuid, uuid, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- admin_unsuspend_organization (service_role)
-- -----------------------------------------------------------------------------
create or replace function public.admin_unsuspend_organization(
  p_organization_id uuid,
  p_admin_user_id uuid
)
returns public.organization_subscriptions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.organization_subscriptions;
  v_restored text;
begin
  perform public._assert_platform_admin(p_admin_user_id);

  select *
  into v_sub
  from public.organization_subscriptions
  where organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'SUBSCRIPTION_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_sub.status <> 'suspended' then
    return v_sub;
  end if;

  v_restored := coalesce(v_sub.status_before_suspension, 'expired');

  if v_restored = 'active'
     and v_sub.current_period_end is not null
     and v_sub.current_period_end > now() then
    v_restored := 'active';
  elsif v_restored = 'trialing'
        and v_sub.trial_ends_at is not null
        and v_sub.trial_ends_at > now() then
    v_restored := 'trialing';
  else
    v_restored := 'expired';
  end if;

  update public.organization_subscriptions
  set
    status = v_restored,
    status_before_suspension = null,
    suspended_at = null,
    suspended_by_user_id = null,
    suspension_reason = null,
    updated_at = now()
  where organization_id = p_organization_id
  returning * into v_sub;

  perform public._write_admin_audit(
    p_admin_user_id,
    'ORGANIZATION_UNSUSPENDED',
    p_organization_id,
    null,
    jsonb_build_object('restored_status', v_restored)
  );

  return v_sub;
end;
$$;

revoke all on function public.admin_unsuspend_organization(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_unsuspend_organization(uuid, uuid)
  to service_role;

-- -----------------------------------------------------------------------------
-- Safety checks
-- -----------------------------------------------------------------------------
do $$
declare
  v_table text;
  v_role text;
  v_fn text;
  v_confdeltype char;
  v_billing_admin_fns text[] := array[
    'billing_create_manual_payment_request(uuid, text, text, text, timestamptz, text, integer)',
    'billing_cancel_manual_payment_request(uuid, uuid)',
    'admin_approve_manual_payment(uuid, uuid, text)',
    'admin_reject_manual_payment(uuid, uuid, text)',
    'admin_extend_subscription(uuid, uuid, integer, text)',
    'admin_suspend_organization(uuid, uuid, text)',
    'admin_unsuspend_organization(uuid, uuid)'
  ];
begin
  foreach v_table in array array[
    'platform_admins',
    'manual_payment_requests',
    'platform_admin_audit_log'
  ]
  loop
    foreach v_role in array array['anon', 'authenticated']
    loop
      if has_table_privilege(v_role, 'public.' || v_table, 'SELECT') then
        raise exception
          'Migration 011 safety: % must not SELECT public.%',
          v_role,
          v_table;
      end if;
    end loop;
  end loop;

  foreach v_fn in array v_billing_admin_fns
  loop
    foreach v_role in array array['public', 'anon', 'authenticated']
    loop
      if has_function_privilege(v_role, 'public.' || v_fn, 'EXECUTE') then
        raise exception
          'Migration 011 safety: % must not EXECUTE public.%',
          v_role,
          v_fn;
      end if;
    end loop;

    if not has_function_privilege('service_role', 'public.' || v_fn, 'EXECUTE') then
      raise exception
        'Migration 011 safety: service_role must EXECUTE public.%',
        v_fn;
    end if;
  end loop;

  select c.confdeltype
  into v_confdeltype
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
  where c.contype = 'f'
    and c.conrelid = 'public.organization_subscriptions'::regclass
    and a.attname = 'suspended_by_user_id'
  limit 1;

  if v_confdeltype is distinct from 'n' then
    raise exception
      'Migration 011 safety: suspended_by_user_id must use ON DELETE SET NULL';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = '_require_owner_organization_id'
  ) then
    raise exception 'Migration 011 safety: _require_owner_organization_id missing';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = '_subscription_period_base'
  ) then
    raise exception 'Migration 011 safety: _subscription_period_base missing';
  end if;
end;
$$;
