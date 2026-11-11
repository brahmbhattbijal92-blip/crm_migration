BEGIN;

GRANT SELECT (purge_locked_at)
  ON public.clients TO authenticated;

COMMIT;