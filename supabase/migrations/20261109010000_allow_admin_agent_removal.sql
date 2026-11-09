BEGIN;

GRANT DELETE ON TABLE public.organization_memberships TO authenticated;

COMMIT;