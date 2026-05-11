-- 2026-05-11  Workflow C — Publish + Distribution: csj publish-state columns
--
-- Why: Workflow C (Content Studio Publish + Distribution) needs two columns
-- on content_studio_jobs to capture the outcome of the publish step:
--   - `published_at`     when the full_complete transition fires
--   - `publish_metadata` per-surface outcome json (WP/LinkedIn/YouTube)
--
-- Step 0.5 recon (2026-05-11) confirmed these columns are absent
-- (PGRST204 from PostgREST). Other expected columns
-- (linkedin_post_id, linkedin_posted_at, wordpress_slug,
-- wordpress_status, youtube_url, youtube_video_id, buzzsprout_url,
-- buzzsprout_episode_id, error_message) are already present.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS so the migration can be
-- re-applied without error if it was partially applied.
--
-- Project: fdabygmromuqtysitodp (main QClaw Supabase).
-- Companion doc: QCLAW_BUILD_LOG.md "2026-05-11 — Content Studio Workflow C"

BEGIN;

ALTER TABLE public.content_studio_jobs
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

ALTER TABLE public.content_studio_jobs
  ADD COLUMN IF NOT EXISTS publish_metadata jsonb
  DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.content_studio_jobs.published_at IS
  'Set by Workflow C when full_complete transition fires. '
  'NULL until then. May be NULL even after full_complete if '
  'all 3 publish surfaces failed (caller still wants to mark '
  'terminal state).';

COMMENT ON COLUMN public.content_studio_jobs.publish_metadata IS
  'JSON shape: {wp_status, wp_slug, wp_error, li_status, '
  'li_post_id, li_url, li_error, yt_status, yt_url, yt_error, '
  'failed_surfaces: text[]}. Written by Workflow C.';

COMMIT;
