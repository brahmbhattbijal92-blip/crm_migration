BEGIN;

-- Requires the core CRM migration, which defines organization memberships and
-- the app.current_organization_id()/app.can_manage_organization_data() helpers.
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE TABLE IF NOT EXISTS public.financial_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('grant', 'invoice', 'payment')),
  amount numeric(14, 2) NOT NULL CHECK (amount <> 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  transaction_date timestamptz NOT NULL DEFAULT now(),
  description text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_ledger_client_tenant_fk
    FOREIGN KEY (organization_id, client_id)
    REFERENCES public.clients (organization_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS financial_ledger_org_client_currency_date_idx
  ON public.financial_ledger (
    organization_id,
    client_id,
    currency,
    transaction_date DESC,
    id DESC
  );

REVOKE ALL PRIVILEGES ON TABLE public.financial_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.financial_ledger TO authenticated;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients FORCE ROW LEVEL SECURITY;
ALTER TABLE public.financial_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_ledger FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_read_tenant ON public.organizations;
CREATE POLICY organizations_read_tenant ON public.organizations
  FOR SELECT TO authenticated
  USING (id = app.current_organization_id());

DROP POLICY IF EXISTS organizations_admin_update ON public.organizations;
CREATE POLICY organizations_admin_update ON public.organizations
  FOR UPDATE TO authenticated
  USING (id = app.current_organization_id() AND app.is_organization_admin(id))
  WITH CHECK (id = app.current_organization_id() AND app.is_organization_admin(id));

DROP POLICY IF EXISTS clients_read_tenant ON public.clients;
CREATE POLICY clients_read_tenant ON public.clients
  FOR SELECT TO authenticated
  USING (organization_id = app.current_organization_id());

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
  )
  WITH CHECK (
    organization_id = app.current_organization_id()
    AND app.can_manage_organization_data(organization_id)
  );

DROP POLICY IF EXISTS financial_ledger_read_tenant ON public.financial_ledger;
CREATE POLICY financial_ledger_read_tenant ON public.financial_ledger
  FOR SELECT TO authenticated
  USING (organization_id = app.current_organization_id());

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