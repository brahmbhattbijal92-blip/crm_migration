BEGIN;

ALTER TABLE public.organization_memberships
  ADD COLUMN IF NOT EXISTS removed_at timestamptz,
  ADD COLUMN IF NOT EXISTS removed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS removed_role text;

ALTER TABLE public.organization_memberships
  DROP CONSTRAINT IF EXISTS organization_memberships_removed_role_check,
  ADD CONSTRAINT organization_memberships_removed_role_check
    CHECK (removed_role IS NULL OR removed_role IN ('agent', 'inactive'));
ALTER TABLE public.organization_memberships
  DROP CONSTRAINT IF EXISTS organization_memberships_removed_state_check,
  ADD CONSTRAINT organization_memberships_removed_state_check
    CHECK ((removed_at IS NULL) = (removed_role IS NULL));

CREATE TABLE IF NOT EXISTS public.organization_agent_removals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  original_user_id uuid NOT NULL,
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
  display_name text NOT NULL DEFAULT '',
  original_role text NOT NULL CHECK (original_role IN ('agent', 'inactive')),
  membership_created_at timestamptz NOT NULL,
  removed_at timestamptz NOT NULL DEFAULT now(),
  removed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  restored_at timestamptz,
  reinvited_at timestamptz,
  replacement_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organization_agent_removals_org_removed_idx
  ON public.organization_agent_removals (organization_id, removed_at DESC)
  WHERE restored_at IS NULL AND reinvited_at IS NULL;

ALTER TABLE public.organization_agent_removals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organization_agent_removals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.organization_agent_removals TO service_role;

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
      AND memberships.removed_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  RETURN requested_id;
END;
$$;

COMMIT;