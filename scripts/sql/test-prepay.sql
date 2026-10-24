-- Сценарии миграции 025 (предоплата Kaspi)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000025', 'prepay@test.kz');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000025', false);

do $$
declare
  v_org uuid;
  v_failed text;
begin
  v_org := (public.create_organization('Салон 025', 'beauty_salon')->>'id')::uuid;

  update public.organizations
  set kaspi_phone = '+7 701 000 00 00', kaspi_name = 'Айгерим Б.', prepay_hold_minutes = 15
  where id = v_org;

  -- Держать можно только 15 / 30 / 60 минут
  v_failed := null;
  begin
    update public.organizations set prepay_hold_minutes = 5 where id = v_org;
  exception when others then v_failed := sqlerrm;
  end;
  assert v_failed like '%organizations_prepay_check%', 'hold minutes limited: ' || coalesce(v_failed, 'passed');

  -- Услуга: фиксированная и процентная предоплата
  insert into public.services (organization_id, name, duration_minutes, price, prepay_type, prepay_value)
  values (v_org, 'Тату', 120, 40000, 'fixed', 5000);
  insert into public.services (organization_id, name, duration_minutes, price, prepay_type, prepay_value)
  values (v_org, 'Наращивание', 120, 15000, 'percent', 30);

  -- Процент больше 100 — нельзя
  v_failed := null;
  begin
    insert into public.services (organization_id, name, duration_minutes, price, prepay_type, prepay_value)
    values (v_org, 'Ошибка', 60, 5000, 'percent', 150);
  exception when others then v_failed := sqlerrm;
  end;
  assert v_failed like '%services_prepay_check%', 'percent over 100 rejected: ' || coalesce(v_failed, 'passed');

  -- Фиксированная без суммы — нельзя
  v_failed := null;
  begin
    insert into public.services (organization_id, name, duration_minutes, price, prepay_type)
    values (v_org, 'Ошибка 2', 60, 5000, 'fixed');
  exception when others then v_failed := sqlerrm;
  end;
  assert v_failed like '%services_prepay_check%', 'fixed without value rejected: ' || coalesce(v_failed, 'passed');
end;
$$;
