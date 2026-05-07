BEGIN;

-- ζ.5: drop allow_anon_all on content_studio_jobs, replace
-- with service-role-only policy. Per ζ.4 (commit bc66c17),
-- all 9 writers in the Content Studio Pipeline workflow now
-- authenticate as service_role via the Supabase Main Service
-- Role credential. service_role bypasses RLS by default;
-- explicit policy makes the intent durable + reviewable.

DROP POLICY IF EXISTS allow_anon_all ON public.content_studio_jobs;

CREATE POLICY content_studio_jobs_service_role_all
  ON public.content_studio_jobs
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ζ.6: re-enable RLS on clip_jobs and charlie_tasks. These
-- were rolled back to RLS-off yesterday (commit 3bda7f2)
-- because their writers (clipper-worker, Charlie - Task
-- Handler workflow) were authenticating as anon and would
-- have been blocked. ζ.1 + ζ.3 switched both consumers to
-- service_role, so RLS-on now blocks anon while letting
-- legitimate service_role writes through unblocked.

ALTER TABLE public.clip_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.charlie_tasks ENABLE ROW LEVEL SECURITY;

-- No explicit policies needed for clip_jobs + charlie_tasks
-- yet — service_role bypasses RLS by default on tables with
-- no policies, which is what we want for these tables (no
-- anon or authenticated consumers should ever touch them).
-- If/when a non-service-role consumer is added, a policy
-- gets added in a follow-up migration.

COMMIT;
