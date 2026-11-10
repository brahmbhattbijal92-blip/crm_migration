BEGIN;

GRANT DELETE ON TABLE public.organization_memberships TO service_role;

COMMIT;