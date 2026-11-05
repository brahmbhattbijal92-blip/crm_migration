BEGIN;

CREATE OR REPLACE FUNCTION public.assert_client_document_uploadable(requested_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  active_organization_id uuid := app.current_organization_id();
BEGIN
  IF auth.uid() IS NULL
    OR active_organization_id IS NULL
    OR NOT app.can_manage_organization_data(active_organization_id)
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Agent or administrator access is required to upload client documents.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.clients AS clients
    WHERE clients.id = requested_client_id
      AND clients.organization_id = active_organization_id
      AND clients.status <> 'archived'
      AND clients.deleted_at IS NULL
      AND clients.purge_locked_at IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Client is archived, deleted, locked for purge, or unavailable.';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_client_document_uploadable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_client_document_uploadable(uuid) TO authenticated;

COMMIT;