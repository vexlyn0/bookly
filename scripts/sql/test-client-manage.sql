-- Сценарии миграции 016 (личная ссылка клиента на запись)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000016', 'manage@test.kz');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000016', false);

do $$
declare
  v_org uuid;
  v_service uuid;
  v_staff uuid;
  v_token text;
  v_token2 text;
  v_failed boolean;
begin
  v_org := (public.create_organization('Салон 016', 'beauty_salon')->>'id')::uuid;

  assert (select client_manage_cutoff_hours from public.organizations where id = v_org) = 2,
    'default cutoff 2 hours';

  insert into public.services (organization_id, name, duration_minutes)
  values (v_org, 'Маникюр', 60) returning id into v_service;
  insert into public.staff (organization_id, name, is_active)
  values (v_org, 'Мастер 016', false) returning id into v_staff;

  -- Запись без проверок триггера (прошлое/график не важны для теста токена)
  alter table public.bookings disable trigger user;
  insert into public.bookings (organization_id, service_id, staff_id, client_name, client_phone,
    booking_date, start_time, end_time)
  values (v_org, v_service, v_staff, 'Клиент', '+77001234567', current_date, '10:00', '11:00')
  returning manage_token into v_token;
  insert into public.bookings (organization_id, service_id, staff_id, client_name, client_phone,
    booking_date, start_time, end_time)
  values (v_org, v_service, v_staff, 'Клиент 2', '+77001234568', current_date, '12:00', '13:00')
  returning manage_token into v_token2;
  alter table public.bookings enable trigger user;

  assert v_token ~ '^[0-9a-f]{32}$', 'token is 32 hex: ' || v_token;
  assert v_token <> v_token2, 'tokens differ';
  assert (select client_reschedule_count from public.bookings where manage_token = v_token) = 0,
    'reschedule count starts at 0';

  v_failed := false;
  begin
    update public.organizations set client_manage_cutoff_hours = 500 where id = v_org;
  exception when check_violation then
    v_failed := true;
  end;
  assert v_failed, 'cutoff over 168 rejected';

  update public.organizations set client_manage_cutoff_hours = null where id = v_org;
  update public.organizations set client_manage_cutoff_hours = 2 where id = v_org;
end;
$$;

select set_config('request.jwt.claim.sub', '', false);
