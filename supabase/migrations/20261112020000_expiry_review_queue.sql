BEGIN;

CREATE INDEX IF NOT EXISTS clients_expiry_review_passport_idx
  ON public.clients (organization_id, passport_expires_at, id)
  WHERE status <> 'archived' AND deleted_at IS NULL AND passport_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS clients_expiry_review_visa_idx
  ON public.clients (organization_id, visa_expires_at, id)
  WHERE status <> 'archived' AND deleted_at IS NULL AND visa_expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.list_expiry_review_page(
  requested_from date,
  requested_through date,
  requested_offset integer DEFAULT 0,
  requested_limit integer DEFAULT 20
)
RETURNS TABLE (
  review_id text,
  client_id uuid,
  client_name text,
  document_type text,
  expires_on date
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT
    expiry.review_id,
    expiry.client_id,
    expiry.client_name,
    expiry.document_type,
    expiry.expires_on
  FROM (
    SELECT
      clients.id::text || ':passport' AS review_id,
      clients.id AS client_id,
      pg_catalog.concat_ws(' ', clients.first_name, clients.last_name) AS client_name,
      'Passport'::text AS document_type,
      clients.passport_expires_at AS expires_on
    FROM public.clients AS clients
    WHERE clients.status <> 'archived'
      AND clients.deleted_at IS NULL
      AND clients.passport_expires_at BETWEEN requested_from AND requested_through

    UNION ALL

    SELECT
      clients.id::text || ':visa' AS review_id,
      clients.id AS client_id,
      pg_catalog.concat_ws(' ', clients.first_name, clients.last_name) AS client_name,
      CASE
        WHEN NULLIF(clients.visa_subclass, '') IS NULL THEN 'Visa'
        ELSE 'Visa subclass ' || clients.visa_subclass
      END AS document_type,
      clients.visa_expires_at AS expires_on
    FROM public.clients AS clients
    WHERE clients.status <> 'archived'
      AND clients.deleted_at IS NULL
      AND clients.visa_expires_at BETWEEN requested_from AND requested_through
  ) AS expiry
  ORDER BY expiry.expires_on, expiry.client_id, expiry.document_type
  OFFSET GREATEST(COALESCE(requested_offset, 0), 0)
  LIMIT (LEAST(GREATEST(COALESCE(requested_limit, 20), 1), 100) + 1);
$function$;

REVOKE ALL ON FUNCTION public.list_expiry_review_page(date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_expiry_review_page(date, date, integer, integer) TO authenticated;

COMMIT;