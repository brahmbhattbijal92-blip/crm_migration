BEGIN;

DROP POLICY IF EXISTS documents_insert_tenant ON public.documents;
CREATE POLICY documents_insert_tenant ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
    AND app.can_access_client(organization_id, client_id)
    AND public.client_document_upload_allowed(client_id, organization_id)
  );

DROP POLICY IF EXISTS documents_update_tenant ON public.documents;
CREATE POLICY documents_update_tenant ON public.documents
  FOR UPDATE TO authenticated
  USING (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
    AND app.can_access_client(organization_id, client_id)
  )
  WITH CHECK (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
    AND app.can_access_client(organization_id, client_id)
    AND public.client_document_upload_allowed(client_id, organization_id)
  );

REVOKE SELECT (purge_locked_at) ON public.clients FROM authenticated;

COMMIT;