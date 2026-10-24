-- Сценарии миграции 024 (профиль салона: контакты, фото, «Наши работы»)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000024', 'profile@test.kz');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000024', false);

do $$
declare
  v_org uuid;
  v_failed text;
  i integer;
begin
  v_org := (public.create_organization('Салон 024', 'beauty_salon')->>'id')::uuid;

  -- Контакты и фото сохраняются
  update public.organizations
  set instagram = '@salon.024', whatsapp = '+7 701 000 00 00',
      gis_url = 'https://2gis.kz/almaty/firm/1', logo_url = 'https://cdn.test/logo.webp'
  where id = v_org;

  -- Ссылка не на https — нельзя
  v_failed := null;
  begin
    update public.organizations set gis_url = 'javascript:alert(1)' where id = v_org;
  exception when others then v_failed := sqlerrm;
  end;
  assert v_failed like '%organizations_profile_check%', 'non-https link rejected: ' || coalesce(v_failed, 'passed');

  -- Фото услуги и «популярное»
  insert into public.services (organization_id, name, duration_minutes, price, photo_url, is_popular, category)
  values (v_org, 'Маникюр', 90, 8000, 'https://cdn.test/s.webp', true, 'Ногти');

  -- «Наши работы»: до 24 фото
  for i in 1..24 loop
    insert into public.portfolio_photos (organization_id, url) values (v_org, 'https://cdn.test/p' || i || '.webp');
  end loop;
  v_failed := null;
  begin
    insert into public.portfolio_photos (organization_id, url) values (v_org, 'https://cdn.test/p25.webp');
  exception when others then v_failed := sqlerrm;
  end;
  assert v_failed like '%PORTFOLIO_LIMIT%', 'portfolio limit 24: ' || coalesce(v_failed, 'passed');

  -- Хранилище: папка — id салона
  assert (storage.foldername(v_org::text || '/cover/1.webp'))[1] = v_org::text, 'first folder is organization id';
  assert exists (select 1 from storage.buckets where id = 'media' and public = true), 'media bucket is public';
end;
$$;
