-- Сценарии миграции 017 (ключ телефона, чёрный список)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000017', 'limits@test.kz'),
  ('00000000-0000-0000-0000-000000000018', 'stranger@test.kz');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000017', false);

do $$
declare
  v_org uuid;
  v_failed boolean;
begin
  assert public.phone_key('8 701 123-45-67') = '77011234567', 'kz 8 prefix';
  assert public.phone_key('+7 (701) 123 45 67') = '77011234567', 'plus seven';
  assert public.phone_key('701 123 45 67') = '77011234567', 'ten digits';
  assert public.phone_key(null) = '', 'null phone';

  v_org := (public.create_organization('Салон 017', 'barbershop')->>'id')::uuid;

  insert into public.client_blacklist (organization_id, phone, client_name)
  values (v_org, '8 701 123-45-67', 'Хулиган');

  assert (select phone_key from public.client_blacklist where organization_id = v_org) = '77011234567',
    'blacklist key';

  v_failed := false;
  begin
    insert into public.client_blacklist (organization_id, phone) values (v_org, '+77011234567');
  exception when unique_violation then
    v_failed := true;
  end;
  assert v_failed, 'same number in other format is a duplicate';
end;
$$;

-- RLS: чужой пользователь не видит и не может добавить в чужой список
select set_config('test.org017', (select id::text from public.organizations where name = 'Салон 017'), false);
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000018', false);

do $$
declare
  v_failed boolean := false;
begin
  assert (select count(*) from public.client_blacklist) = 0, 'stranger sees nothing';
  begin
    insert into public.client_blacklist (organization_id, phone)
    values (current_setting('test.org017')::uuid, '+77000000000');
  exception when insufficient_privilege then
    v_failed := true;
  end;
  assert v_failed, 'stranger cannot insert into foreign blacklist';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000017', false);

do $$
begin
  assert (select count(*) from public.client_blacklist) = 1, 'owner sees own blacklist';
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
