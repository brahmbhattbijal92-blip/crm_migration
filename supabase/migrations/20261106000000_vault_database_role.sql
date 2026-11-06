BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'crm_vault_app'
  ) THEN
    EXECUTE 'CREATE ROLE crm_vault_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS';
  END IF;
END
$$;

ALTER ROLE crm_vault_app
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS;

GRANT authenticated TO crm_vault_app;
GRANT USAGE ON SCHEMA public, app TO crm_vault_app;

GRANT SELECT (
  id,
  organization_id,
  first_name,
  last_name,
  email,
  company,
  status,
  created_at,
  last_interaction_at,
  updated_at,
  passport_expires_at,
  visa_subclass,
  visa_expires_at,
  archived_at,
  deleted_at
) ON public.clients TO crm_vault_app;
GRANT INSERT (organization_id, first_name, last_name, email)
  ON public.clients TO crm_vault_app;
GRANT UPDATE (status, deleted_at) ON public.clients TO crm_vault_app;

GRANT SELECT (
  id,
  organization_id,
  client_id,
  portal_name,
  encrypted_username,
  encrypted_password,
  last_verified,
  deleted_at
) ON public.credentials_vault TO crm_vault_app;
GRANT INSERT (
  organization_id,
  client_id,
  portal_name,
  encrypted_username,
  encrypted_password,
  last_verified
) ON public.credentials_vault TO crm_vault_app;
GRANT UPDATE (encrypted_username, encrypted_password, last_verified)
  ON public.credentials_vault TO crm_vault_app;

COMMIT;