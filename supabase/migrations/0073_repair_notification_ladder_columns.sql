-- Migration 0073: Repair supplier_notification_ladder missing columns
--
-- The table was created by migration 0070 with only the id column.
-- CREATE TABLE IF NOT EXISTS then skipped recreation when 0070 was
-- re-applied. This adds the missing columns.

-- Drop and recreate the table (it's empty, no data loss)
DROP TABLE IF EXISTS public.supplier_notification_ladder CASCADE;

CREATE TABLE public.supplier_notification_ladder (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_request_id   uuid NOT NULL REFERENCES public.supplier_requests(id) ON DELETE CASCADE,
  step_minutes          int NOT NULL,
  sent_at               timestamptz NOT NULL DEFAULT now(),
  channel               text NOT NULL DEFAULT 'outbox',
  idempotency_key       text NOT NULL,
  CONSTRAINT snl_step_check CHECK (step_minutes >= 0),
  CONSTRAINT snl_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX idx_snl_request ON public.supplier_notification_ladder(supplier_request_id);

ALTER TABLE public.supplier_notification_ladder ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY snl_admin_select ON public.supplier_notification_ladder
  FOR SELECT USING (public.is_admin() OR public.has_role(ARRAY['compras']));

CREATE POLICY snl_service_all ON public.supplier_notification_ladder
  FOR ALL USING (
    current_setting('request.jwt.claim.role', true) = 'service_role'
  );

-- Grant access
GRANT SELECT ON public.supplier_notification_ladder TO authenticated;
GRANT ALL ON public.supplier_notification_ladder TO service_role;

COMMENT ON TABLE public.supplier_notification_ladder IS
  'Per-request notification step tracking for the supplier reminder ladder (cron-driven).';
