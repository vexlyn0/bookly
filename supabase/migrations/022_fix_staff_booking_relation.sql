-- =============================================================================
-- Bookly — Миграция 022: исправление после 021
-- Выполните в Supabase Dashboard → SQL Editor
-- Требует: 001–021
--
-- В 021 у staff.pending_amount_booking_id был внешний ключ на bookings.
-- Из-за него между bookings и staff стало две связи, и запросы
-- «запись + staff(name)» в Supabase перестали работать (ambiguous embed):
-- ломались список записей, карточка салона в админке, уведомления.
-- Оставляем колонку, убираем внешний ключ — связь снова одна.
-- =============================================================================

begin;

alter table public.staff
  drop constraint if exists staff_pending_amount_booking_id_fkey;

commit;

-- Supabase (PostgREST) кеширует схему — просим перечитать её сразу.
notify pgrst, 'reload schema';
