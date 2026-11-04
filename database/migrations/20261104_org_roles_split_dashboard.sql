BEGIN;

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_memberships (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('Admin', 'Manager', 'Viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS user_roles_user_org_idx
  ON public.user_roles (user_id, organization_id);

CREATE OR REPLACE FUNCTION app.user_has_org_role(
  requested_organization_id uuid,
  allowed_roles text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.user_roles AS roles
    WHERE roles.organization_id = requested_organization_id
      AND roles.user_id = auth.uid()
      AND roles.role = ANY(allowed_roles)
  );
$$;

REVOKE ALL ON FUNCTION app.user_has_org_role(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.user_has_org_role(uuid, text[]) TO authenticated;
GRANT USAGE ON SCHEMA app TO authenticated;

CREATE OR REPLACE FUNCTION app.sync_user_role_from_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  mapped_role text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.user_roles
    WHERE organization_id = OLD.organization_id AND user_id = OLD.user_id;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    OLD.organization_id IS DISTINCT FROM NEW.organization_id
    OR OLD.user_id IS DISTINCT FROM NEW.user_id
  ) THEN
    DELETE FROM public.user_roles
    WHERE organization_id = OLD.organization_id AND user_id = OLD.user_id;
  END IF;

  mapped_role := CASE lower(NEW.role)
    WHEN 'owner' THEN 'Admin'
    WHEN 'admin' THEN 'Admin'
    WHEN 'agent' THEN 'Manager'
    ELSE 'Viewer'
  END;

  INSERT INTO public.user_roles (organization_id, user_id, role)
  VALUES (NEW.organization_id, NEW.user_id, mapped_role)
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET role = EXCLUDED.role, updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.sync_user_role_from_membership() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS organization_memberships_sync_user_roles ON public.organization_memberships;
CREATE TRIGGER organization_memberships_sync_user_roles
  AFTER INSERT OR UPDATE OR DELETE ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION app.sync_user_role_from_membership();

INSERT INTO public.user_roles (organization_id, user_id, role)
SELECT
  memberships.organization_id,
  memberships.user_id,
  CASE lower(memberships.role)
    WHEN 'owner' THEN 'Admin'
    WHEN 'admin' THEN 'Admin'
    WHEN 'agent' THEN 'Manager'
    ELSE 'Viewer'
  END
FROM public.organization_memberships AS memberships
ON CONFLICT (organization_id, user_id) DO UPDATE
  SET role = EXCLUDED.role, updated_at = now();

CREATE TABLE IF NOT EXISTS public.split_screen_dashboard_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  layout_name text NOT NULL DEFAULT 'default' CHECK (length(trim(layout_name)) BETWEEN 1 AND 80),
  layout jsonb NOT NULL DEFAULT '{"sidebarWidth":240,"actionPanelWidth":280,"centerMinWidth":480}'::jsonb
    CHECK (jsonb_typeof(layout) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT split_screen_layout_user_role_fk
    FOREIGN KEY (organization_id, user_id)
    REFERENCES public.user_roles (organization_id, user_id)
    ON DELETE CASCADE,
  UNIQUE (organization_id, user_id, layout_name)
);

CREATE INDEX IF NOT EXISTS split_screen_layouts_org_user_idx
  ON public.split_screen_dashboard_layouts (organization_id, user_id);

CREATE OR REPLACE FUNCTION app.touch_dashboard_layout_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS split_screen_layouts_set_updated_at ON public.split_screen_dashboard_layouts;
CREATE TRIGGER split_screen_layouts_set_updated_at
  BEFORE UPDATE ON public.split_screen_dashboard_layouts
  FOR EACH ROW EXECUTE FUNCTION app.touch_dashboard_layout_updated_at();

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.split_screen_dashboard_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.split_screen_dashboard_layouts FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.organizations FROM anon, authenticated;
GRANT SELECT ON public.organizations TO authenticated;
GRANT UPDATE (name) ON public.organizations TO authenticated;

REVOKE ALL ON public.user_roles FROM anon, authenticated;
GRANT SELECT ON public.user_roles TO authenticated;

REVOKE ALL ON public.split_screen_dashboard_layouts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.split_screen_dashboard_layouts TO authenticated;

DROP POLICY IF EXISTS organizations_read_by_user_role ON public.organizations;
CREATE POLICY organizations_read_by_user_role ON public.organizations
  FOR SELECT TO authenticated
  USING (app.user_has_org_role(id, ARRAY['Admin', 'Manager', 'Viewer']));

DROP POLICY IF EXISTS organizations_update_by_admin ON public.organizations;
CREATE POLICY organizations_update_by_admin ON public.organizations
  FOR UPDATE TO authenticated
  USING (app.user_has_org_role(id, ARRAY['Admin']))
  WITH CHECK (app.user_has_org_role(id, ARRAY['Admin']));

DROP POLICY IF EXISTS user_roles_read_self_or_admin ON public.user_roles;
CREATE POLICY user_roles_read_self_or_admin ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR app.user_has_org_role(organization_id, ARRAY['Admin'])
  );

DROP POLICY IF EXISTS split_screen_layouts_select_own ON public.split_screen_dashboard_layouts;
CREATE POLICY split_screen_layouts_select_own ON public.split_screen_dashboard_layouts
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND app.user_has_org_role(organization_id, ARRAY['Admin', 'Manager', 'Viewer'])
  );

DROP POLICY IF EXISTS split_screen_layouts_insert_own ON public.split_screen_dashboard_layouts;
CREATE POLICY split_screen_layouts_insert_own ON public.split_screen_dashboard_layouts
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND app.user_has_org_role(organization_id, ARRAY['Admin', 'Manager', 'Viewer'])
  );

DROP POLICY IF EXISTS split_screen_layouts_update_own ON public.split_screen_dashboard_layouts;
CREATE POLICY split_screen_layouts_update_own ON public.split_screen_dashboard_layouts
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND app.user_has_org_role(organization_id, ARRAY['Admin', 'Manager', 'Viewer'])
  )
  WITH CHECK (
    user_id = auth.uid()
    AND app.user_has_org_role(organization_id, ARRAY['Admin', 'Manager', 'Viewer'])
  );

DROP POLICY IF EXISTS split_screen_layouts_delete_own ON public.split_screen_dashboard_layouts;
CREATE POLICY split_screen_layouts_delete_own ON public.split_screen_dashboard_layouts
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    AND app.user_has_org_role(organization_id, ARRAY['Admin', 'Manager', 'Viewer'])
  );

COMMIT;
