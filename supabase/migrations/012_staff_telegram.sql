-- =============================================================================
-- Bookly — Миграция 012: Staff Telegram
-- Добавление chat_id для уведомлений
-- =============================================================================

alter table public.staff 
add column if not exists telegram_chat_id text;

create index if not exists idx_staff_telegram_chat_id on public.staff(telegram_chat_id);
