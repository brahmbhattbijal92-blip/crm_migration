BEGIN;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS clients_org_assigned_agent_idx
  ON public.clients (organization_id, assigned_agent_id, updated_at DESC);

CREATE OR REPLACE FUNCTION app.can_access_client(target_organization_id uuid, target_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, app
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.clients AS clients
    JOIN public.organization_memberships AS memberships
      ON memberships.organization_id = clients.organization_id
     AND memberships.user_id = auth.uid()
    WHERE clients.organization_id = target_organization_id
      AND clients.id = target_client_id
      AND target_organization_id = app.current_organization_id()
      AND memberships.role <> 'inactive'
      AND memberships.removed_at IS NULL
      AND (
        memberships.role IN ('owner', 'admin')
        OR (
          memberships.role = 'agent'
          AND (
            clients.assigned_agent_id = auth.uid()
            OR (clients.assigned_agent_id IS NULL AND clients.created_by = auth.uid())
          )
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION app.can_access_client(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.can_access_client(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app.enforce_client_data_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, app
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND (
    (TG_OP <> 'INSERT' AND NOT app.can_access_client(OLD.organization_id, OLD.client_id))
    OR NOT app.can_access_client(NEW.organization_id, NEW.client_id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'You do not have access to this client data.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION app.enforce_client_data_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.enforce_client_data_access() TO authenticated, service_role;

DO $function$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'documents',
    'credentials_vault',
    'financial_invoices',
    'financial_invoice_payments',
    'grants_ledger',
    'client_grant_balances',
    'financial_ledger'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS enforce_client_data_access ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER enforce_client_data_access BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.enforce_client_data_access()',
      table_name
    );
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION app.enforce_client_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, app
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.assigned_agent_id := NULL;
  ELSE
    NEW.created_by := OLD.created_by;
    IF NOT app.is_organization_admin(OLD.organization_id) THEN
      NEW.assigned_agent_id := OLD.assigned_agent_id;
    ELSIF NEW.assigned_agent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships AS memberships
    WHERE memberships.organization_id = NEW.organization_id
      AND memberships.user_id = NEW.assigned_agent_id
      AND memberships.role = 'agent'
      AND memberships.removed_at IS NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Clients can only be assigned to an active organization agent.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS clients_enforce_ownership ON public.clients;
CREATE TRIGGER clients_enforce_ownership
  BEFORE INSERT OR UPDATE OF created_by, assigned_agent_id ON public.clients
  FOR EACH ROW EXECUTE FUNCTION app.enforce_client_ownership();

CREATE OR REPLACE FUNCTION public.assign_client_to_agent(
  requested_client_id uuid,
  requested_agent_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  active_organization_id uuid := app.current_organization_id();
BEGIN
  IF auth.uid() IS NULL OR active_organization_id IS NULL
    OR NOT app.is_organization_admin(active_organization_id)
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only an organization owner or administrator can assign clients.';
  END IF;

  IF requested_agent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships AS memberships
    WHERE memberships.organization_id = active_organization_id
      AND memberships.user_id = requested_agent_id
      AND memberships.role = 'agent'
      AND memberships.removed_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Choose an active agent in this organization.';
  END IF;

  UPDATE public.clients
    SET assigned_agent_id = requested_agent_id
    WHERE organization_id = active_organization_id
      AND id = requested_client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Client was not found in this organization.';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.assign_client_to_agent(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_client_to_agent(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app.storage_path_is_accessible(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, app
AS $function$
  SELECT CASE
    WHEN split_part(object_name, '/', 1) <> app.current_organization_id()::text THEN false
    WHEN split_part(object_name, '/', 2) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN false
    ELSE app.can_access_client(
      app.current_organization_id(),
      split_part(object_name, '/', 2)::uuid
    )
  END;
$function$;

REVOKE ALL ON FUNCTION app.storage_path_is_accessible(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.storage_path_is_accessible(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app.storage_path_targets_active_client(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, app
AS $function$
  SELECT CASE
    WHEN NOT app.storage_path_is_accessible(object_name) THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.clients AS clients
      WHERE clients.organization_id = app.current_organization_id()
        AND clients.id = split_part(object_name, '/', 2)::uuid
        AND clients.status <> 'archived'
        AND clients.deleted_at IS NULL
        AND clients.purge_locked_at IS NULL
    )
  END;
$function$;

DROP POLICY IF EXISTS clients_read_tenant ON public.clients;
CREATE POLICY clients_read_tenant ON public.clients
  FOR SELECT TO authenticated
  USING (organization_id = app.current_organization_id() AND app.can_access_client(organization_id, id));

DROP POLICY IF EXISTS clients_insert_tenant ON public.clients;
CREATE POLICY clients_insert_tenant ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
  );

DROP POLICY IF EXISTS clients_update_tenant ON public.clients;
CREATE POLICY clients_update_tenant ON public.clients
  FOR UPDATE TO authenticated
  USING (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
    AND app.can_access_client(organization_id, id)
  )
  WITH CHECK (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
    AND app.can_access_client(organization_id, id)
  );

DROP POLICY IF EXISTS documents_read_tenant ON public.documents;
CREATE POLICY documents_read_tenant ON public.documents
  FOR SELECT TO authenticated
  USING (
    organization_id = app.current_organization_id()
    AND app.can_access_client(organization_id, client_id)
  );

DROP POLICY IF EXISTS documents_insert_tenant ON public.documents;
CREATE POLICY documents_insert_tenant ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
    AND app.can_access_client(organization_id, client_id)
    AND EXISTS (
      SELECT 1 FROM public.clients AS clients
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
    AND app.can_access_client(organization_id, client_id)
  )
  WITH CHECK (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
    AND app.can_access_client(organization_id, client_id)
    AND EXISTS (
      SELECT 1 FROM public.clients AS clients
      WHERE clients.id = documents.client_id
        AND clients.organization_id = documents.organization_id
        AND clients.status <> 'archived'
        AND clients.deleted_at IS NULL
        AND clients.purge_locked_at IS NULL
    )
  );

DROP POLICY IF EXISTS credentials_vault_read_tenant ON public.credentials_vault;
CREATE POLICY credentials_vault_read_tenant ON public.credentials_vault
  FOR SELECT TO authenticated
  USING (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
    AND app.can_access_client(organization_id, client_id)
  );

DROP POLICY IF EXISTS credentials_vault_insert_tenant ON public.credentials_vault;
CREATE POLICY credentials_vault_insert_tenant ON public.credentials_vault
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
    AND app.can_access_client(organization_id, client_id)
  );

DROP POLICY IF EXISTS credentials_vault_update_tenant ON public.credentials_vault;
CREATE POLICY credentials_vault_update_tenant ON public.credentials_vault
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
  );

DROP POLICY IF EXISTS financial_invoices_read_tenant ON public.financial_invoices;
CREATE POLICY financial_invoices_read_tenant ON public.financial_invoices
  FOR SELECT TO authenticated
  USING (
    organization_id = app.current_organization_id()
    AND app.can_access_client(organization_id, client_id)
  );

DROP POLICY IF EXISTS financial_invoices_update_tenant ON public.financial_invoices;
CREATE POLICY financial_invoices_update_tenant ON public.financial_invoices
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
  );

DROP POLICY IF EXISTS financial_invoice_payments_read_tenant ON public.financial_invoice_payments;
CREATE POLICY financial_invoice_payments_read_tenant ON public.financial_invoice_payments
  FOR SELECT TO authenticated
  USING (
    organization_id = app.current_organization_id()
    AND app.can_access_client(organization_id, client_id)
  );

DROP POLICY IF EXISTS grants_ledger_read_tenant ON public.grants_ledger;
CREATE POLICY grants_ledger_read_tenant ON public.grants_ledger
  FOR SELECT TO authenticated
  USING (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
    AND app.can_access_client(organization_id, client_id)
  );

DROP POLICY IF EXISTS client_grant_balances_read_tenant ON public.client_grant_balances;
CREATE POLICY client_grant_balances_read_tenant ON public.client_grant_balances
  FOR SELECT TO authenticated
  USING (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
    AND app.can_access_client(organization_id, client_id)
  );

DROP POLICY IF EXISTS financial_ledger_read_tenant ON public.financial_ledger;
CREATE POLICY financial_ledger_read_tenant ON public.financial_ledger
  FOR SELECT TO authenticated
  USING (
    organization_id = app.current_organization_id()
    AND app.can_access_client(organization_id, client_id)
  );

DROP POLICY IF EXISTS governance_notifications_agent_read ON public.governance_notifications;
CREATE POLICY governance_notifications_agent_read ON public.governance_notifications
  FOR SELECT TO authenticated
  USING (
    organization_id = app.current_organization_id()
    AND app.can_access_client(organization_id, client_id)
    AND (
      recipient_user_id = auth.uid()
      OR app.is_organization_admin(organization_id)
    )
  );

DROP POLICY IF EXISTS governance_notifications_agent_update ON public.governance_notifications;
CREATE POLICY governance_notifications_agent_update ON public.governance_notifications
  FOR UPDATE TO authenticated
  USING (
    organization_id = app.current_organization_id()
    AND recipient_user_id = auth.uid()
    AND app.can_access_client(organization_id, client_id)
  )
  WITH CHECK (
    organization_id = app.current_organization_id()
    AND recipient_user_id = auth.uid()
    AND app.can_access_client(organization_id, client_id)
  );

DROP POLICY IF EXISTS client_documents_read_tenant ON storage.objects;
CREATE POLICY client_documents_read_tenant ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND app.storage_path_is_accessible(name)
  );

CREATE OR REPLACE FUNCTION public.archive_client(requested_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  active_organization_id uuid := app.current_organization_id();
BEGIN
  IF active_organization_id IS NULL
    OR NOT app.can_manage_organization_data(active_organization_id)
    OR NOT app.can_access_client(active_organization_id, requested_client_id)
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'You do not have access to archive this client.';
  END IF;

  UPDATE public.clients
    SET status = 'archived', archived_at = coalesce(archived_at, now()), deleted_at = coalesce(deleted_at, now())
    WHERE id = requested_client_id
      AND organization_id = active_organization_id
      AND status <> 'archived'
      AND purge_locked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active client was not found or is locked for purge.'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_archived_client(requested_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  active_organization_id uuid := app.current_organization_id();
BEGIN
  IF active_organization_id IS NULL
    OR NOT app.can_manage_organization_data(active_organization_id)
    OR NOT app.can_access_client(active_organization_id, requested_client_id)
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'You do not have access to restore this client.';
  END IF;

  UPDATE public.clients
    SET status = 'active', archived_at = NULL, deleted_at = NULL
    WHERE id = requested_client_id
      AND organization_id = active_organization_id
      AND status = 'archived'
      AND purge_locked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Archived client was not found or is locked for purge.'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_client_document_uploadable(requested_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  active_organization_id uuid := app.current_organization_id();
BEGIN
  IF auth.uid() IS NULL OR active_organization_id IS NULL
    OR NOT app.can_manage_organization_data(active_organization_id)
    OR NOT app.can_access_client(active_organization_id, requested_client_id)
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'You do not have access to upload documents for this client.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.clients AS clients
    WHERE clients.id = requested_client_id
      AND clients.organization_id = active_organization_id
      AND clients.status <> 'archived'
      AND clients.deleted_at IS NULL
      AND clients.purge_locked_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Client is archived, deleted, locked for purge, or unavailable.';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.archive_client(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_archived_client(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assert_client_document_uploadable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_client(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_archived_client(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_client_document_uploadable(uuid) TO authenticated;

COMMIT;
