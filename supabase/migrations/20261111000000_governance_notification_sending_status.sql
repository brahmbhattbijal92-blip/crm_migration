BEGIN;

ALTER TABLE public.governance_notifications
  DROP CONSTRAINT IF EXISTS governance_notifications_delivery_status_check;

ALTER TABLE public.governance_notifications
  ADD CONSTRAINT governance_notifications_delivery_status_check
    CHECK (delivery_status IN ('queued', 'sending', 'simulated', 'sent', 'failed'));

COMMIT;