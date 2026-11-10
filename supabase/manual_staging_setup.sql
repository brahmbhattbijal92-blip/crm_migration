-- Manual Supabase staging bootstrap.
-- Run this whole file in the Supabase SQL Editor. It assumes Supabase's auth
-- and storage schemas/roles exist. Physical Storage objects must be removed
-- by the application between begin_client_purge and finalize_client_purge.
-- This requested schema uses one signed financial_ledger. The current dashboard
-- migration history also defines separate financial_invoices, payments, and
-- grants_ledger tables; this file does not replace that full application schema.

BEGIN;

CREATE SCHEMA IF NOT EXISTS app;

-- Core tenant and identity tables.
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
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id),
  CONSTRAINT organization_memberships_role_check
    CHECK (role IN ('owner', 'admin', 'agent', 'member', 'viewer', 'inactive'))
);

ALTER TABLE public.organization_memberships
  DROP CONSTRAINT IF EXISTS organization_memberships_role_check;
ALTER TABLE public.organization_memberships
  ADD CONSTRAINT organization_memberships_role_check
    CHECK (role IN ('owner', 'admin', 'agent', 'member', 'viewer', 'inactive'));

CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  first_name text NOT NULL CHECK (length(trim(first_name)) BETWEEN 1 AND 120),
  last_name text NOT NULL CHECK (length(trim(last_name)) BETWEEN 1 AND 120),
  email text NOT NULL CHECK (length(email) <= 320),
  company text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending', 'completed', 'archived')),
  passport_expires_at date,
  visa_subclass text,
  visa_expires_at date,
  archived_at timestamptz,
  purge_locked_at timestamptz,
  purge_locked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_interaction_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (organization_id, id)
);

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS company text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS passport_expires_at date,
  ADD COLUMN IF NOT EXISTS visa_subclass text,
  ADD COLUMN IF NOT EXISTS visa_expires_at date,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS purge_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS purge_locked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_interaction_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE OR REPLACE FUNCTION app.bootstrap_profile_for_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, email)
  VALUES (
    NEW.id,
    coalesce(nullif(NEW.raw_user_meta_data ->> 'full_name', ''), ''),
    coalesce(NEW.email, '')
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION app.bootstrap_profile_for_auth_user() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS on_auth_user_profile_created ON auth.users;
CREATE TRIGGER on_auth_user_profile_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app.bootstrap_profile_for_auth_user();

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

CREATE TABLE IF NOT EXISTS public.financial_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('grant', 'invoice', 'payment')),
  amount numeric(14, 2) NOT NULL CHECK (amount <> 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  transaction_date timestamptz NOT NULL DEFAULT now(),
  reference text,
  description text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_ledger_client_tenant_fk
    FOREIGN KEY (organization_id, client_id)
    REFERENCES public.clients (organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT financial_ledger_invoice_sign_check
    CHECK (type <> 'invoice' OR amount > 0),
  CONSTRAINT financial_ledger_payment_sign_check
    CHECK (type <> 'payment' OR amount < 0)
);

COMMENT ON TABLE public.financial_ledger IS
  'Append-only signed ledger: grant credits positive/drawdowns negative, invoice charges positive, payments negative.';

ALTER TABLE public.financial_ledger
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS transaction_date timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS financial_ledger_org_client_currency_date_idx
  ON public.financial_ledger (
    organization_id,
    client_id,
    currency,
    transaction_date DESC,
    id DESC
  );
CREATE INDEX IF NOT EXISTS documents_org_client_created_idx
  ON public.documents (organization_id, client_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS memberships_user_org_idx
  ON public.organization_memberships (user_id, organization_id);

-- Organization context is taken from a verified JWT claim or the user's
-- profile, and is accepted only when the user has an organization membership.
CREATE OR REPLACE FUNCTION app.current_organization_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
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
  IF requested_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships AS memberships
    WHERE memberships.organization_id = requested_id
      AND memberships.user_id = actor_id
  ) THEN
    RETURN NULL;
  END IF;

  RETURN requested_id;
END;
$function$;

CREATE OR REPLACE FUNCTION app.is_organization_admin(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships AS memberships
    WHERE memberships.organization_id = target_organization_id
      AND memberships.user_id = auth.uid()
      AND memberships.role IN ('owner', 'admin')
  );
$function$;

CREATE OR REPLACE FUNCTION app.can_manage_organization_data(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships AS memberships
    WHERE memberships.organization_id = target_organization_id
      AND memberships.user_id = auth.uid()
      AND memberships.role IN ('owner', 'admin', 'agent')
  );
$function$;

CREATE OR REPLACE FUNCTION app.set_client_archive_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'archived' THEN
      NEW.archived_at := coalesce(NEW.archived_at, now());
    ELSE
      NEW.archived_at := NULL;
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.archived_at := CASE WHEN NEW.status = 'archived' THEN now() ELSE NULL END;
  ELSE
    NEW.archived_at := OLD.archived_at;
  END IF;

  NEW.updated_at := now();
  NEW.last_interaction_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION app.prevent_write_during_client_purge()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  client_status text;
  client_deleted_at timestamptz;
  client_purge_locked_at timestamptz;
BEGIN
  SELECT clients.status, clients.deleted_at, clients.purge_locked_at
    INTO client_status, client_deleted_at, client_purge_locked_at
    FROM public.clients AS clients
    WHERE clients.id = NEW.client_id
      AND clients.organization_id = NEW.organization_id
    FOR UPDATE;

  IF NOT FOUND OR client_status = 'archived' OR client_deleted_at IS NOT NULL OR client_purge_locked_at IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Writes are blocked for archived, deleted, or purge-locked clients.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION app.storage_path_targets_active_client(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN split_part(object_name, '/', 1) <> app.current_organization_id()::text THEN false
    WHEN split_part(object_name, '/', 2) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.clients AS clients
      WHERE clients.organization_id = app.current_organization_id()
        AND clients.id = split_part(object_name, '/', 2)::uuid
        AND clients.status <> 'archived'
        AND clients.deleted_at IS NULL
        AND clients.purge_locked_at IS NULL
    )
  END;
$function$;

REVOKE ALL ON FUNCTION app.current_organization_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app.is_organization_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app.can_manage_organization_data(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app.set_client_archive_timestamps() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.prevent_write_during_client_purge() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.storage_path_targets_active_client(text) FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA app TO authenticated;
GRANT EXECUTE ON FUNCTION app.current_organization_id() TO authenticated;
GRANT EXECUTE ON FUNCTION app.is_organization_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app.can_manage_organization_data(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app.storage_path_targets_active_client(text) TO authenticated;
REVOKE ALL ON FUNCTION app.bootstrap_profile_for_auth_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clients_set_archive_timestamps ON public.clients;
CREATE TRIGGER clients_set_archive_timestamps
  BEFORE INSERT OR UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION app.set_client_archive_timestamps();

DROP TRIGGER IF EXISTS documents_block_purge_locked_client ON public.documents;
CREATE TRIGGER documents_block_purge_locked_client
  BEFORE INSERT OR UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION app.prevent_write_during_client_purge();

DROP TRIGGER IF EXISTS financial_ledger_block_purge_locked_client ON public.financial_ledger;
CREATE TRIGGER financial_ledger_block_purge_locked_client
  BEFORE INSERT ON public.financial_ledger
  FOR EACH ROW EXECUTE FUNCTION app.prevent_write_during_client_purge();

-- Grant rows are signed: credits are positive and drawdowns are negative.
CREATE OR REPLACE FUNCTION public.allocate_grant(
  requested_client_id uuid,
  requested_amount numeric,
  requested_currency text,
  requested_reference text DEFAULT NULL
)
RETURNS SETOF public.financial_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  tenant_id uuid := app.current_organization_id();
  normalized_currency text := upper(trim(requested_currency));
  normalized_amount numeric(14, 2) := round(requested_amount, 2);
  ledger_entry public.financial_ledger;
BEGIN
  IF actor_id IS NULL OR tenant_id IS NULL OR NOT app.can_manage_organization_data(tenant_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Agent or administrator access is required to allocate grants.';
  END IF;
  IF requested_amount IS NULL OR normalized_amount <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Grant amount must be greater than zero.';
  END IF;
  IF normalized_currency IS NULL OR normalized_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Currency must be a three-letter uppercase code.';
  END IF;

  PERFORM 1
  FROM public.clients AS clients
  WHERE clients.id = requested_client_id
    AND clients.organization_id = tenant_id
    AND clients.status <> 'archived'
    AND clients.deleted_at IS NULL
    AND clients.purge_locked_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Active client was not found.'; END IF;

  INSERT INTO public.financial_ledger (
    organization_id, client_id, type, amount, currency, reference, description, created_by
  ) VALUES (
    tenant_id, requested_client_id, 'grant', normalized_amount, normalized_currency,
    nullif(trim(requested_reference), ''), 'Grant allocated', actor_id
  ) RETURNING * INTO ledger_entry;

  RETURN NEXT ledger_entry;
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.draw_down_grant(
  requested_client_id uuid,
  requested_amount numeric,
  requested_currency text,
  requested_reference text DEFAULT NULL
)
RETURNS SETOF public.financial_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  tenant_id uuid := app.current_organization_id();
  normalized_currency text := upper(trim(requested_currency));
  normalized_amount numeric(14, 2) := round(requested_amount, 2);
  available_grant numeric(14, 2);
  ledger_entry public.financial_ledger;
BEGIN
  IF actor_id IS NULL OR tenant_id IS NULL OR NOT app.can_manage_organization_data(tenant_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Agent or administrator access is required to draw down grants.';
  END IF;
  IF requested_amount IS NULL OR normalized_amount <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Grant drawdown must be greater than zero.';
  END IF;
  IF normalized_currency IS NULL OR normalized_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Currency must be a three-letter uppercase code.';
  END IF;

  PERFORM 1
  FROM public.clients AS clients
  WHERE clients.id = requested_client_id
    AND clients.organization_id = tenant_id
    AND clients.status <> 'archived'
    AND clients.deleted_at IS NULL
    AND clients.purge_locked_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Active client was not found.'; END IF;

  SELECT coalesce(sum(ledger.amount), 0)
    INTO available_grant
    FROM public.financial_ledger AS ledger
    WHERE ledger.organization_id = tenant_id
      AND ledger.client_id = requested_client_id
      AND ledger.type = 'grant'
      AND ledger.currency = normalized_currency;
  IF normalized_amount > available_grant THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Grant drawdown exceeds the available balance in this currency.';
  END IF;

  INSERT INTO public.financial_ledger (
    organization_id, client_id, type, amount, currency, reference, description, created_by
  ) VALUES (
    tenant_id, requested_client_id, 'grant', -normalized_amount, normalized_currency,
    nullif(trim(requested_reference), ''), 'Grant drawdown', actor_id
  ) RETURNING * INTO ledger_entry;

  RETURN NEXT ledger_entry;
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_invoice_charge(
  requested_client_id uuid,
  requested_amount numeric,
  requested_currency text,
  requested_reference text DEFAULT NULL
)
RETURNS SETOF public.financial_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  tenant_id uuid := app.current_organization_id();
  normalized_currency text := upper(trim(requested_currency));
  normalized_amount numeric(14, 2) := round(requested_amount, 2);
  ledger_entry public.financial_ledger;
BEGIN
  IF actor_id IS NULL OR tenant_id IS NULL OR NOT app.can_manage_organization_data(tenant_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Agent or administrator access is required to record invoices.';
  END IF;
  IF requested_amount IS NULL OR normalized_amount <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invoice amount must be greater than zero.';
  END IF;
  IF normalized_currency IS NULL OR normalized_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Currency must be a three-letter uppercase code.';
  END IF;

  PERFORM 1
  FROM public.clients AS clients
  WHERE clients.id = requested_client_id
    AND clients.organization_id = tenant_id
    AND clients.status <> 'archived'
    AND clients.deleted_at IS NULL
    AND clients.purge_locked_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Active client was not found.'; END IF;

  INSERT INTO public.financial_ledger (
    organization_id, client_id, type, amount, currency, reference, description, created_by
  ) VALUES (
    tenant_id, requested_client_id, 'invoice', normalized_amount, normalized_currency,
    nullif(trim(requested_reference), ''), 'Invoice charge', actor_id
  ) RETURNING * INTO ledger_entry;

  RETURN NEXT ledger_entry;
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_invoice_payment(
  requested_client_id uuid,
  requested_amount numeric,
  requested_currency text,
  requested_reference text DEFAULT NULL
)
RETURNS SETOF public.financial_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  tenant_id uuid := app.current_organization_id();
  normalized_currency text := upper(trim(requested_currency));
  normalized_amount numeric(14, 2) := round(requested_amount, 2);
  outstanding_amount numeric(14, 2);
  ledger_entry public.financial_ledger;
BEGIN
  IF actor_id IS NULL OR tenant_id IS NULL OR NOT app.can_manage_organization_data(tenant_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Agent or administrator access is required to record payments.';
  END IF;
  IF requested_amount IS NULL OR normalized_amount <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Payment amount must be greater than zero.';
  END IF;
  IF normalized_currency IS NULL OR normalized_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Currency must be a three-letter uppercase code.';
  END IF;

  PERFORM 1
  FROM public.clients AS clients
  WHERE clients.id = requested_client_id
    AND clients.organization_id = tenant_id
    AND clients.status <> 'archived'
    AND clients.deleted_at IS NULL
    AND clients.purge_locked_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Active client was not found.'; END IF;

  SELECT coalesce(sum(ledger.amount), 0)
    INTO outstanding_amount
    FROM public.financial_ledger AS ledger
    WHERE ledger.organization_id = tenant_id
      AND ledger.client_id = requested_client_id
      AND ledger.currency = normalized_currency
      AND ledger.type IN ('invoice', 'payment');
  IF outstanding_amount <= 0 OR normalized_amount > outstanding_amount THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Payment exceeds the outstanding balance in this currency.';
  END IF;

  INSERT INTO public.financial_ledger (
    organization_id, client_id, type, amount, currency, reference, description, created_by
  ) VALUES (
    tenant_id, requested_client_id, 'payment', -normalized_amount, normalized_currency,
    nullif(trim(requested_reference), ''), 'Invoice payment', actor_id
  ) RETURNING * INTO ledger_entry;

  RETURN NEXT ledger_entry;
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_organization_for_current_user(organization_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  normalized_name text := trim(organization_name);
  new_organization_id uuid;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sign in before creating an organization.';
  END IF;
  IF normalized_name IS NULL OR length(normalized_name) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Organization name must be between 1 and 160 characters.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.organization_memberships AS memberships
    WHERE memberships.user_id = actor_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'This account already belongs to an organization.';
  END IF;

  INSERT INTO public.organizations (name)
    VALUES (normalized_name)
    RETURNING id INTO new_organization_id;

  INSERT INTO public.organization_memberships (organization_id, user_id, role)
    VALUES (new_organization_id, actor_id, 'owner');

  INSERT INTO public.profiles (user_id, default_organization_id, email)
    SELECT actor_id, new_organization_id, coalesce(auth_user.email, '')
    FROM auth.users AS auth_user
    WHERE auth_user.id = actor_id
  ON CONFLICT (user_id) DO UPDATE
    SET default_organization_id = EXCLUDED.default_organization_id;

  RETURN new_organization_id;
END;
$function$;

-- Check status, age, tenant, admin, purge lock, and zero net invoice balance
-- independently for each client and currency before storage cleanup begins.
CREATE OR REPLACE FUNCTION app.begin_client_purge(requested_client_ids uuid[])
RETURNS TABLE(client_id uuid, bucket_id text, storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Select at least one client for purge.';
  END IF;

  SELECT count(DISTINCT requested_id)::integer INTO requested_count
  FROM unnest(requested_client_ids) AS requested(requested_id);

  PERFORM clients.id
  FROM public.clients AS clients
  WHERE clients.organization_id = tenant_id AND clients.id = ANY(requested_client_ids)
  ORDER BY clients.id
  FOR UPDATE;

  SELECT count(*)::integer INTO found_count
  FROM public.clients AS clients
  WHERE clients.organization_id = tenant_id AND clients.id = ANY(requested_client_ids);
  IF found_count <> requested_count THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'One or more clients were not found in this organization.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.clients AS clients
    WHERE clients.organization_id = tenant_id
      AND clients.id = ANY(requested_client_ids)
      AND (clients.status <> 'archived' OR clients.archived_at IS NULL
        OR clients.archived_at > now() - interval '90 days')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Client must remain archived for 90 days before purge.';
  END IF;

  IF EXISTS (
    SELECT ledger.client_id, ledger.currency
    FROM public.financial_ledger AS ledger
    WHERE ledger.organization_id = tenant_id
      AND ledger.client_id = ANY(requested_client_ids)
      AND ledger.type IN ('invoice', 'payment')
    GROUP BY ledger.client_id, ledger.currency
    HAVING sum(ledger.amount) <> 0
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'COMPLIANCE_PURGE_BLOCKED: Each currency must have zero net outstanding invoices.';
  END IF;

  SELECT count(*)::integer INTO claimable_count
  FROM public.clients AS clients
  WHERE clients.organization_id = tenant_id
    AND clients.id = ANY(requested_client_ids)
    AND (clients.purge_locked_by IS NULL OR clients.purge_locked_by = actor_id);
  IF claimable_count <> requested_count THEN
    RAISE EXCEPTION USING ERRCODE = '55P03', MESSAGE = 'A selected client is locked by another administrator.';
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
SET search_path = ''
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
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Select at least one client for purge.';
  END IF;

  SELECT count(DISTINCT requested_id)::integer INTO requested_count
  FROM unnest(requested_client_ids) AS requested(requested_id);

  PERFORM clients.id
  FROM public.clients AS clients
  WHERE clients.organization_id = tenant_id AND clients.id = ANY(requested_client_ids)
  ORDER BY clients.id
  FOR UPDATE;

  SELECT count(*)::integer INTO locked_count
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
      AND (clients.status <> 'archived' OR clients.archived_at IS NULL
        OR clients.archived_at > now() - interval '90 days')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Client must remain archived for 90 days before purge.';
  END IF;

  IF EXISTS (
    SELECT ledger.client_id, ledger.currency
    FROM public.financial_ledger AS ledger
    WHERE ledger.organization_id = tenant_id
      AND ledger.client_id = ANY(requested_client_ids)
      AND ledger.type IN ('invoice', 'payment')
    GROUP BY ledger.client_id, ledger.currency
    HAVING sum(ledger.amount) <> 0
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'COMPLIANCE_PURGE_BLOCKED: Each currency must have zero net outstanding invoices.';
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

CREATE OR REPLACE FUNCTION app.cancel_client_purge(requested_client_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  tenant_id uuid := app.current_organization_id();
BEGIN
  IF actor_id IS NULL OR tenant_id IS NULL OR NOT app.is_organization_admin(tenant_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Purge requires an authenticated organization administrator.';
  END IF;
  IF requested_client_ids IS NULL OR cardinality(requested_client_ids) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Select at least one client for purge cancellation.';
  END IF;
  UPDATE public.clients AS clients
    SET purge_locked_at = NULL, purge_locked_by = NULL
    WHERE clients.organization_id = tenant_id
      AND clients.id = ANY(requested_client_ids)
      AND clients.purge_locked_by = actor_id;
END;
$function$;

-- Row-level security policies are recreated so rerunning this script cannot
-- accumulate permissive policies from prior staging attempts.
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients FORCE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.financial_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_ledger FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_read_tenant ON public.organizations;
CREATE POLICY organizations_read_tenant ON public.organizations
  FOR SELECT TO authenticated USING (id = app.current_organization_id());
DROP POLICY IF EXISTS organizations_admin_update ON public.organizations;
CREATE POLICY organizations_admin_update ON public.organizations
  FOR UPDATE TO authenticated
  USING (id = app.current_organization_id() AND app.is_organization_admin(id))
  WITH CHECK (id = app.current_organization_id() AND app.is_organization_admin(id));

DROP POLICY IF EXISTS profiles_read_self ON public.profiles;
CREATE POLICY profiles_read_self ON public.profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS memberships_read_tenant ON public.organization_memberships;
CREATE POLICY memberships_read_tenant ON public.organization_memberships
  FOR SELECT TO authenticated
  USING (
    organization_id = app.current_organization_id()
    AND (user_id = auth.uid() OR app.is_organization_admin(organization_id))
  );

DROP POLICY IF EXISTS clients_read_tenant ON public.clients;
CREATE POLICY clients_read_tenant ON public.clients
  FOR SELECT TO authenticated USING (organization_id = app.current_organization_id());
DROP POLICY IF EXISTS clients_insert_tenant ON public.clients;
CREATE POLICY clients_insert_tenant ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id));
DROP POLICY IF EXISTS clients_update_tenant ON public.clients;
CREATE POLICY clients_update_tenant ON public.clients
  FOR UPDATE TO authenticated
  USING (organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id))
  WITH CHECK (organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id));

DROP POLICY IF EXISTS documents_read_tenant ON public.documents;
CREATE POLICY documents_read_tenant ON public.documents
  FOR SELECT TO authenticated USING (organization_id = app.current_organization_id());
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
        AND clients.status <> 'archived' AND clients.deleted_at IS NULL
        AND clients.purge_locked_at IS NULL
    )
  );
DROP POLICY IF EXISTS documents_update_tenant ON public.documents;
CREATE POLICY documents_update_tenant ON public.documents
  FOR UPDATE TO authenticated
  USING (organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id))
  WITH CHECK (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
    AND EXISTS (
      SELECT 1 FROM public.clients AS clients
      WHERE clients.id = documents.client_id
        AND clients.organization_id = documents.organization_id
        AND clients.status <> 'archived' AND clients.deleted_at IS NULL
        AND clients.purge_locked_at IS NULL
    )
  );

DROP POLICY IF EXISTS financial_ledger_read_tenant ON public.financial_ledger;
CREATE POLICY financial_ledger_read_tenant ON public.financial_ledger
  FOR SELECT TO authenticated USING (organization_id = app.current_organization_id());
DROP POLICY IF EXISTS financial_ledger_insert_tenant ON public.financial_ledger;
CREATE POLICY financial_ledger_insert_tenant ON public.financial_ledger
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
    AND EXISTS (
      SELECT 1 FROM public.clients AS clients
      WHERE clients.id = financial_ledger.client_id
        AND clients.organization_id = financial_ledger.organization_id
        AND clients.status <> 'archived' AND clients.deleted_at IS NULL
        AND clients.purge_locked_at IS NULL
    )
  );

-- Explicit grants keep the browser role read-only on the append-only ledger.
REVOKE ALL PRIVILEGES ON public.organizations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.organizations TO authenticated;
GRANT UPDATE (name) ON public.organizations TO authenticated;
REVOKE ALL PRIVILEGES ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
REVOKE ALL PRIVILEGES ON public.organization_memberships FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.organization_memberships TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.organization_memberships FROM authenticated;
REVOKE ALL PRIVILEGES ON public.clients FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.clients TO authenticated;
GRANT INSERT (organization_id, first_name, last_name, email, company, status)
  ON public.clients TO authenticated;
GRANT UPDATE (first_name, last_name, email, company, status)
  ON public.clients TO authenticated;
GRANT INSERT (passport_expires_at, visa_subclass, visa_expires_at)
  ON public.clients TO authenticated;
GRANT UPDATE (passport_expires_at, visa_subclass, visa_expires_at)
  ON public.clients TO authenticated;
REVOKE ALL PRIVILEGES ON public.documents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.documents TO authenticated;
REVOKE DELETE ON public.documents FROM authenticated;
REVOKE ALL PRIVILEGES ON public.financial_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.financial_ledger TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.financial_ledger FROM authenticated;

REVOKE ALL ON FUNCTION app.current_organization_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app.is_organization_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app.can_manage_organization_data(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app.prevent_write_during_client_purge() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.storage_path_targets_active_client(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.current_organization_id() TO authenticated;
GRANT EXECUTE ON FUNCTION app.is_organization_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app.can_manage_organization_data(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app.storage_path_targets_active_client(text) TO authenticated;
GRANT USAGE ON SCHEMA app TO authenticated;

REVOKE ALL ON FUNCTION public.allocate_grant(uuid, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.draw_down_grant(uuid, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_invoice_charge(uuid, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_invoice_payment(uuid, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_organization_for_current_user(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app.begin_client_purge(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app.finalize_client_purge(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app.cancel_client_purge(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.begin_client_purge(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION app.finalize_client_purge(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION app.cancel_client_purge(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.begin_client_purge(requested_client_ids uuid[])
RETURNS TABLE(client_id uuid, bucket_id text, storage_path text)
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $function$
  SELECT * FROM app.begin_client_purge(requested_client_ids);
$function$;

CREATE OR REPLACE FUNCTION public.finalize_client_purge(requested_client_ids uuid[])
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $function$
  SELECT app.finalize_client_purge(requested_client_ids);
$function$;

CREATE OR REPLACE FUNCTION public.cancel_client_purge(requested_client_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, public, app
AS $function$
  SELECT app.cancel_client_purge(requested_client_ids);
$function$;

GRANT EXECUTE ON FUNCTION public.allocate_grant(uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.draw_down_grant(uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice_charge(uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice_payment(uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization_for_current_user(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.begin_client_purge(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_client_purge(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_client_purge(uuid[]) TO authenticated;

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