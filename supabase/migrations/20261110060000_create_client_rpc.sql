BEGIN;

CREATE OR REPLACE FUNCTION public.create_client(
  requested_first_name text,
  requested_last_name text,
  requested_email text,
  requested_company text DEFAULT NULL,
  requested_passport_expires_at date DEFAULT NULL,
  requested_visa_subclass text DEFAULT NULL,
  requested_visa_expires_at date DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  first_name text,
  last_name text,
  email text,
  company text,
  status text,
  archived_at timestamptz,
  created_at timestamptz,
  last_interaction_at timestamptz,
  updated_at timestamptz,
  passport_expires_at date,
  visa_subclass text,
  visa_expires_at date,
  assigned_agent_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  active_organization_id uuid := app.current_organization_id();
BEGIN
  IF actor_id IS NULL
    OR active_organization_id IS NULL
    OR NOT app.can_manage_organization_data(active_organization_id)
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'An active owner, administrator, or agent membership is required to add clients.';
  END IF;

  RETURN QUERY
    INSERT INTO public.clients (
      organization_id,
      first_name,
      last_name,
      email,
      company,
      passport_expires_at,
      visa_subclass,
      visa_expires_at
    ) VALUES (
      active_organization_id,
      requested_first_name,
      requested_last_name,
      requested_email,
      requested_company,
      requested_passport_expires_at,
      requested_visa_subclass,
      requested_visa_expires_at
    )
    RETURNING
      clients.id,
      clients.first_name,
      clients.last_name,
      clients.email,
      clients.company,
      clients.status,
      clients.archived_at,
      clients.created_at,
      clients.last_interaction_at,
      clients.updated_at,
      clients.passport_expires_at,
      clients.visa_subclass,
      clients.visa_expires_at,
      clients.assigned_agent_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_client(text, text, text, text, date, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_client(text, text, text, text, date, text, date) TO authenticated;

COMMIT;
