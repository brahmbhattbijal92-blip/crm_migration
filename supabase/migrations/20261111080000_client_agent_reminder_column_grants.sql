BEGIN;

GRANT SELECT (agent_reminder_date, agent_reminder_note)
  ON public.clients TO authenticated;
GRANT UPDATE (agent_reminder_date, agent_reminder_note)
  ON public.clients TO authenticated;

COMMIT;