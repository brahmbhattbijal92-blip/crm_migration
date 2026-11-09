BEGIN;

ALTER TABLE public.organization_memberships
  DROP CONSTRAINT IF EXISTS organization_memberships_role_check;
ALTER TABLE public.organization_memberships
  ADD CONSTRAINT organization_memberships_role_check
  CHECK (role IN ('owner', 'admin', 'agent', 'member', 'viewer', 'inactive'));

ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('Admin', 'Manager', 'Viewer', 'Inactive'));

REVOKE DELETE ON TABLE public.organization_memberships FROM authenticated;
GRANT UPDATE ON TABLE public.organization_memberships TO service_role;

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
    WHEN 'inactive' THEN 'Inactive'
    ELSE 'Viewer'
  END;

  INSERT INTO public.user_roles (organization_id, user_id, role)
  VALUES (NEW.organization_id, NEW.user_id, mapped_role)
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET role = EXCLUDED.role, updated_at = now();
  RETURN NEW;
END;
$$;

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
      AND memberships.role <> 'inactive'
  ) THEN
    RETURN NULL;
  END IF;

  RETURN requested_id;
END;
$$;

COMMIT;