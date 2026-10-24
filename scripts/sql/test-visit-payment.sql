-- Сценарии миграции 021 (цена в записи, оплата визита)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000021', 'visit@test.kz');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000021', false);

do $$
declare
  v_org uuid;
  v_cut uuid;
  v_beard uuid;
  v_staff uuid;
  v_booking uuid;
  v_row record;
begin
  v_org := (public.create_organization('Салон 021', 'barbershop')->>'id')::uuid;
  insert into public.services (organization_id, name, duration_minutes, price)
  values (v_org, 'Стрижка', 60, 5000) returning id into v_cut;
  insert into public.services (organization_id, name, duration_minutes, price)
  values (v_org, 'Борода', 30, 3000) returning id into v_beard;
  insert into public.staff (organization_id, name, is_active)
  values (v_org, 'Мастер 021', false) returning id into v_staff;

  alter table public.bookings disable trigger bookings_validate;

  insert into public.bookings (organization_id, service_id, staff_id, client_name, client_phone,
    booking_date, start_time, end_time)
  values (v_org, v_cut, v_staff, 'Алан', '+77001234567', current_date, '10:00', '11:00')
  returning id into v_booking;

  select * into v_row from public.bookings where id = v_booking;
  assert v_row.price = 5000, 'price snapshot on insert: ' || coalesce(v_row.price::text, 'null');

  -- Смена прайса не трогает запись
  update public.services set price = 6000 where id = v_cut;
  assert (select price from public.bookings where id = v_booking) = 5000, 'price kept after price change';

  -- Смена услуги — цена новой услуги
  update public.bookings set service_id = v_beard where id = v_booking;
  assert (select price from public.bookings where id = v_booking) = 3000, 'price follows new service';

  -- Завершение с суммой
  update public.bookings set status = 'completed', paid_amount = 4500 where id = v_booking;
  select * into v_row from public.bookings where id = v_booking;
  assert v_row.completed_at is not null, 'completed_at set';
  assert v_row.paid_amount = 4500, 'paid amount saved';

  -- Вернули в «подтверждена» — оплата сбрасывается
  update public.bookings set status = 'confirmed' where id = v_booking;
  select * into v_row from public.bookings where id = v_booking;
  assert v_row.completed_at is null and v_row.paid_amount is null, 'payment reset when un-completed';

  alter table public.bookings enable trigger bookings_validate;
end;
$$;

select set_config('request.jwt.claim.sub', '', false);
