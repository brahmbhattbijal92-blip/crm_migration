BEGIN;

DROP POLICY IF EXISTS client_documents_delete_tenant ON storage.objects;
CREATE POLICY client_documents_delete_tenant ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND app.can_manage_organization_data(app.current_organization_id())
    AND app.storage_path_is_accessible(name)
  );

COMMIT;