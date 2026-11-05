BEGIN;

DROP POLICY IF EXISTS documents_insert_tenant ON public.documents;
CREATE POLICY documents_insert_tenant ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
    AND EXISTS (
      SELECT 1
      FROM public.clients AS clients
      WHERE clients.id = documents.client_id
        AND clients.organization_id = documents.organization_id
        AND clients.status <> 'archived'
        AND clients.deleted_at IS NULL
        AND clients.purge_locked_at IS NULL
    )
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
    AND EXISTS (
      SELECT 1
      FROM public.clients AS clients
      WHERE clients.id = documents.client_id
        AND clients.organization_id = documents.organization_id
        AND clients.status <> 'archived'
        AND clients.deleted_at IS NULL
        AND clients.purge_locked_at IS NULL
    )
  );

DROP POLICY IF EXISTS financial_ledger_insert_tenant ON public.financial_ledger;
CREATE POLICY financial_ledger_insert_tenant ON public.financial_ledger
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
    AND EXISTS (
      SELECT 1
      FROM public.clients AS clients
      WHERE clients.id = financial_ledger.client_id
        AND clients.organization_id = financial_ledger.organization_id
    )
  );

COMMIT;