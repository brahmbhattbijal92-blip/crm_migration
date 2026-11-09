BEGIN;

GRANT SELECT, INSERT, UPDATE ON TABLE public.organization_memberships TO service_role;
GRANT SELECT, UPDATE ON TABLE public.profiles TO service_role;

COMMIT;