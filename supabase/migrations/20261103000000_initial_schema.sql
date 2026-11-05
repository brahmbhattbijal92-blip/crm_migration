BEGIN;

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  default_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  display_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_memberships (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'agent', 'member', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

ALTER TABLE public.organization_memberships
  DROP CONSTRAINT IF EXISTS organization_memberships_role_check;
ALTER TABLE public.organization_memberships
  ADD CONSTRAINT organization_memberships_role_check
  CHECK (role IN ('owner', 'admin', 'agent', 'member', 'viewer'));

CREATE OR REPLACE FUNCTION app.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  invited_organization_id uuid;
BEGIN
  INSERT INTO public.profiles (user_id, display_name, email)
  VALUES (
    NEW.id,
    coalesce(nullif(NEW.raw_user_meta_data ->> 'full_name', ''), ''),
    coalesce(NEW.email, '')
  )
  ON CONFLICT (user_id) DO NOTHING;

  IF NEW.invited_at IS NOT NULL THEN
    BEGIN
      invited_organization_id := nullif(NEW.raw_user_meta_data ->> 'invited_organization_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid organization invitation.';
    END;

    IF invited_organization_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.organizations WHERE id = invited_organization_id
    ) THEN
      RAISE EXCEPTION 'Invalid organization invitation.';
    END IF;

    INSERT INTO public.organization_memberships (organization_id, user_id, role)
    VALUES (invited_organization_id, NEW.id, 'agent')
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    UPDATE public.profiles
      SET default_organization_id = invited_organization_id
      WHERE user_id = NEW.id AND default_organization_id IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.handle_new_auth_user() FROM PUBLIC;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app.handle_new_auth_user();

CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  first_name text NOT NULL CHECK (length(trim(first_name)) BETWEEN 1 AND 120),
  last_name text NOT NULL CHECK (length(trim(last_name)) BETWEEN 1 AND 120),
  email text NOT NULL CHECK (length(email) <= 320),
  company text CHECK (company IS NULL OR length(company) <= 200),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'completed', 'archived')),
  passport_expires_at date,
  visa_subclass text CHECK (visa_subclass IS NULL OR length(visa_subclass) <= 40),
  visa_expires_at date,
  purge_locked_at timestamptz,
  purge_locked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_interaction_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (organization_id, id)
);

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS passport_expires_at date,
  ADD COLUMN IF NOT EXISTS visa_subclass text,
  ADD COLUMN IF NOT EXISTS visa_expires_at date,
  ADD COLUMN IF NOT EXISTS last_interaction_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS purge_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS purge_locked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
UPDATE public.clients
  SET last_interaction_at = coalesce(updated_at, created_at, now())
  WHERE last_interaction_at IS NULL;
UPDATE public.clients
  SET archived_at = coalesce(updated_at, created_at, now())
  WHERE status = 'archived' AND archived_at IS NULL;
ALTER TABLE public.clients
  ALTER COLUMN last_interaction_at SET DEFAULT now(),
  ALTER COLUMN last_interaction_at SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  bucket_id text NOT NULL DEFAULT 'client-documents',
  storage_path text NOT NULL,
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  file_size bigint NOT NULL CHECK (file_size >= 0),
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT documents_client_tenant_fk
    FOREIGN KEY (organization_id, client_id)
    REFERENCES public.clients (organization_id, id)
    ON DELETE CASCADE,
  UNIQUE (bucket_id, storage_path)
);

CREATE TABLE IF NOT EXISTS public.credentials_vault (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  portal_name text NOT NULL CHECK (length(trim(portal_name)) BETWEEN 1 AND 120),
  encrypted_username text NOT NULL,
  encrypted_password text NOT NULL,
  last_verified timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT credentials_vault_client_tenant_fk
    FOREIGN KEY (organization_id, client_id)
    REFERENCES public.clients (organization_id, id)
    ON DELETE CASCADE,
  UNIQUE (organization_id, client_id, portal_name)
);

CREATE TABLE IF NOT EXISTS public.financial_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  invoice_number text NOT NULL CHECK (length(trim(invoice_number)) BETWEEN 1 AND 80),
  amount numeric(14, 2) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid', 'void', 'overdue')),
  issued_at timestamptz,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT invoices_client_tenant_fk
    FOREIGN KEY (organization_id, client_id)
    REFERENCES public.clients (organization_id, id)
    ON DELETE CASCADE,
  UNIQUE (organization_id, invoice_number)
);

ALTER TABLE public.financial_invoices
  ADD COLUMN IF NOT EXISTS grant_applied_amount numeric(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_due numeric(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
UPDATE public.financial_invoices
  SET amount_due = CASE WHEN status IN ('paid', 'void') THEN 0 ELSE amount END
  WHERE amount_due = 0 AND amount > 0;
ALTER TABLE public.financial_invoices
  DROP CONSTRAINT IF EXISTS financial_invoices_status_check;
ALTER TABLE public.financial_invoices
  ADD CONSTRAINT financial_invoices_status_check
  CHECK (status IN ('draft', 'issued', 'outstanding', 'paid', 'void', 'overdue'));

CREATE UNIQUE INDEX IF NOT EXISTS financial_invoices_org_id_uidx
  ON public.financial_invoices (organization_id, id);

CREATE TABLE IF NOT EXISTS public.financial_invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_payments_client_tenant_fk
    FOREIGN KEY (organization_id, client_id)
    REFERENCES public.clients (organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT invoice_payments_invoice_tenant_fk
    FOREIGN KEY (organization_id, invoice_id)
    REFERENCES public.financial_invoices (organization_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS financial_invoice_payments_org_invoice_idx
  ON public.financial_invoice_payments (organization_id, invoice_id, paid_at DESC);

CREATE OR REPLACE FUNCTION app.prevent_invoice_during_client_purge()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  client_purge_started_at timestamptz;
BEGIN
  SELECT clients.purge_locked_at
    INTO client_purge_started_at
    FROM public.clients AS clients
    WHERE clients.id = NEW.client_id
      AND clients.organization_id = NEW.organization_id
    FOR UPDATE;

  IF client_purge_started_at IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Client is locked for secure purge; invoice changes are blocked.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.prevent_invoice_during_client_purge() FROM PUBLIC;
DROP TRIGGER IF EXISTS financial_invoices_block_purge_locked_client ON public.financial_invoices;
CREATE TRIGGER financial_invoices_block_purge_locked_client
  BEFORE INSERT OR UPDATE ON public.financial_invoices
  FOR EACH ROW EXECUTE FUNCTION app.prevent_invoice_during_client_purge();

CREATE TABLE IF NOT EXISTS public.grants_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('credit', 'debit', 'adjustment')),
  amount numeric(14, 2) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  reference text,
  description text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grants_ledger_client_tenant_fk
    FOREIGN KEY (organization_id, client_id)
    REFERENCES public.clients (organization_id, id)
    ON DELETE CASCADE
);

ALTER TABLE public.grants_ledger
  ADD COLUMN IF NOT EXISTS grant_source text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS allocation_date date NOT NULL DEFAULT CURRENT_DATE;

CREATE TABLE IF NOT EXISTS public.client_grant_balances (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  available_balance numeric(14, 2) NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, client_id, currency),
  CONSTRAINT client_grant_balances_client_tenant_fk
    FOREIGN KEY (organization_id, client_id)
    REFERENCES public.clients (organization_id, id)
    ON DELETE CASCADE
);

INSERT INTO public.client_grant_balances (organization_id, client_id, currency, available_balance)
  SELECT organization_id, client_id, currency,
    greatest(sum(CASE entry_type WHEN 'credit' THEN amount WHEN 'debit' THEN -amount ELSE amount END), 0)
  FROM public.grants_ledger
  GROUP BY organization_id, client_id, currency
  ON CONFLICT (organization_id, client_id, currency) DO UPDATE
    SET available_balance = EXCLUDED.available_balance, updated_at = now();

DROP FUNCTION IF EXISTS public.allocate_client_grant(uuid, numeric, text, text, date);
CREATE FUNCTION public.allocate_client_grant(
  requested_client_id uuid,
  requested_amount numeric,
  requested_currency text,
  requested_source text,
  requested_allocation_date date DEFAULT CURRENT_DATE
)
RETURNS SETOF public.grants_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := auth.uid();
  active_organization_id uuid;
  grant_entry public.grants_ledger;
  normalized_currency text := upper(trim(requested_currency));
  normalized_source text := trim(requested_source);
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION 'Sign in before allocating grant funds.'; END IF;
  active_organization_id := app.current_organization_id();
  IF active_organization_id IS NULL THEN RAISE EXCEPTION 'Join an organization before allocating grant funds.'; END IF;
  IF NOT app.can_manage_organization_data(active_organization_id) THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Agent or administrator access is required to allocate grant funds.'; END IF;
  IF requested_amount <= 0 THEN RAISE EXCEPTION 'Grant amount must be greater than zero.'; END IF;
  IF normalized_currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Currency must be a three-letter code.'; END IF;
  IF normalized_source = '' OR length(normalized_source) > 160 THEN RAISE EXCEPTION 'Enter a grant source of 1 to 160 characters.'; END IF;

  PERFORM 1 FROM public.clients
    WHERE id = requested_client_id AND organization_id = active_organization_id
      AND deleted_at IS NULL AND status <> 'archived' AND purge_locked_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active client was not found in your organization.'; END IF;

  INSERT INTO public.client_grant_balances (organization_id, client_id, currency, available_balance)
    VALUES (active_organization_id, requested_client_id, normalized_currency, requested_amount)
    ON CONFLICT (organization_id, client_id, currency) DO UPDATE
      SET available_balance = public.client_grant_balances.available_balance + EXCLUDED.available_balance,
          updated_at = now();

  INSERT INTO public.grants_ledger (
    organization_id, client_id, entry_type, amount, currency, grant_source,
    allocation_date, reference, description, created_by
  ) VALUES (
    active_organization_id, requested_client_id, 'credit', requested_amount,
    normalized_currency, normalized_source, coalesce(requested_allocation_date, CURRENT_DATE),
    normalized_source, 'Grant funds allocated', actor_id
  ) RETURNING * INTO grant_entry;

  RETURN NEXT grant_entry;
  RETURN;
END;
$$;

DROP FUNCTION IF EXISTS public.create_client_invoice(uuid, text, numeric, text, timestamptz);
CREATE FUNCTION public.create_client_invoice(
  requested_client_id uuid,
  requested_invoice_number text,
  requested_amount numeric,
  requested_currency text,
  requested_due_at timestamptz DEFAULT NULL
)
RETURNS SETOF public.financial_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := auth.uid();
  active_organization_id uuid;
  normalized_currency text := upper(trim(requested_currency));
  normalized_invoice_number text := trim(requested_invoice_number);
  current_balance numeric(14, 2) := 0;
  grant_applied numeric(14, 2) := 0;
  outstanding_amount numeric(14, 2);
  invoice_status text;
  created_invoice public.financial_invoices;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION 'Sign in before creating an invoice.'; END IF;
  active_organization_id := app.current_organization_id();
  IF active_organization_id IS NULL THEN RAISE EXCEPTION 'Join an organization before creating an invoice.'; END IF;
  IF NOT app.can_manage_organization_data(active_organization_id) THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Agent or administrator access is required to create invoices.'; END IF;
  IF requested_amount <= 0 THEN RAISE EXCEPTION 'Invoice amount must be greater than zero.'; END IF;
  IF normalized_currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Currency must be a three-letter code.'; END IF;
  IF normalized_invoice_number = '' OR length(normalized_invoice_number) > 80 THEN RAISE EXCEPTION 'Invoice number must be between 1 and 80 characters.'; END IF;

  PERFORM 1 FROM public.clients
    WHERE id = requested_client_id AND organization_id = active_organization_id
      AND deleted_at IS NULL AND status <> 'archived'
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active client was not found in your organization.'; END IF;

  SELECT available_balance INTO current_balance
    FROM public.client_grant_balances
    WHERE organization_id = active_organization_id AND client_id = requested_client_id
      AND currency = normalized_currency
    FOR UPDATE;
  current_balance := coalesce(current_balance, 0);
  grant_applied := least(current_balance, requested_amount);
  outstanding_amount := requested_amount - grant_applied;
  invoice_status := CASE WHEN outstanding_amount = 0 THEN 'paid' ELSE 'outstanding' END;

  IF grant_applied > 0 THEN
    UPDATE public.client_grant_balances
      SET available_balance = current_balance - grant_applied, updated_at = now()
      WHERE organization_id = active_organization_id AND client_id = requested_client_id
        AND currency = normalized_currency;
    INSERT INTO public.grants_ledger (
      organization_id, client_id, entry_type, amount, currency, grant_source,
      allocation_date, reference, description, created_by
    ) VALUES (
      active_organization_id, requested_client_id, 'debit', grant_applied,
      normalized_currency, 'Invoice settlement', CURRENT_DATE, normalized_invoice_number,
      'Grant funds applied to invoice', actor_id
    );
  END IF;

  INSERT INTO public.financial_invoices (
    organization_id, client_id, invoice_number, amount, currency, status,
    grant_applied_amount, amount_due, issued_at, due_at, created_by
  ) VALUES (
    active_organization_id, requested_client_id, normalized_invoice_number, requested_amount,
    normalized_currency, invoice_status, grant_applied, outstanding_amount,
    now(), requested_due_at, actor_id
  ) RETURNING * INTO created_invoice;

  RETURN NEXT created_invoice;
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_client_invoice_payment(
  requested_invoice_id uuid,
  requested_amount numeric,
  requested_paid_at timestamptz DEFAULT now()
)
RETURNS SETOF public.financial_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := auth.uid();
  active_organization_id uuid;
  invoice_client_id uuid;
  client_purge_locked_at timestamptz;
  current_due numeric(14, 2);
  new_due numeric(14, 2);
  updated_invoice public.financial_invoices;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION 'Sign in before recording payment.'; END IF;
  active_organization_id := app.current_organization_id();
  IF active_organization_id IS NULL OR NOT app.can_manage_organization_data(active_organization_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Agent or administrator access is required to record payment.';
  END IF;
  IF requested_amount IS NULL OR requested_amount <= 0 THEN RAISE EXCEPTION 'Payment amount must be greater than zero.'; END IF;

  SELECT client_id INTO invoice_client_id
    FROM public.financial_invoices
    WHERE id = requested_invoice_id AND organization_id = active_organization_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice was not found in your organization.'; END IF;

  SELECT purge_locked_at INTO client_purge_locked_at
    FROM public.clients
    WHERE id = invoice_client_id AND organization_id = active_organization_id
    FOR UPDATE;
  IF NOT FOUND OR client_purge_locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invoice client was not found or is locked for purge.';
  END IF;

  SELECT amount_due INTO current_due
    FROM public.financial_invoices
    WHERE id = requested_invoice_id AND organization_id = active_organization_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice was not found in your organization.'; END IF;
  IF current_due <= 0 THEN RAISE EXCEPTION 'Invoice has no outstanding balance.'; END IF;
  IF requested_amount > current_due THEN RAISE EXCEPTION 'Payment cannot exceed the outstanding balance.'; END IF;

  new_due := current_due - requested_amount;
  INSERT INTO public.financial_invoice_payments (
    organization_id, client_id, invoice_id, amount, paid_at, created_by
  ) VALUES (
    active_organization_id, invoice_client_id, requested_invoice_id,
    requested_amount, coalesce(requested_paid_at, now()), actor_id
  );

  UPDATE public.financial_invoices
    SET amount_due = new_due,
        status = CASE WHEN new_due = 0 THEN 'paid' ELSE 'outstanding' END
    WHERE id = requested_invoice_id AND organization_id = active_organization_id
    RETURNING * INTO updated_invoice;

  RETURN NEXT updated_invoice;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_client_grant(uuid, numeric, text, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_client_invoice(uuid, text, numeric, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_client_invoice_payment(uuid, numeric, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_client_grant(uuid, numeric, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_client_invoice(uuid, text, numeric, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_client_invoice_payment(uuid, numeric, timestamptz) TO authenticated;

CREATE TABLE IF NOT EXISTS public.governance_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('passport', 'visa')),
  expires_on date NOT NULL,
  notice_days smallint NOT NULL CHECK (notice_days IN (90, 60, 30)),
  title text NOT NULL,
  message text NOT NULL,
  delivery_status text NOT NULL DEFAULT 'simulated'
    CHECK (delivery_status IN ('queued', 'simulated', 'sent', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  read_at timestamptz,
  CONSTRAINT governance_notifications_client_tenant_fk
    FOREIGN KEY (organization_id, client_id)
    REFERENCES public.clients (organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT governance_notifications_once_per_reminder
    UNIQUE (organization_id, client_id, recipient_user_id, document_type, expires_on, notice_days)
);

CREATE INDEX IF NOT EXISTS organization_memberships_user_idx
  ON public.organization_memberships (user_id, organization_id);
CREATE INDEX IF NOT EXISTS clients_org_updated_idx
  ON public.clients (organization_id, updated_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clients_org_last_interaction_idx
  ON public.clients (organization_id, last_interaction_at ASC)
  WHERE deleted_at IS NULL AND status <> 'archived';
CREATE INDEX IF NOT EXISTS clients_org_email_idx
  ON public.clients (organization_id, lower(email))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clients_passport_expiration_idx
  ON public.clients (passport_expires_at, organization_id)
  WHERE deleted_at IS NULL AND passport_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS clients_visa_expiration_idx
  ON public.clients (visa_expires_at, organization_id)
  WHERE deleted_at IS NULL AND visa_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_org_client_created_idx
  ON public.documents (organization_id, client_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS credentials_vault_org_client_idx
  ON public.credentials_vault (organization_id, client_id, last_verified DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS financial_invoices_org_status_due_idx
  ON public.financial_invoices (organization_id, status, due_at)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS grants_ledger_org_client_created_idx
  ON public.grants_ledger (organization_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS governance_notifications_org_created_idx
  ON public.governance_notifications (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS governance_notifications_recipient_created_idx
  ON public.governance_notifications (recipient_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.set_client_activity_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.last_interaction_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS clients_set_updated_at ON public.clients;
CREATE TRIGGER clients_set_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION app.set_client_activity_timestamps();
DROP TRIGGER IF EXISTS credentials_vault_set_updated_at ON public.credentials_vault;
CREATE TRIGGER credentials_vault_set_updated_at
  BEFORE UPDATE ON public.credentials_vault
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS financial_invoices_set_updated_at ON public.financial_invoices;
CREATE TRIGGER financial_invoices_set_updated_at
  BEFORE UPDATE ON public.financial_invoices
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE OR REPLACE FUNCTION app.prevent_document_during_client_purge()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  client_status text;
  client_purge_locked_at timestamptz;
  client_deleted_at timestamptz;
BEGIN
  SELECT clients.status, clients.purge_locked_at, clients.deleted_at
    INTO client_status, client_purge_locked_at, client_deleted_at
    FROM public.clients AS clients
    WHERE clients.id = NEW.client_id AND clients.organization_id = NEW.organization_id
    FOR UPDATE;

  IF NOT FOUND OR client_status = 'archived' OR client_purge_locked_at IS NOT NULL OR client_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Documents cannot be added to an archived, deleted, or purge-locked client.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.prevent_document_during_client_purge() FROM PUBLIC;
DROP TRIGGER IF EXISTS documents_block_purge_locked_client ON public.documents;
CREATE TRIGGER documents_block_purge_locked_client
  BEFORE INSERT OR UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION app.prevent_document_during_client_purge();

CREATE OR REPLACE FUNCTION app.current_organization_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, app
AS $$
DECLARE
  actor_id uuid := auth.uid();
  requested_id uuid;
  claimed_id uuid;
  profile_default_id uuid;
BEGIN
  BEGIN
    requested_id := nullif(current_setting('app.current_organization_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    requested_id := NULL;
  END;

  IF actor_id IS NULL THEN
    RETURN requested_id;
  END IF;

  BEGIN
    claimed_id := nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    claimed_id := NULL;
  END;

  SELECT profiles.default_organization_id
    INTO profile_default_id
    FROM public.profiles AS profiles
    WHERE profiles.user_id = actor_id;

  requested_id := coalesce(requested_id, claimed_id, profile_default_id);
  IF requested_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships AS memberships
    WHERE memberships.organization_id = requested_id
      AND memberships.user_id = actor_id
  ) THEN
    RETURN NULL;
  END IF;

  RETURN requested_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.is_organization_admin(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, app
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships AS memberships
    WHERE memberships.organization_id = target_organization_id
      AND memberships.user_id = auth.uid()
      AND memberships.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION app.can_manage_organization_data(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, app
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships AS memberships
    WHERE memberships.organization_id = target_organization_id
      AND memberships.user_id = auth.uid()
      AND memberships.role IN ('owner', 'admin', 'agent')
  );
$$;

CREATE OR REPLACE FUNCTION app.storage_path_targets_active_client(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, app
AS $$
  SELECT CASE
    WHEN split_part(object_name, '/', 1) <> app.current_organization_id()::text THEN false
    WHEN split_part(object_name, '/', 2) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.clients AS clients
      WHERE clients.organization_id = app.current_organization_id()
        AND clients.id = split_part(object_name, '/', 2)::uuid
        AND clients.status <> 'archived'
        AND clients.deleted_at IS NULL
        AND clients.purge_locked_at IS NULL
    )
  END;
$$;

REVOKE ALL ON FUNCTION app.storage_path_targets_active_client(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.storage_path_targets_active_client(text) TO authenticated;

REVOKE ALL ON FUNCTION app.can_manage_organization_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_manage_organization_data(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_client(requested_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  active_organization_id uuid := app.current_organization_id();
BEGIN
  IF active_organization_id IS NULL OR NOT app.can_manage_organization_data(active_organization_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Agent or administrator access is required to archive clients.';
  END IF;

  UPDATE public.clients
    SET status = 'archived', archived_at = coalesce(archived_at, now()), deleted_at = coalesce(deleted_at, now())
    WHERE id = requested_client_id
      AND organization_id = active_organization_id
      AND status <> 'archived'
      AND purge_locked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active client was not found or is locked for purge.'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_archived_client(requested_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  active_organization_id uuid := app.current_organization_id();
BEGIN
  IF active_organization_id IS NULL OR NOT app.can_manage_organization_data(active_organization_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Agent or administrator access is required to restore clients.';
  END IF;

  UPDATE public.clients
    SET status = 'active', archived_at = NULL, deleted_at = NULL
    WHERE id = requested_client_id
      AND organization_id = active_organization_id
      AND status = 'archived'
      AND purge_locked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Archived client was not found or is locked for purge.'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_client(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_archived_client(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_client(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_archived_client(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_organization_for_current_user(organization_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  actor_id uuid := auth.uid();
  normalized_name text := trim(organization_name);
  new_organization_id uuid;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before creating an organization.';
  END IF;
  IF normalized_name IS NULL OR length(normalized_name) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'Organization name must be between 1 and 160 characters.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.organization_memberships WHERE user_id = actor_id
  ) THEN
    RAISE EXCEPTION 'This account already belongs to an organization.';
  END IF;

  INSERT INTO public.organizations (name)
    VALUES (normalized_name)
    RETURNING id INTO new_organization_id;

  INSERT INTO public.organization_memberships (organization_id, user_id, role)
    VALUES (new_organization_id, actor_id, 'owner');

  UPDATE public.profiles
    SET default_organization_id = new_organization_id
    WHERE user_id = actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile is not ready. Retry organization setup.';
  END IF;

  RETURN new_organization_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization_for_current_user(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization_for_current_user(text) TO authenticated;

CREATE OR REPLACE FUNCTION app.begin_client_purge(requested_client_ids uuid[])
RETURNS TABLE(client_id uuid, bucket_id text, storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, app
AS $$
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
    SELECT 1 FROM public.clients AS clients
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
    SELECT 1
    FROM public.financial_invoices AS invoices
    WHERE invoices.organization_id = tenant_id
      AND invoices.client_id = ANY(requested_client_ids)
      AND invoices.deleted_at IS NULL
      AND invoices.status NOT IN ('paid', 'void')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'COMPLIANCE_PURGE_BLOCKED: Resolve or void all active or unpaid invoices before purging selected accounts.';
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
$$;

CREATE OR REPLACE FUNCTION app.finalize_client_purge(requested_client_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, app
AS $$
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
    SELECT 1 FROM public.clients AS clients
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
    SELECT 1
    FROM public.financial_invoices AS invoices
    WHERE invoices.organization_id = tenant_id
      AND invoices.client_id = ANY(requested_client_ids)
      AND invoices.deleted_at IS NULL
      AND invoices.status NOT IN ('paid', 'void')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'COMPLIANCE_PURGE_BLOCKED: Resolve or void all active or unpaid invoices before purging selected accounts.';
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
$$;

CREATE OR REPLACE FUNCTION public.begin_client_purge(requested_client_ids uuid[])
RETURNS TABLE(client_id uuid, bucket_id text, storage_path text)
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $$
  SELECT * FROM app.begin_client_purge(requested_client_ids);
$$;

CREATE OR REPLACE FUNCTION public.finalize_client_purge(requested_client_ids uuid[])
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $$
  SELECT app.finalize_client_purge(requested_client_ids);
$$;

REVOKE ALL ON FUNCTION app.current_organization_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.is_organization_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.begin_client_purge(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.finalize_client_purge(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_client_purge(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_client_purge(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_organization_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.is_organization_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.begin_client_purge(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION app.finalize_client_purge(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.begin_client_purge(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_client_purge(uuid[]) TO authenticated;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO anon, authenticated, service_role;

GRANT SELECT, UPDATE (name) ON public.organizations TO authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT ON public.organization_memberships TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.organization_memberships FROM authenticated;
GRANT SELECT, INSERT ON public.clients TO authenticated;
REVOKE DELETE ON public.clients FROM authenticated;
REVOKE UPDATE ON public.clients FROM authenticated;
GRANT UPDATE (
  first_name,
  last_name,
  email,
  company,
  passport_expires_at,
  visa_subclass,
  visa_expires_at
) ON public.clients TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.documents TO authenticated;
REVOKE DELETE ON public.documents FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.credentials_vault TO authenticated;
REVOKE DELETE ON public.credentials_vault FROM authenticated;
GRANT SELECT ON public.financial_invoices TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.financial_invoices FROM authenticated;
GRANT SELECT ON public.financial_invoice_payments TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.financial_invoice_payments FROM authenticated;
GRANT SELECT ON public.grants_ledger TO authenticated;
REVOKE INSERT ON public.grants_ledger FROM authenticated;
GRANT SELECT ON public.client_grant_balances TO authenticated;
GRANT SELECT ON public.governance_notifications TO authenticated;
GRANT UPDATE (read_at) ON public.governance_notifications TO authenticated;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credentials_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grants_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_grant_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE public.clients FORCE ROW LEVEL SECURITY;
ALTER TABLE public.documents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.credentials_vault FORCE ROW LEVEL SECURITY;
ALTER TABLE public.financial_invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.financial_invoice_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.grants_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE public.client_grant_balances FORCE ROW LEVEL SECURITY;
ALTER TABLE public.governance_notifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_read_tenant ON public.organizations;
CREATE POLICY organizations_read_tenant ON public.organizations
  FOR SELECT TO authenticated
  USING (id = app.current_organization_id());
DROP POLICY IF EXISTS organizations_admin_update ON public.organizations;
CREATE POLICY organizations_admin_update ON public.organizations
  FOR UPDATE TO authenticated
  USING (id = app.current_organization_id() AND app.is_organization_admin(id))
  WITH CHECK (id = app.current_organization_id() AND app.is_organization_admin(id));

DROP POLICY IF EXISTS profiles_read_self ON public.profiles;
CREATE POLICY profiles_read_self ON public.profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS memberships_read_tenant ON public.organization_memberships;
CREATE POLICY memberships_read_tenant ON public.organization_memberships
  FOR SELECT TO authenticated
  USING (
    organization_id = app.current_organization_id()
    AND (user_id = auth.uid() OR app.is_organization_admin(organization_id))
  );
DROP POLICY IF EXISTS memberships_admin_manage ON public.organization_memberships;
CREATE POLICY memberships_admin_manage ON public.organization_memberships
  FOR ALL TO authenticated
  USING (organization_id = app.current_organization_id() AND app.is_organization_admin(organization_id))
  WITH CHECK (organization_id = app.current_organization_id() AND app.is_organization_admin(organization_id));

DROP POLICY IF EXISTS clients_tenant_access ON public.clients;
DROP POLICY IF EXISTS clients_read_tenant ON public.clients;
CREATE POLICY clients_read_tenant ON public.clients
  FOR SELECT TO authenticated
  USING (organization_id = app.current_organization_id());
DROP POLICY IF EXISTS clients_insert_tenant ON public.clients;
CREATE POLICY clients_insert_tenant ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = app.current_organization_id() AND app.can_manage_organization_data(organization_id));
DROP POLICY IF EXISTS clients_update_tenant ON public.clients;
CREATE POLICY clients_update_tenant ON public.clients
  FOR UPDATE TO authenticated
  USING (organization_id = app.current_organization_id() AND app.can_manage_organization_data(organization_id))
  WITH CHECK (organization_id = app.current_organization_id() AND app.can_manage_organization_data(organization_id));
DROP POLICY IF EXISTS documents_tenant_access ON public.documents;
DROP POLICY IF EXISTS documents_read_tenant ON public.documents;
CREATE POLICY documents_read_tenant ON public.documents
  FOR SELECT TO authenticated
  USING (organization_id = app.current_organization_id());
DROP POLICY IF EXISTS documents_insert_tenant ON public.documents;
CREATE POLICY documents_insert_tenant ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
    AND EXISTS (
      SELECT 1 FROM public.clients AS clients
      WHERE clients.id = documents.client_id
        AND clients.organization_id = documents.organization_id
        AND clients.status <> 'archived' AND clients.deleted_at IS NULL AND clients.purge_locked_at IS NULL
    )
  );
DROP POLICY IF EXISTS documents_update_tenant ON public.documents;
CREATE POLICY documents_update_tenant ON public.documents
  FOR UPDATE TO authenticated
  USING (organization_id = app.current_organization_id() AND app.can_manage_organization_data(organization_id))
  WITH CHECK (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
    AND EXISTS (
      SELECT 1 FROM public.clients AS clients
      WHERE clients.id = documents.client_id
        AND clients.organization_id = documents.organization_id
        AND clients.status <> 'archived' AND clients.deleted_at IS NULL AND clients.purge_locked_at IS NULL
    )
  );
DROP POLICY IF EXISTS credentials_vault_tenant_access ON public.credentials_vault;
DROP POLICY IF EXISTS credentials_vault_read_tenant ON public.credentials_vault;
CREATE POLICY credentials_vault_read_tenant ON public.credentials_vault
  FOR SELECT TO authenticated
  USING (organization_id = app.current_organization_id() AND app.can_manage_organization_data(organization_id));
DROP POLICY IF EXISTS credentials_vault_insert_tenant ON public.credentials_vault;
CREATE POLICY credentials_vault_insert_tenant ON public.credentials_vault
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = app.current_organization_id() AND app.can_manage_organization_data(organization_id));
DROP POLICY IF EXISTS credentials_vault_update_tenant ON public.credentials_vault;
CREATE POLICY credentials_vault_update_tenant ON public.credentials_vault
  FOR UPDATE TO authenticated
  USING (organization_id = app.current_organization_id() AND app.can_manage_organization_data(organization_id))
  WITH CHECK (organization_id = app.current_organization_id() AND app.can_manage_organization_data(organization_id));
DROP POLICY IF EXISTS financial_invoices_tenant_access ON public.financial_invoices;
DROP POLICY IF EXISTS financial_invoices_read_tenant ON public.financial_invoices;
CREATE POLICY financial_invoices_read_tenant ON public.financial_invoices
  FOR SELECT TO authenticated
  USING (organization_id = app.current_organization_id());
DROP POLICY IF EXISTS financial_invoices_update_tenant ON public.financial_invoices;
CREATE POLICY financial_invoices_update_tenant ON public.financial_invoices
  FOR UPDATE TO authenticated
  USING (organization_id = app.current_organization_id() AND app.can_manage_organization_data(organization_id))
  WITH CHECK (organization_id = app.current_organization_id() AND app.can_manage_organization_data(organization_id));
DROP POLICY IF EXISTS financial_invoice_payments_read_tenant ON public.financial_invoice_payments;
CREATE POLICY financial_invoice_payments_read_tenant ON public.financial_invoice_payments
  FOR SELECT TO authenticated
  USING (organization_id = app.current_organization_id());
DROP POLICY IF EXISTS grants_ledger_read_tenant ON public.grants_ledger;
CREATE POLICY grants_ledger_read_tenant ON public.grants_ledger
  FOR SELECT TO authenticated
  USING (organization_id = app.current_organization_id() AND app.can_manage_organization_data(organization_id));
DROP POLICY IF EXISTS grants_ledger_insert_tenant ON public.grants_ledger;
DROP POLICY IF EXISTS client_grant_balances_read_tenant ON public.client_grant_balances;
CREATE POLICY client_grant_balances_read_tenant ON public.client_grant_balances
  FOR SELECT TO authenticated
  USING (organization_id = app.current_organization_id() AND app.can_manage_organization_data(organization_id));

DROP POLICY IF EXISTS governance_notifications_agent_update ON public.governance_notifications;
CREATE POLICY governance_notifications_agent_update ON public.governance_notifications
  FOR UPDATE TO authenticated
  USING (organization_id = app.current_organization_id() AND recipient_user_id = auth.uid())
  WITH CHECK (organization_id = app.current_organization_id() AND recipient_user_id = auth.uid());

DROP POLICY IF EXISTS governance_notifications_agent_read ON public.governance_notifications;
CREATE POLICY governance_notifications_agent_read ON public.governance_notifications
  FOR SELECT TO authenticated
  USING (
    organization_id = app.current_organization_id()
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
  )
  WITH CHECK (
    organization_id = app.current_organization_id()
    AND recipient_user_id = auth.uid()
  );

INSERT INTO storage.buckets (id, name, public)
VALUES ('client-documents', 'client-documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS client_documents_read_tenant ON storage.objects;
CREATE POLICY client_documents_read_tenant ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND split_part(name, '/', 1) = app.current_organization_id()::text
  );
DROP POLICY IF EXISTS client_documents_insert_tenant ON storage.objects;
CREATE POLICY client_documents_insert_tenant ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'client-documents'
    AND app.can_manage_organization_data(app.current_organization_id())
    AND app.storage_path_targets_active_client(name)
  );
DROP POLICY IF EXISTS client_documents_update_tenant ON storage.objects;
CREATE POLICY client_documents_update_tenant ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND app.can_manage_organization_data(app.current_organization_id())
    AND app.storage_path_targets_active_client(name)
  )
  WITH CHECK (
    bucket_id = 'client-documents'
    AND app.can_manage_organization_data(app.current_organization_id())
    AND app.storage_path_targets_active_client(name)
  );
DROP POLICY IF EXISTS client_documents_delete_tenant ON storage.objects;
CREATE POLICY client_documents_delete_tenant ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND app.is_organization_admin(app.current_organization_id())
    AND split_part(name, '/', 1) = app.current_organization_id()::text
  );

COMMIT;
