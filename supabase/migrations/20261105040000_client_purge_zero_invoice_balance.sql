BEGIN;

CREATE OR REPLACE FUNCTION app.begin_client_purge(requested_client_ids uuid[])
RETURNS TABLE(client_id uuid, bucket_id text, storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, app
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  tenant_id uuid := app.current_organization_id();
  requested_count integer;
  found_count integer;
  claimable_count integer;
BEGIN
  IF actor_id IS NULL OR tenant_id IS NULL OR NOT app.is_organization_admin(tenant_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Purge requires an authenticated organization administrator.';
  END IF;
  IF requested_client_ids IS NULL OR cardinality(requested_client_ids) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'At least one client must be selected for purge.';
  END IF;

  SELECT count(DISTINCT requested_id)::integer
    INTO requested_count
    FROM unnest(requested_client_ids) AS requested(requested_id);

  PERFORM clients.id
    FROM public.clients AS clients
    WHERE clients.organization_id = tenant_id
      AND clients.id = ANY(requested_client_ids)
    ORDER BY clients.id
    FOR UPDATE;

  SELECT count(*)::integer
    INTO found_count
    FROM public.clients AS clients
    WHERE clients.organization_id = tenant_id
      AND clients.id = ANY(requested_client_ids);
  IF found_count <> requested_count THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'One or more selected clients were not found in this organization.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.clients AS clients
    WHERE clients.organization_id = tenant_id
      AND clients.id = ANY(requested_client_ids)
      AND (
        clients.status <> 'archived'
        OR clients.archived_at IS NULL
        OR clients.archived_at > now() - interval '90 days'
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Retention period has not elapsed for one or more archived clients.';
  END IF;

  IF EXISTS (
    SELECT invoices.client_id, invoices.currency
    FROM public.financial_invoices AS invoices
    WHERE invoices.organization_id = tenant_id
      AND invoices.client_id = ANY(requested_client_ids)
      AND invoices.deleted_at IS NULL
    GROUP BY invoices.client_id, invoices.currency
    HAVING sum(invoices.amount_due) <> 0
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'COMPLIANCE_PURGE_BLOCKED: Each currency must have a net outstanding invoice balance of exactly zero.';
  END IF;

  SELECT count(*)::integer
    INTO claimable_count
    FROM public.clients AS clients
    WHERE clients.organization_id = tenant_id
      AND clients.id = ANY(requested_client_ids)
      AND (clients.purge_locked_by IS NULL OR clients.purge_locked_by = actor_id);
  IF claimable_count <> requested_count THEN
    RAISE EXCEPTION USING ERRCODE = '55P03', MESSAGE = 'One or more selected clients are already being purged by another administrator.';
  END IF;

  UPDATE public.clients AS clients
    SET purge_locked_at = coalesce(clients.purge_locked_at, now()),
        purge_locked_by = actor_id
    WHERE clients.organization_id = tenant_id
      AND clients.id = ANY(requested_client_ids);

  RETURN QUERY
    SELECT documents.client_id, documents.bucket_id, documents.storage_path
    FROM public.documents AS documents
    WHERE documents.organization_id = tenant_id
      AND documents.client_id = ANY(requested_client_ids)
      AND documents.deleted_at IS NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION app.finalize_client_purge(requested_client_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, app
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  tenant_id uuid := app.current_organization_id();
  requested_count integer;
  locked_count integer;
  deleted_count integer;
BEGIN
  IF actor_id IS NULL OR tenant_id IS NULL OR NOT app.is_organization_admin(tenant_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Purge requires an authenticated organization administrator.';
  END IF;
  IF requested_client_ids IS NULL OR cardinality(requested_client_ids) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'At least one client must be selected for purge.';
  END IF;

  SELECT count(DISTINCT requested_id)::integer
    INTO requested_count
    FROM unnest(requested_client_ids) AS requested(requested_id);

  PERFORM clients.id
    FROM public.clients AS clients
    WHERE clients.organization_id = tenant_id
      AND clients.id = ANY(requested_client_ids)
    ORDER BY clients.id
    FOR UPDATE;

  SELECT count(*)::integer
    INTO locked_count
    FROM public.clients AS clients
    WHERE clients.organization_id = tenant_id
      AND clients.id = ANY(requested_client_ids)
      AND clients.purge_locked_by = actor_id;
  IF locked_count <> requested_count THEN
    RAISE EXCEPTION USING ERRCODE = '55P03', MESSAGE = 'Purge lock is missing or belongs to another administrator.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.clients AS clients
    WHERE clients.organization_id = tenant_id
      AND clients.id = ANY(requested_client_ids)
      AND (
        clients.status <> 'archived'
        OR clients.archived_at IS NULL
        OR clients.archived_at > now() - interval '90 days'
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Retention period has not elapsed for one or more archived clients.';
  END IF;

  IF EXISTS (
    SELECT invoices.client_id, invoices.currency
    FROM public.financial_invoices AS invoices
    WHERE invoices.organization_id = tenant_id
      AND invoices.client_id = ANY(requested_client_ids)
      AND invoices.deleted_at IS NULL
    GROUP BY invoices.client_id, invoices.currency
    HAVING sum(invoices.amount_due) <> 0
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'COMPLIANCE_PURGE_BLOCKED: Each currency must have a net outstanding invoice balance of exactly zero.';
  END IF;

  DELETE FROM public.clients AS clients
    WHERE clients.organization_id = tenant_id
      AND clients.id = ANY(requested_client_ids)
      AND clients.purge_locked_by = actor_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count <> requested_count THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Purge did not delete every selected client.';
  END IF;

  RETURN deleted_count;
END;
$function$;

COMMIT;