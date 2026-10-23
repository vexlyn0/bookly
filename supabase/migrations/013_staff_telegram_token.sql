-- =============================================================================
-- Bookly — Миграция 013: Staff Telegram Link Token
-- Добавление токена для привязки через бота
-- =============================================================================

alter table public.staff 
add column if not exists telegram_link_token text;

create index if not exists idx_staff_telegram_token on public.staff(telegram_link_token);
