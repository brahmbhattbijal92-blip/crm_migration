BEGIN;

ALTER TABLE public.financial_invoice_payments
  ADD COLUMN IF NOT EXISTS reverses_payment_id uuid,
  ADD COLUMN IF NOT EXISTS reversal_reason text;

ALTER TABLE public.financial_invoice_payments
  DROP CONSTRAINT IF EXISTS financial_invoice_payments_amount_check,
  DROP CONSTRAINT IF EXISTS financial_invoice_payments_amount_reversal_check,
  DROP CONSTRAINT IF EXISTS financial_invoice_payments_reversal_reason_check,
  DROP CONSTRAINT IF EXISTS financial_invoice_payments_reversal_fk;

ALTER TABLE public.financial_invoice_payments
  ADD CONSTRAINT financial_invoice_payments_amount_reversal_check
    CHECK (
      (amount > 0 AND reverses_payment_id IS NULL AND reversal_reason IS NULL)
      OR
      (amount < 0 AND reverses_payment_id IS NOT NULL AND reversal_reason IS NOT NULL
        AND length(trim(reversal_reason)) BETWEEN 1 AND 500)
    );

CREATE UNIQUE INDEX IF NOT EXISTS financial_invoice_payments_org_invoice_id_uidx
  ON public.financial_invoice_payments (organization_id, invoice_id, id);

ALTER TABLE public.financial_invoice_payments
  ADD CONSTRAINT financial_invoice_payments_reversal_fk
    FOREIGN KEY (organization_id, invoice_id, reverses_payment_id)
    REFERENCES public.financial_invoice_payments (organization_id, invoice_id, id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS financial_invoice_payments_one_reversal_per_payment_idx
  ON public.financial_invoice_payments (reverses_payment_id)
  WHERE reverses_payment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reverse_invoice_payment(
  requested_payment_id uuid,
  requested_reason text
)
RETURNS SETOF public.financial_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  active_organization_id uuid := app.current_organization_id();
  invoice_client_id uuid;
  target_invoice_id uuid;
  client_purge_locked_at timestamptz;
  invoice_status text;
  invoice_amount numeric(14, 2);
  grant_amount numeric(14, 2);
  current_due numeric(14, 2);
  payment_amount numeric(14, 2);
  new_due numeric(14, 2);
  updated_invoice public.financial_invoices;
  normalized_reason text := trim(requested_reason);
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sign in before reversing a payment.';
  END IF;
  IF active_organization_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships AS memberships
    WHERE memberships.organization_id = active_organization_id
      AND memberships.user_id = actor_id
      AND memberships.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Organization owner or admin access is required to reverse a payment.';
  END IF;
  IF normalized_reason IS NULL OR length(normalized_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Enter a reversal reason of 1 to 500 characters.';
  END IF;

  SELECT payments.client_id, payments.invoice_id
    INTO invoice_client_id, target_invoice_id
    FROM public.financial_invoice_payments AS payments
    WHERE payments.id = requested_payment_id
      AND payments.organization_id = active_organization_id
      AND payments.amount > 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment was not found or is not reversible.'; END IF;

  SELECT clients.purge_locked_at
    INTO client_purge_locked_at
    FROM public.clients AS clients
    WHERE clients.id = invoice_client_id
      AND clients.organization_id = active_organization_id
    FOR UPDATE;
  IF NOT FOUND OR client_purge_locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Payment client is unavailable or locked for purge.';
  END IF;

  SELECT invoices.status, invoices.amount, invoices.grant_applied_amount, invoices.amount_due
    INTO invoice_status, invoice_amount, grant_amount, current_due
    FROM public.financial_invoices AS invoices
    WHERE invoices.id = target_invoice_id
      AND invoices.organization_id = active_organization_id
      AND invoices.deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice was not found in your organization.'; END IF;
  IF invoice_status = 'void' THEN RAISE EXCEPTION 'A voided invoice cannot have a payment reversed.'; END IF;

  SELECT payments.amount INTO payment_amount
    FROM public.financial_invoice_payments AS payments
    WHERE payments.id = requested_payment_id
      AND payments.organization_id = active_organization_id
      AND payments.invoice_id = target_invoice_id
      AND payments.amount > 0
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment was not found or is not reversible.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.financial_invoice_payments AS reversals
    WHERE reversals.reverses_payment_id = requested_payment_id
  ) THEN
    RAISE EXCEPTION 'This payment has already been reversed.';
  END IF;

  INSERT INTO public.financial_invoice_payments (
    organization_id, client_id, invoice_id, amount, paid_at, created_by,
    reverses_payment_id, reversal_reason
  ) VALUES (
    active_organization_id, invoice_client_id, target_invoice_id,
    -payment_amount, now(), actor_id, requested_payment_id, normalized_reason
  );

  new_due := least(greatest(invoice_amount - grant_amount, 0), current_due + payment_amount);
  UPDATE public.financial_invoices
    SET amount_due = new_due,
        status = CASE WHEN new_due = 0 THEN 'paid' ELSE 'outstanding' END,
        updated_at = now()
    WHERE id = target_invoice_id AND organization_id = active_organization_id
    RETURNING * INTO updated_invoice;

  RETURN NEXT updated_invoice;
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.void_invoice(
  requested_invoice_id uuid,
  requested_reason text
)
RETURNS SETOF public.financial_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  active_organization_id uuid := app.current_organization_id();
  invoice_client_id uuid;
  invoice_number text;
  invoice_currency char(3);
  invoice_status text;
  invoice_grant_amount numeric(14, 2);
  client_purge_locked_at timestamptz;
  updated_invoice public.financial_invoices;
  normalized_reason text := trim(requested_reason);
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sign in before voiding an invoice.';
  END IF;
  IF active_organization_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships AS memberships
    WHERE memberships.organization_id = active_organization_id
      AND memberships.user_id = actor_id
      AND memberships.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Organization owner or admin access is required to void an invoice.';
  END IF;
  IF normalized_reason IS NULL OR length(normalized_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Enter a void reason of 1 to 500 characters.';
  END IF;

  SELECT invoices.client_id
    INTO invoice_client_id
    FROM public.financial_invoices AS invoices
    WHERE invoices.id = requested_invoice_id
      AND invoices.organization_id = active_organization_id
      AND invoices.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice was not found in your organization.'; END IF;

  SELECT clients.purge_locked_at
    INTO client_purge_locked_at
    FROM public.clients AS clients
    WHERE clients.id = invoice_client_id
      AND clients.organization_id = active_organization_id
    FOR UPDATE;
  IF NOT FOUND OR client_purge_locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invoice client is unavailable or locked for purge.';
  END IF;

  SELECT invoices.status, invoices.invoice_number, invoices.currency, invoices.grant_applied_amount
    INTO invoice_status, invoice_number, invoice_currency, invoice_grant_amount
    FROM public.financial_invoices AS invoices
    WHERE invoices.id = requested_invoice_id
      AND invoices.organization_id = active_organization_id
      AND invoices.deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice was not found in your organization.'; END IF;
  IF invoice_status = 'void' THEN RAISE EXCEPTION 'Invoice is already void.'; END IF;

  INSERT INTO public.financial_invoice_payments (
    organization_id, client_id, invoice_id, amount, paid_at, created_by,
    reverses_payment_id, reversal_reason
  )
  SELECT active_organization_id, invoice_client_id, requested_invoice_id,
         -payments.amount, now(), actor_id, payments.id, normalized_reason
    FROM public.financial_invoice_payments AS payments
    WHERE payments.organization_id = active_organization_id
      AND payments.invoice_id = requested_invoice_id
      AND payments.amount > 0
      AND NOT EXISTS (
        SELECT 1
        FROM public.financial_invoice_payments AS reversals
        WHERE reversals.reverses_payment_id = payments.id
      )
    ORDER BY payments.created_at, payments.id;

  IF invoice_grant_amount > 0 THEN
    INSERT INTO public.grants_ledger (
      organization_id, client_id, entry_type, amount, currency, grant_source,
      allocation_date, reference, description, created_by
    ) VALUES (
      active_organization_id, invoice_client_id, 'credit', invoice_grant_amount,
      invoice_currency, 'Invoice void reversal', CURRENT_DATE, invoice_number,
      normalized_reason, actor_id
    );

    INSERT INTO public.client_grant_balances (
      organization_id, client_id, currency, available_balance
    ) VALUES (
      active_organization_id, invoice_client_id, invoice_currency, invoice_grant_amount
    )
    ON CONFLICT (organization_id, client_id, currency) DO UPDATE
      SET available_balance = public.client_grant_balances.available_balance + EXCLUDED.available_balance,
          updated_at = now();
  END IF;

  UPDATE public.financial_invoices
    SET status = 'void', amount_due = 0, updated_at = now()
    WHERE id = requested_invoice_id AND organization_id = active_organization_id
    RETURNING * INTO updated_invoice;

  RETURN NEXT updated_invoice;
  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.reverse_invoice_payment(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.void_invoice(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_invoice_payment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_invoice(uuid, text) TO authenticated;

COMMIT;