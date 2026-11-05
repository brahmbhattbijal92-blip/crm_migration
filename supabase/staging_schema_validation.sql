-- Read-only schema validation for the CRM staging project.
-- Run in the Supabase Dashboard SQL Editor as a database administrator.
-- This script does not create, alter, or delete database objects.

WITH expected_tables(schema_name, table_name) AS (
  VALUES
    ('public', 'organizations'),
    ('public', 'profiles'),
    ('public', 'organization_memberships'),
    ('public', 'clients'),
    ('public', 'documents'),
    ('public', 'credentials_vault'),
    ('public', 'financial_invoices'),
    ('public', 'financial_invoice_payments'),
    ('public', 'grants_ledger'),
    ('public', 'client_grant_balances'),
    ('public', 'governance_notifications'),
    ('public', 'financial_ledger'),
    ('storage', 'objects')
),
expected_columns(schema_name, table_name, column_name) AS (
  VALUES
    ('public', 'organizations', 'id'),
    ('public', 'organizations', 'name'),
    ('public', 'organizations', 'created_at'),
    ('public', 'profiles', 'user_id'),
    ('public', 'profiles', 'default_organization_id'),
    ('public', 'profiles', 'display_name'),
    ('public', 'profiles', 'email'),
    ('public', 'profiles', 'created_at'),
    ('public', 'profiles', 'updated_at'),
    ('public', 'organization_memberships', 'organization_id'),
    ('public', 'organization_memberships', 'user_id'),
    ('public', 'organization_memberships', 'role'),
    ('public', 'organization_memberships', 'created_at'),
    ('public', 'clients', 'id'),
    ('public', 'clients', 'organization_id'),
    ('public', 'clients', 'first_name'),
    ('public', 'clients', 'last_name'),
    ('public', 'clients', 'email'),
    ('public', 'clients', 'company'),
    ('public', 'clients', 'status'),
    ('public', 'clients', 'archived_at'),
    ('public', 'clients', 'created_at'),
    ('public', 'clients', 'last_interaction_at'),
    ('public', 'clients', 'updated_at'),
    ('public', 'clients', 'passport_expires_at'),
    ('public', 'clients', 'visa_subclass'),
    ('public', 'clients', 'visa_expires_at'),
    ('public', 'clients', 'deleted_at'),
    ('public', 'clients', 'purge_locked_at'),
    ('public', 'clients', 'purge_locked_by'),
    ('public', 'documents', 'id'),
    ('public', 'documents', 'organization_id'),
    ('public', 'documents', 'client_id'),
    ('public', 'documents', 'bucket_id'),
    ('public', 'documents', 'storage_path'),
    ('public', 'documents', 'file_name'),
    ('public', 'documents', 'file_size'),
    ('public', 'documents', 'mime_type'),
    ('public', 'documents', 'uploaded_by'),
    ('public', 'documents', 'created_at'),
    ('public', 'documents', 'deleted_at'),
    ('public', 'credentials_vault', 'id'),
    ('public', 'credentials_vault', 'organization_id'),
    ('public', 'credentials_vault', 'client_id'),
    ('public', 'credentials_vault', 'portal_name'),
    ('public', 'credentials_vault', 'encrypted_username'),
    ('public', 'credentials_vault', 'encrypted_password'),
    ('public', 'credentials_vault', 'last_verified'),
    ('public', 'credentials_vault', 'created_by'),
    ('public', 'credentials_vault', 'created_at'),
    ('public', 'credentials_vault', 'updated_at'),
    ('public', 'credentials_vault', 'deleted_at'),
    ('public', 'financial_invoices', 'id'),
    ('public', 'financial_invoices', 'organization_id'),
    ('public', 'financial_invoices', 'client_id'),
    ('public', 'financial_invoices', 'invoice_number'),
    ('public', 'financial_invoices', 'amount'),
    ('public', 'financial_invoices', 'currency'),
    ('public', 'financial_invoices', 'status'),
    ('public', 'financial_invoices', 'grant_applied_amount'),
    ('public', 'financial_invoices', 'amount_due'),
    ('public', 'financial_invoices', 'issued_at'),
    ('public', 'financial_invoices', 'due_at'),
    ('public', 'financial_invoices', 'created_by'),
    ('public', 'financial_invoices', 'created_at'),
    ('public', 'financial_invoices', 'updated_at'),
    ('public', 'financial_invoices', 'deleted_at'),
    ('public', 'financial_invoice_payments', 'id'),
    ('public', 'financial_invoice_payments', 'organization_id'),
    ('public', 'financial_invoice_payments', 'client_id'),
    ('public', 'financial_invoice_payments', 'invoice_id'),
    ('public', 'financial_invoice_payments', 'amount'),
    ('public', 'financial_invoice_payments', 'paid_at'),
    ('public', 'financial_invoice_payments', 'created_by'),
    ('public', 'financial_invoice_payments', 'created_at'),
    ('public', 'financial_invoice_payments', 'reverses_payment_id'),
    ('public', 'financial_invoice_payments', 'reversal_reason'),
    ('public', 'grants_ledger', 'id'),
    ('public', 'grants_ledger', 'organization_id'),
    ('public', 'grants_ledger', 'client_id'),
    ('public', 'grants_ledger', 'entry_type'),
    ('public', 'grants_ledger', 'amount'),
    ('public', 'grants_ledger', 'currency'),
    ('public', 'grants_ledger', 'reference'),
    ('public', 'grants_ledger', 'description'),
    ('public', 'grants_ledger', 'grant_source'),
    ('public', 'grants_ledger', 'allocation_date'),
    ('public', 'grants_ledger', 'created_by'),
    ('public', 'grants_ledger', 'created_at'),
    ('public', 'client_grant_balances', 'organization_id'),
    ('public', 'client_grant_balances', 'client_id'),
    ('public', 'client_grant_balances', 'currency'),
    ('public', 'client_grant_balances', 'available_balance'),
    ('public', 'client_grant_balances', 'updated_at'),
    ('public', 'governance_notifications', 'id'),
    ('public', 'governance_notifications', 'organization_id'),
    ('public', 'governance_notifications', 'client_id'),
    ('public', 'governance_notifications', 'recipient_user_id'),
    ('public', 'governance_notifications', 'document_type'),
    ('public', 'governance_notifications', 'expires_on'),
    ('public', 'governance_notifications', 'notice_days'),
    ('public', 'governance_notifications', 'title'),
    ('public', 'governance_notifications', 'message'),
    ('public', 'governance_notifications', 'delivery_status'),
    ('public', 'governance_notifications', 'created_at'),
    ('public', 'governance_notifications', 'delivered_at'),
    ('public', 'governance_notifications', 'read_at'),
    ('public', 'financial_ledger', 'id'),
    ('public', 'financial_ledger', 'organization_id'),
    ('public', 'financial_ledger', 'client_id'),
    ('public', 'financial_ledger', 'type'),
    ('public', 'financial_ledger', 'amount'),
    ('public', 'financial_ledger', 'currency'),
    ('public', 'financial_ledger', 'transaction_date'),
    ('public', 'financial_ledger', 'reference'),
    ('public', 'financial_ledger', 'description'),
    ('public', 'financial_ledger', 'created_by'),
    ('public', 'financial_ledger', 'created_at'),
    ('storage', 'objects', 'id'),
    ('storage', 'objects', 'bucket_id'),
    ('storage', 'objects', 'name')
),
expected_indexes(schema_name, table_name, index_name, key_fragment) AS (
  VALUES
    ('public', 'organization_memberships', 'organization_memberships_user_idx', '(user_id, organization_id)'),
    ('public', 'clients', 'clients_org_updated_idx', '(organization_id, updated_at'),
    ('public', 'clients', 'clients_org_last_interaction_idx', '(organization_id, last_interaction_at'),
    ('public', 'clients', 'clients_org_email_idx', '(organization_id, lower(email)'),
    ('public', 'clients', 'clients_passport_expiration_idx', '(passport_expires_at, organization_id)'),
    ('public', 'clients', 'clients_visa_expiration_idx', '(visa_expires_at, organization_id)'),
    ('public', 'clients', 'clients_org_archived_page_idx', '(organization_id, updated_at DESC, id DESC)'),
    ('public', 'documents', 'documents_org_client_created_idx', '(organization_id, client_id, created_at'),
    ('public', 'credentials_vault', 'credentials_vault_org_client_idx', '(organization_id, client_id, last_verified'),
    ('public', 'financial_invoices', 'financial_invoices_org_status_due_idx', '(organization_id, status, due_at)'),
    ('public', 'financial_invoices', 'financial_invoices_org_client_due_page_idx', '(organization_id, client_id, due_at, id)'),
    ('public', 'financial_invoices', 'financial_invoices_org_id_uidx', '(organization_id, id)'),
    ('public', 'financial_invoice_payments', 'financial_invoice_payments_org_invoice_idx', '(organization_id, invoice_id, paid_at'),
    ('public', 'financial_invoice_payments', 'financial_invoice_payments_org_invoice_id_uidx', '(organization_id, invoice_id, id)'),
    ('public', 'financial_invoice_payments', 'financial_invoice_payments_one_reversal_per_payment_idx', '(reverses_payment_id)'),
    ('public', 'grants_ledger', 'grants_ledger_org_client_created_idx', '(organization_id, client_id, created_at'),
    ('public', 'governance_notifications', 'governance_notifications_org_created_idx', '(organization_id, created_at'),
    ('public', 'governance_notifications', 'governance_notifications_recipient_created_idx', '(recipient_user_id, created_at'),
    ('public', 'financial_ledger', 'financial_ledger_org_client_currency_date_idx', '(organization_id, client_id, currency, transaction_date')
),
expected_rls(schema_name, table_name, requires_force) AS (
  VALUES
    ('public', 'organizations', true),
    ('public', 'profiles', true),
    ('public', 'organization_memberships', true),
    ('public', 'clients', true),
    ('public', 'documents', true),
    ('public', 'credentials_vault', true),
    ('public', 'financial_invoices', true),
    ('public', 'financial_invoice_payments', true),
    ('public', 'grants_ledger', true),
    ('public', 'client_grant_balances', true),
    ('public', 'governance_notifications', true),
    ('public', 'financial_ledger', true),
    ('storage', 'objects', false)
),
expected_triggers(schema_name, table_name, trigger_name) AS (
  VALUES
    ('auth', 'users', 'on_auth_user_created'),
    ('auth', 'users', 'on_auth_user_profile_created'),
    ('public', 'clients', 'clients_set_archive_timestamps'),
    ('public', 'documents', 'documents_block_purge_locked_client'),
    ('public', 'financial_invoices', 'financial_invoices_block_purge_locked_client'),
    ('public', 'financial_ledger', 'financial_ledger_block_purge_locked_client')
),
expected_policies(schema_name, table_name, policy_name, command, guard_terms) AS (
  VALUES
    ('public', 'organizations', 'organizations_read_tenant', 'SELECT', ARRAY['current_organization_id']),
    ('public', 'organizations', 'organizations_admin_update', 'UPDATE', ARRAY['current_organization_id', 'is_organization_admin']),
    ('public', 'profiles', 'profiles_read_self', 'SELECT', ARRAY['auth.uid']),
    ('public', 'profiles', 'profiles_update_self', 'UPDATE', ARRAY['auth.uid']),
    ('public', 'organization_memberships', 'memberships_read_tenant', 'SELECT', ARRAY['current_organization_id']),
    ('public', 'organization_memberships', 'memberships_admin_manage', 'ALL', ARRAY['current_organization_id', 'is_organization_admin']),
    ('public', 'clients', 'clients_read_tenant', 'SELECT', ARRAY['current_organization_id']),
    ('public', 'clients', 'clients_insert_tenant', 'INSERT', ARRAY['current_organization_id', 'can_manage_organization_data']),
    ('public', 'clients', 'clients_update_tenant', 'UPDATE', ARRAY['current_organization_id', 'can_manage_organization_data']),
    ('public', 'documents', 'documents_read_tenant', 'SELECT', ARRAY['current_organization_id']),
    ('public', 'documents', 'documents_insert_tenant', 'INSERT', ARRAY['current_organization_id', 'can_manage_organization_data', 'documents.organization_id']),
    ('public', 'documents', 'documents_update_tenant', 'UPDATE', ARRAY['current_organization_id', 'can_manage_organization_data', 'documents.organization_id']),
    ('public', 'credentials_vault', 'credentials_vault_read_tenant', 'SELECT', ARRAY['current_organization_id', 'can_manage_organization_data']),
    ('public', 'credentials_vault', 'credentials_vault_insert_tenant', 'INSERT', ARRAY['current_organization_id', 'can_manage_organization_data']),
    ('public', 'credentials_vault', 'credentials_vault_update_tenant', 'UPDATE', ARRAY['current_organization_id', 'can_manage_organization_data']),
    ('public', 'financial_invoices', 'financial_invoices_read_tenant', 'SELECT', ARRAY['current_organization_id']),
    ('public', 'financial_invoices', 'financial_invoices_update_tenant', 'UPDATE', ARRAY['current_organization_id', 'can_manage_organization_data']),
    ('public', 'financial_invoice_payments', 'financial_invoice_payments_read_tenant', 'SELECT', ARRAY['current_organization_id']),
    ('public', 'grants_ledger', 'grants_ledger_read_tenant', 'SELECT', ARRAY['current_organization_id', 'can_manage_organization_data']),
    ('public', 'client_grant_balances', 'client_grant_balances_read_tenant', 'SELECT', ARRAY['current_organization_id', 'can_manage_organization_data']),
    ('public', 'governance_notifications', 'governance_notifications_agent_read', 'SELECT', ARRAY['current_organization_id', 'auth.uid']),
    ('public', 'governance_notifications', 'governance_notifications_agent_update', 'UPDATE', ARRAY['current_organization_id', 'auth.uid']),
    ('public', 'financial_ledger', 'financial_ledger_read_tenant', 'SELECT', ARRAY['current_organization_id']),
    ('public', 'financial_ledger', 'financial_ledger_insert_tenant', 'INSERT', ARRAY['current_organization_id', 'can_manage_organization_data', 'financial_ledger.organization_id']),
    ('storage', 'objects', 'client_documents_read_tenant', 'SELECT', ARRAY['current_organization_id']),
    ('storage', 'objects', 'client_documents_insert_tenant', 'INSERT', ARRAY['can_manage_organization_data', 'storage_path_targets_active_client']),
    ('storage', 'objects', 'client_documents_update_tenant', 'UPDATE', ARRAY['can_manage_organization_data', 'storage_path_targets_active_client']),
    ('storage', 'objects', 'client_documents_delete_tenant', 'DELETE', ARRAY['is_organization_admin', 'current_organization_id'])
),
expected_functions(signature, require_definer) AS (
  VALUES
    ('app.current_organization_id()', true),
    ('app.is_organization_admin(uuid)', true),
    ('app.can_manage_organization_data(uuid)', true),
    ('public.create_organization_for_current_user(text)', true),
    ('public.allocate_client_grant(uuid,numeric,text,text,date)', true),
    ('public.create_client_invoice(uuid,text,numeric,text,timestamptz)', true),
    ('public.record_client_invoice_payment(uuid,numeric,timestamptz)', true),
    ('public.get_client_financial_summary(uuid)', false),
    ('public.archive_client(uuid)', true),
    ('public.restore_archived_client(uuid)', true),
    ('app.begin_client_purge(uuid[])', true),
    ('app.finalize_client_purge(uuid[])', true),
    ('app.cancel_client_purge(uuid[])', true),
    ('public.begin_client_purge(uuid[])', false),
    ('public.finalize_client_purge(uuid[])', false),
    ('public.cancel_client_purge(uuid[])', false),
    ('public.void_invoice(uuid,text)', true),
    ('public.reverse_invoice_payment(uuid,text)', true),
    ('public.assert_client_document_uploadable(uuid)', true),
    ('public.allocate_grant(uuid,numeric,text,text)', true),
    ('public.draw_down_grant(uuid,numeric,text,text)', true),
    ('public.record_invoice_charge(uuid,numeric,text,text)', true),
    ('public.record_invoice_payment(uuid,numeric,text,text)', true)
),
table_checks AS (
  SELECT
    'TABLE'::text AS category,
    format('%I.%I', expected.schema_name, expected.table_name) AS object_name,
    CASE WHEN actual.tablename IS NULL THEN 'MISSING' ELSE 'OK' END::text AS status,
    CASE WHEN actual.tablename IS NULL THEN 'Table not found in pg_tables.' ELSE 'Table exists.' END::text AS details
  FROM expected_tables AS expected
  LEFT JOIN pg_catalog.pg_tables AS actual
    ON actual.schemaname = expected.schema_name
   AND actual.tablename = expected.table_name
),
column_checks AS (
  SELECT
    'COLUMN'::text AS category,
    format('%I.%I.%I', expected.schema_name, expected.table_name, expected.column_name) AS object_name,
    CASE WHEN actual.column_name IS NULL THEN 'MISSING' ELSE 'OK' END::text AS status,
    coalesce(actual.data_type, 'Column not found in information_schema.columns.')::text AS details
  FROM expected_columns AS expected
  LEFT JOIN information_schema.columns AS actual
    ON actual.table_schema = expected.schema_name
   AND actual.table_name = expected.table_name
   AND actual.column_name = expected.column_name
),
rls_checks AS (
  SELECT
    'RLS'::text AS category,
    format('%I.%I', expected.schema_name, expected.table_name) AS object_name,
    CASE
      WHEN relation.oid IS NULL THEN 'MISSING'
      WHEN NOT relation.relrowsecurity THEN 'MISSING'
      WHEN expected.requires_force AND NOT relation.relforcerowsecurity THEN 'CHECK'
      ELSE 'OK'
    END::text AS status,
    CASE
      WHEN relation.oid IS NULL THEN 'Table relation not found.'
      ELSE format('rowsecurity=%s, force_row_security=%s', relation.relrowsecurity, relation.relforcerowsecurity)
    END::text AS details
  FROM expected_rls AS expected
  LEFT JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.nspname = expected.schema_name
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = namespace.oid
   AND relation.relname = expected.table_name
   AND relation.relkind IN ('r', 'p')
),
trigger_checks AS (
  SELECT
    'TRIGGER'::text AS category,
    format('%I.%I.%I', expected.schema_name, expected.table_name, expected.trigger_name) AS object_name,
    CASE
      WHEN trigger.oid IS NULL THEN 'MISSING'
      WHEN trigger.tgenabled = 'D' THEN 'CHECK'
      ELSE 'OK'
    END::text AS status,
    CASE
      WHEN trigger.oid IS NULL THEN 'Trigger not found in pg_trigger.'
      ELSE format('enabled=%s', trigger.tgenabled)
    END::text AS details
  FROM expected_triggers AS expected
  LEFT JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.nspname = expected.schema_name
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = namespace.oid
   AND relation.relname = expected.table_name
  LEFT JOIN pg_catalog.pg_trigger AS trigger
    ON trigger.tgrelid = relation.oid
   AND trigger.tgname = expected.trigger_name
   AND NOT trigger.tgisinternal
),
policy_checks AS (
  SELECT
    'POLICY'::text AS category,
    format('%I.%I.%I', expected.schema_name, expected.table_name, expected.policy_name) AS object_name,
    CASE
      WHEN actual.policyname IS NULL THEN 'MISSING'
      WHEN actual.cmd <> expected.command THEN 'CHECK'
      WHEN NOT ('authenticated' = ANY(actual.roles::text[])) THEN 'CHECK'
      WHEN EXISTS (
        SELECT 1
        FROM unnest(expected.guard_terms) AS guards(term)
        WHERE position(lower(term) in lower(concat_ws(' ', actual.qual, actual.with_check))) = 0
      ) THEN 'CHECK'
      ELSE 'OK'
    END::text AS status,
    CASE
      WHEN actual.policyname IS NULL THEN 'Expected policy not found in pg_policies.'
      ELSE format('cmd=%s roles=%s using=%s with_check=%s', actual.cmd, actual.roles, coalesce(actual.qual, '-'), coalesce(actual.with_check, '-'))
    END::text AS details
  FROM expected_policies AS expected
  LEFT JOIN pg_catalog.pg_policies AS actual
    ON actual.schemaname = expected.schema_name
   AND actual.tablename = expected.table_name
   AND actual.policyname = expected.policy_name
),
index_checks AS (
  SELECT
    'INDEX'::text AS category,
    format('%I.%I.%I', expected.schema_name, expected.table_name, expected.index_name) AS object_name,
    CASE
      WHEN actual.indexname IS NULL THEN 'MISSING'
      WHEN position(lower(expected.key_fragment) in lower(actual.indexdef)) = 0 THEN 'CHECK'
      ELSE 'OK'
    END::text AS status,
    coalesce(actual.indexdef, 'Index not found in pg_indexes.')::text AS details
  FROM expected_indexes AS expected
  LEFT JOIN pg_catalog.pg_indexes AS actual
    ON actual.schemaname = expected.schema_name
   AND actual.tablename = expected.table_name
   AND actual.indexname = expected.index_name
),
function_checks AS (
  SELECT
    'FUNCTION'::text AS category,
    expected.signature::text AS object_name,
    CASE
      WHEN procedure.oid IS NULL THEN 'MISSING'
      WHEN expected.require_definer AND NOT procedure.prosecdef THEN 'CHECK'
      WHEN NOT EXISTS (
        SELECT 1
        FROM unnest(coalesce(procedure.proconfig, ARRAY[]::text[])) AS settings(setting)
        WHERE setting LIKE 'search_path=%'
      ) THEN 'CHECK'
      WHEN NOT has_function_privilege('authenticated', procedure.oid, 'EXECUTE') THEN 'CHECK'
      ELSE 'OK'
    END::text AS status,
    CASE
      WHEN procedure.oid IS NULL THEN 'Function signature not found.'
      ELSE format('security_definer=%s, config=%s, authenticated_execute=%s', procedure.prosecdef, coalesce(procedure.proconfig::text, '{}'), has_function_privilege('authenticated', procedure.oid, 'EXECUTE'))
    END::text AS details
  FROM expected_functions AS expected
  LEFT JOIN pg_catalog.pg_proc AS procedure
    ON procedure.oid = to_regprocedure(expected.signature)::oid
),
bucket_checks AS (
  SELECT
    'STORAGE_BUCKET'::text AS category,
    'storage.buckets.client-documents'::text AS object_name,
    CASE WHEN bucket.id IS NULL THEN 'MISSING' WHEN bucket.public THEN 'CHECK' ELSE 'OK' END::text AS status,
    CASE WHEN bucket.id IS NULL THEN 'Bucket not found.' ELSE format('public=%s', bucket.public) END::text AS details
  FROM (SELECT 'client-documents'::text AS id) AS expected
  LEFT JOIN storage.buckets AS bucket ON bucket.id = expected.id
),
checks AS (
  SELECT * FROM table_checks
  UNION ALL SELECT * FROM column_checks
  UNION ALL SELECT * FROM rls_checks
  UNION ALL SELECT * FROM trigger_checks
  UNION ALL SELECT * FROM policy_checks
  UNION ALL SELECT * FROM index_checks
  UNION ALL SELECT * FROM function_checks
  UNION ALL SELECT * FROM bucket_checks
)
SELECT category, object_name, status, details
FROM (
  SELECT category, object_name, status, details, 1 AS sort_group
  FROM checks
  UNION ALL
  SELECT
    'SUMMARY',
    'Schema validation totals',
    CASE
      WHEN count(*) FILTER (WHERE status = 'MISSING') > 0 THEN 'MISSING'
      WHEN count(*) FILTER (WHERE status = 'CHECK') > 0 THEN 'CHECK'
      ELSE 'OK'
    END,
    format(
      'OK=%s, CHECK=%s, MISSING=%s, TOTAL=%s',
      count(*) FILTER (WHERE status = 'OK'),
      count(*) FILTER (WHERE status = 'CHECK'),
      count(*) FILTER (WHERE status = 'MISSING'),
      count(*)
    ),
    0 AS sort_group
  FROM checks
) AS diagnostic
ORDER BY sort_group, category, object_name;