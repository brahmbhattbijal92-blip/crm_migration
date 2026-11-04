BEGIN;

CREATE INDEX IF NOT EXISTS clients_org_archived_page_idx
  ON public.clients (organization_id, updated_at DESC, id DESC)
  WHERE status = 'archived' OR deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS financial_invoices_org_client_due_page_idx
  ON public.financial_invoices (organization_id, client_id, due_at, id)
  INCLUDE (invoice_number, amount, currency, status, grant_applied_amount, amount_due)
  WHERE deleted_at IS NULL;

REVOKE ALL PRIVILEGES ON TABLE public.clients FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  organization_id,
  first_name,
  last_name,
  email,
  company,
  status,
  archived_at,
  created_at,
  last_interaction_at,
  updated_at,
  passport_expires_at,
  visa_subclass,
  visa_expires_at,
  deleted_at
) ON public.clients TO authenticated;
GRANT INSERT (
  organization_id,
  first_name,
  last_name,
  email,
  company,
  passport_expires_at,
  visa_subclass,
  visa_expires_at
) ON public.clients TO authenticated;
GRANT UPDATE (
  first_name,
  last_name,
  email,
  company,
  passport_expires_at,
  visa_subclass,
  visa_expires_at
) ON public.clients TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.credentials_vault FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, client_id, portal_name, last_verified, deleted_at)
  ON public.credentials_vault TO authenticated;

CREATE OR REPLACE FUNCTION public.get_client_financial_summary(requested_client_id uuid)
RETURNS TABLE (
  invoice_count bigint,
  overdue_invoice_count bigint,
  grant_count bigint,
  outstanding_by_currency jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT
    (
      SELECT count(*)
      FROM public.financial_invoices AS invoices
      WHERE invoices.organization_id = app.current_organization_id()
        AND invoices.client_id = requested_client_id
        AND invoices.deleted_at IS NULL
    ),
    (
      SELECT count(*)
      FROM public.financial_invoices AS invoices
      WHERE invoices.organization_id = app.current_organization_id()
        AND invoices.client_id = requested_client_id
        AND invoices.deleted_at IS NULL
        AND invoices.status = 'overdue'
    ),
    (
      SELECT count(*)
      FROM public.grants_ledger AS grants
      WHERE grants.organization_id = app.current_organization_id()
        AND grants.client_id = requested_client_id
    ),
    coalesce((
      SELECT jsonb_agg(jsonb_build_object('currency', totals.currency, 'amount', totals.amount))
      FROM (
        SELECT invoices.currency, sum(invoices.amount_due) AS amount
        FROM public.financial_invoices AS invoices
        WHERE invoices.organization_id = app.current_organization_id()
          AND invoices.client_id = requested_client_id
          AND invoices.deleted_at IS NULL
          AND invoices.amount_due > 0
        GROUP BY invoices.currency
      ) AS totals
    ), '[]'::jsonb);
$function$;

REVOKE ALL ON FUNCTION public.get_client_financial_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_financial_summary(uuid) TO authenticated;

COMMIT;