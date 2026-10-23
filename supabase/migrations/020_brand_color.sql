-- =============================================================================
-- Bookly — Миграция 020: фирменный цвет салона на странице записи
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001–019
-- =============================================================================

begin;

alter table public.organizations
  add column if not exists brand_color text not null default '#534AB7';

alter table public.organizations
  drop constraint if exists organizations_brand_color_check;

alter table public.organizations
  add constraint organizations_brand_color_check
  check (brand_color ~ '^#[0-9A-Fa-f]{6}$');

commit;
