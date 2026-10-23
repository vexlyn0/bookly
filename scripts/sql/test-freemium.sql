-- Сценарии freemium (выполняются после 001–015)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@test.kz'),
  ('00000000-0000-0000-0000-000000000002', 'other@test.kz');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);

do $$
declare
  v_org json;
  v_org_id uuid;
  v_ent record;
  v_paused integer;
  v_failed boolean;
  i integer;
begin
  v_org := public.create_organization('Салон Тест', 'beauty_salon');
  v_org_id := (v_org->>'id')::uuid;
  assert v_org->>'timezone' = 'Asia/Almaty', 'default timezone Almaty';

  select * into v_ent from public.get_organization_entitlements(v_org_id);
  assert v_ent.plan_code = 'free', 'new org is free: ' || coalesce(v_ent.plan_code, 'null');
  assert v_ent.staff_limit = 5, 'free staff limit 5';
  assert v_ent.trial_available, 'trial available for new org';
  assert v_ent.show_branding, 'branding on free';

  -- Free может работать с услугами (раньше без подписки было запрещено)
  insert into public.services (organization_id, name, duration_minutes) values (v_org_id, 'Стрижка', 60);

  for i in 1..5 loop
    insert into public.staff (organization_id, name, created_at)
    values (v_org_id, 'Мастер ' || i, now() - ((10 - i) || ' minutes')::interval);
  end loop;

  v_failed := false;
  begin
    insert into public.staff (organization_id, name) values (v_org_id, 'Мастер 6');
  exception when others then
    v_failed := sqlerrm like '%STAFF_LIMIT_REACHED%';
  end;
  assert v_failed, '6th active staff blocked on free';

  -- Неактивного шестого добавить можно, включить — нельзя
  insert into public.staff (organization_id, name, is_active) values (v_org_id, 'Мастер 6', false);
  v_failed := false;
  begin
    update public.staff set is_active = true where organization_id = v_org_id and name = 'Мастер 6';
  exception when others then
    v_failed := sqlerrm like '%STAFF_LIMIT_REACHED%';
  end;
  assert v_failed, 'activating 6th blocked on free';

  -- Пробный Pro
  perform public.billing_start_pro_trial('00000000-0000-0000-0000-000000000001');
  select * into v_ent from public.get_organization_entitlements(v_org_id);
  assert v_ent.plan_code = 'pro' and v_ent.is_trial, 'trial makes pro';
  assert v_ent.staff_limit is null, 'no staff limit on pro';
  assert not v_ent.show_branding, 'no branding on pro';
  assert v_ent.days_remaining = 14, 'trial 14 days: ' || v_ent.days_remaining;
  assert not v_ent.trial_available, 'trial no longer available';

  update public.staff set is_active = true where organization_id = v_org_id and name = 'Мастер 6';
  insert into public.staff (organization_id, name, created_at) values (v_org_id, 'Мастер 7', now());

  -- Повторный trial запрещён
  v_failed := false;
  begin
    perform public.billing_start_pro_trial('00000000-0000-0000-0000-000000000001');
  exception when others then
    v_failed := sqlerrm like '%ALREADY_PRO%';
  end;
  assert v_failed, 'cannot start trial while pro';

  -- Trial закончился → Free, пауза самых новых мастеров
  update public.organization_subscriptions
  set trial_ends_at = now() - interval '1 minute'
  where organization_id = v_org_id;

  v_paused := public._apply_free_plan_limits(v_org_id);
  assert v_paused = 2, 'paused 2 newest: ' || v_paused;
  assert (select count(*) from public.staff where organization_id = v_org_id and is_active) = 5, '5 active remain';
  assert not (select is_active from public.staff where organization_id = v_org_id and name = 'Мастер 7'), 'newest paused';
  assert (select is_active from public.staff where organization_id = v_org_id and name = 'Мастер 1'), 'oldest kept';

  select * into v_ent from public.get_organization_entitlements(v_org_id);
  assert v_ent.plan_code = 'free' and not v_ent.trial_available, 'free again, trial used';

  v_failed := false;
  begin
    perform public.billing_start_pro_trial('00000000-0000-0000-0000-000000000001');
  exception when others then
    v_failed := sqlerrm like '%TRIAL_ALREADY_USED%';
  end;
  assert v_failed, 'second trial rejected';

  -- Приостановка блокирует изменения
  update public.organization_subscriptions set status = 'suspended' where organization_id = v_org_id;
  v_failed := false;
  begin
    insert into public.services (organization_id, name, duration_minutes) values (v_org_id, 'Окрашивание', 60);
  exception when others then
    v_failed := sqlerrm like '%ORGANIZATION_SUSPENDED%';
  end;
  assert v_failed, 'suspended blocks writes';

  select * into v_ent from public.get_organization_entitlements(v_org_id);
  assert v_ent.is_suspended and not v_ent.trial_available, 'suspended flags';

  raise notice 'ALL FREEMIUM SCENARIOS PASSED';
end;
$$;

-- Чужой пользователь не видит entitlements
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$
declare v_failed boolean := false;
begin
  begin
    perform * from public.get_organization_entitlements((select id from public.organizations limit 1));
  exception when others then
    v_failed := sqlerrm like '%FORBIDDEN%';
  end;
  assert v_failed, 'foreign user forbidden';
  raise notice 'MEMBERSHIP CHECK PASSED';
end;
$$;

select 'done' as result;
