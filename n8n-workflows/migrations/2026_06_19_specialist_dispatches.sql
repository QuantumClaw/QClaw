-- Slice 6b — specialist dispatch infrastructure (specialist_dispatches)
-- Supabase project: fdabygmromuqtysitodp
--
-- Mirrors the claude_code_dispatches lockdown pattern (RLS enable+force+revoke,
-- service_role only, updated_at touch trigger with pinned search_path).
--
-- Applied 2026-06-19 via Supabase apply_migration: slice6b_specialist_dispatches.
-- Verified live: relrowsecurity=t, relforcerowsecurity=t, no anon/authenticated
-- grants, 16 columns, indexes idx_sd_poll + idx_sd_surface, trigger trg_sd_touch.
-- This file is the source of record.
--
-- v1 (Slice 6b): all 15 specialists are stubs that route back WITHOUT writing
-- here (delegate_to returns stub_routed_back synchronously). Only a LIVE
-- specialist — gated by the delegate_to QCLAW_SPECIALIST_LIVE_IDS allowlist,
-- which is EMPTY in 6b — ever inserts a row. No RPCs in v1; live specialist
-- execution (Slice 6d) adds claim/reap RPCs if/when needed.
--
-- session_id is the server-derived channel:userId (the tool never trusts an
-- args-supplied value). Writes use the service_role key; the table is RLS-locked.

create table if not exists public.specialist_dispatches (
  id uuid primary key default gen_random_uuid(),
  task_id uuid unique not null default gen_random_uuid(),   -- returned to Charlie
  specialist_id text not null,                              -- matches SpecialistEntry.id (FLOW_OS_SPECIALISTS.md)
  status text not null default 'queued'
    check (status in ('queued','in_progress','complete','failed','timeout')),
  task text not null,                                       -- the specialist instruction
  context text,
  session_id text,                                          -- Charlie turn correlation
  created_by text default 'charlie',
  result_payload jsonb,                                     -- typed result from a live specialist (Slice 6d)
  result_summary text,
  error_message text,
  attempts int not null default 0,
  timeout_seconds int not null default 300,
  surfaced_at timestamptz,                                  -- poll dedupe
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sd_poll on public.specialist_dispatches (status, created_at);
create index if not exists idx_sd_surface on public.specialist_dispatches (session_id, status, surfaced_at);

-- updated_at touch trigger (mirrors ccd_touch_updated_at; pinned search_path)
create or replace function public.sd_touch_updated_at() returns trigger
  language plpgsql set search_path = pg_catalog
  as $fn$ begin new.updated_at = now(); return new; end; $fn$;
drop trigger if exists trg_sd_touch on public.specialist_dispatches;
create trigger trg_sd_touch before update on public.specialist_dispatches
  for each row execute function public.sd_touch_updated_at();

-- RLS: enable + FORCE + revoke all non-service-role grants.
-- Grants persist independently of RLS, so REVOKE is belt-and-suspenders alongside
-- enable+force. No policies => service_role only.
alter table public.specialist_dispatches enable row level security;
alter table public.specialist_dispatches force row level security;
revoke all on public.specialist_dispatches from anon, authenticated;
