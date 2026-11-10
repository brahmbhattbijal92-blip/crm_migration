BEGIN;

GRANT SELECT (assigned_agent_id) ON public.clients TO authenticated;

COMMIT;
