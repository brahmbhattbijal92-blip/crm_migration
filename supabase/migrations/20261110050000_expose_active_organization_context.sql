BEGIN;

CREATE OR REPLACE FUNCTION public.get_current_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT app.current_organization_id();
$function$;

REVOKE ALL ON FUNCTION public.get_current_organization_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_organization_id() TO authenticated;

COMMIT;
