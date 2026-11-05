BEGIN;

CREATE OR REPLACE FUNCTION app.prevent_document_during_client_purge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  active_organization_id uuid := app.current_organization_id();
  client_status text;
  client_purge_locked_at timestamptz;
  client_deleted_at timestamptz;
BEGIN
  IF auth.uid() IS NULL
    OR NEW.organization_id IS DISTINCT FROM active_organization_id
    OR NOT app.can_manage_organization_data(NEW.organization_id)
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Agent or administrator access is required to add client documents.';
  END IF;

  SELECT clients.status, clients.purge_locked_at, clients.deleted_at
    INTO client_status, client_purge_locked_at, client_deleted_at
    FROM public.clients AS clients
    WHERE clients.id = NEW.client_id
      AND clients.organization_id = NEW.organization_id
    FOR UPDATE;

  IF NOT FOUND OR client_status = 'archived' OR client_purge_locked_at IS NOT NULL OR client_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Documents cannot be added to an archived, deleted, or purge-locked client.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION app.prevent_document_during_client_purge() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.client_document_upload_allowed(
  requested_client_id uuid,
  requested_organization_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND requested_organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(requested_organization_id)
    AND EXISTS (
      SELECT 1
      FROM public.clients AS clients
      WHERE clients.id = requested_client_id
        AND clients.organization_id = requested_organization_id
        AND clients.status <> 'archived'
        AND clients.deleted_at IS NULL
        AND clients.purge_locked_at IS NULL
    );
$function$;

REVOKE ALL ON FUNCTION public.client_document_upload_allowed(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_document_upload_allowed(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS documents_insert_tenant ON public.documents;
CREATE POLICY documents_insert_tenant ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
    AND public.client_document_upload_allowed(client_id, organization_id)
  );

DROP POLICY IF EXISTS documents_update_tenant ON public.documents;
CREATE POLICY documents_update_tenant ON public.documents
  FOR UPDATE TO authenticated
  USING (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
  )
  WITH CHECK (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
    AND public.client_document_upload_allowed(client_id, organization_id)
  );

COMMIT;