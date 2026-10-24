-- Сценарии миграции 023 (перерывы, выходные, блоки, другие часы)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000023', 'timeoff@test.kz');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000023', false);

do $$
declare
  v_org uuid;
  v_service uuid;
  v_staff uuid;
  v_day date := current_date + 3;
  v_dow integer := (extract(dow from current_date + 3)::integer + 6) % 7;
  v_failed text;
begin
  v_org := (public.create_organization('Салон 023', 'barbershop')->>'id')::uuid;
  update public.organizations set timezone = 'UTC' where id = v_org;

  insert into public.services (organization_id, name, duration_minutes, price)
  values (v_org, 'Стрижка', 60, 5000) returning id into v_service;
  insert into public.staff (organization_id, name) values (v_org, 'Ерлан') returning id into v_staff;
  insert into public.staff_services (organization_id, staff_id, service_id) values (v_org, v_staff, v_service);
  insert into public.staff_schedules (organization_id, staff_id, day_of_week, is_working, start_time, end_time, break_start, break_end)
  values (v_org, v_staff, v_dow, true, '10:00', '20:00', '13:00', '14:00')
  on conflict (staff_id, day_of_week) do update
    set is_working = true, start_time = '10:00', end_time = '20:00', break_start = '13:00', break_end = '14:00';
  -- День после — выходной по графику (для проверки «других часов»)
  update public.staff_schedules set is_working = false, start_time = null, end_time = null
  where staff_id = v_staff and day_of_week = (v_dow + 1) % 7;

  -- Обычная онлайн-запись проходит
  insert into public.bookings (organization_id, service_id, staff_id, client_name, client_phone, booking_date, start_time, end_time, source)
  values (v_org, v_service, v_staff, 'Алан', '+77001234567', v_day, '10:00', '11:00', 'public_booking');

  -- Онлайн на перерыв — нельзя
  v_failed := null;
  begin
    insert into public.bookings (organization_id, service_id, staff_id, client_name, client_phone, booking_date, start_time, end_time, source)
    values (v_org, v_service, v_staff, 'Дана', '+77001234568', v_day, '12:30', '13:30', 'public_booking');
  exception when others then v_failed := sqlerrm;
  end;
  assert v_failed like '%BOOKING_OUTSIDE_SCHEDULE%', 'online booking in break rejected: ' || coalesce(v_failed, 'passed');

  -- Владелец из кабинета на перерыв — может
  insert into public.bookings (organization_id, service_id, staff_id, client_name, client_phone, booking_date, start_time, end_time, source)
  values (v_org, v_service, v_staff, 'Свой', '+77001234569', v_day, '13:00', '13:00', 'manual');

  -- Блок 16:00–18:00 — онлайн нельзя
  insert into public.staff_time_off (organization_id, staff_id, kind, date_from, date_to, start_time, end_time, note)
  values (v_org, v_staff, 'block', v_day, v_day, '16:00', '18:00', 'Личное');
  v_failed := null;
  begin
    insert into public.bookings (organization_id, service_id, staff_id, client_name, client_phone, booking_date, start_time, end_time, source)
    values (v_org, v_service, v_staff, 'Тимур', '+77001234570', v_day, '17:00', '18:00', 'public_booking');
  exception when others then v_failed := sqlerrm;
  end;
  assert v_failed like '%BOOKING_OUTSIDE_SCHEDULE%', 'online booking in block rejected';

  -- Другие часы на следующий день недели (выходной по графику) — можно работать
  insert into public.staff_time_off (organization_id, staff_id, kind, date_from, date_to, start_time, end_time)
  values (v_org, v_staff, 'hours', v_day + 1, v_day + 1, '12:00', '15:00');
  insert into public.bookings (organization_id, service_id, staff_id, client_name, client_phone, booking_date, start_time, end_time, source)
  values (v_org, v_service, v_staff, 'Руслан', '+77001234571', v_day + 1, '12:00', '13:00', 'public_booking');
  v_failed := null;
  begin
    insert into public.bookings (organization_id, service_id, staff_id, client_name, client_phone, booking_date, start_time, end_time, source)
    values (v_org, v_service, v_staff, 'Ильяс', '+77001234572', v_day + 1, '15:00', '16:00', 'manual');
  exception when others then v_failed := sqlerrm;
  end;
  assert v_failed like '%BOOKING_OUTSIDE_SCHEDULE%', 'outside custom hours rejected';

  -- Отпуск — нельзя никому
  insert into public.staff_time_off (organization_id, staff_id, kind, date_from, date_to, note)
  values (v_org, v_staff, 'off', v_day + 7, v_day + 14, 'Отпуск');
  v_failed := null;
  begin
    insert into public.bookings (organization_id, service_id, staff_id, client_name, client_phone, booking_date, start_time, end_time, source)
    values (v_org, v_service, v_staff, 'Нурлан', '+77001234573', v_day + 7, '10:00', '10:00', 'manual');
  exception when others then v_failed := sqlerrm;
  end;
  assert v_failed like '%BOOKING_STAFF_DAY_OFF%', 'vacation rejected: ' || coalesce(v_failed, 'passed');

  -- Неверные данные исключения отклоняются
  v_failed := null;
  begin
    insert into public.staff_time_off (organization_id, staff_id, kind, date_from, date_to) values (v_org, v_staff, 'block', v_day, v_day);
  exception when check_violation then v_failed := 'ok';
  end;
  assert v_failed = 'ok', 'block without time rejected';

  v_failed := null;
  begin
    update public.staff_schedules set is_working = true, start_time = '10:00', end_time = '20:00', break_start = '14:00', break_end = '13:00'
    where staff_id = v_staff and day_of_week = (v_dow + 2) % 7;
  exception when check_violation then v_failed := 'ok';
  end;
  assert v_failed = 'ok', 'break end before start rejected';
end;
$$;

select set_config('request.jwt.claim.sub', '', false);
