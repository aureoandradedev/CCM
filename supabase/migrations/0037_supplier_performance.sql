-- 0037_supplier_performance.sql
-- Supplier performance events (observational only) + extend SPO with confirmed_at.
-- Bloco 4: NO scores, NO rankings, NO automatic actions.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. supplier_performance_events — pure event log
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.supplier_performance_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id      text NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  event_type       text NOT NULL CHECK (event_type IN (
    'po_sent',
    'po_confirmed',
    'po_confirmation_timeout',
    'delivery_on_time',
    'delivery_late',
    'receiving_full_match',
    'receiving_shortage',
    'receiving_excess',
    'receiving_damage',
    'receiving_swap',
    'cut_from_cycle'
  )),
  reference_type   text,          -- 'purchase_order', 'receiving_session', etc.
  reference_id     uuid,          -- FK-less to stay flexible
  metric_value     numeric,       -- optional numeric (e.g. shortage qty, hours late)
  data             jsonb DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_spe_supplier_type_created
  ON public.supplier_performance_events (supplier_id, event_type, created_at DESC);

CREATE INDEX idx_spe_reference
  ON public.supplier_performance_events (reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

-- Idempotency: unique per (supplier, event_type, reference_type, reference_id)
-- Prevents duplicate events for the same occurrence
CREATE UNIQUE INDEX idx_spe_idempotency
  ON public.supplier_performance_events (supplier_id, event_type, reference_type, reference_id)
  WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL;

-- RLS: admin-only
ALTER TABLE public.supplier_performance_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin all supplier_performance_events"
  ON public.supplier_performance_events FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON public.supplier_performance_events FROM anon;
REVOKE ALL ON public.supplier_performance_events FROM authenticated;
GRANT SELECT, INSERT ON public.supplier_performance_events TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Extend supplier_purchase_orders: confirmed_at
-- ═══════════════════════════════════════════════════════════════════════════

-- confirmed_at: when supplier confirmed the PO (admin records this)
DO $$ BEGIN
  ALTER TABLE public.supplier_purchase_orders ADD COLUMN confirmed_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- expected_delivery_at: more precise than expected_delivery (date)
-- Already has expected_delivery (date) — add timestamptz version for performance calc
DO $$ BEGIN
  ALTER TABLE public.supplier_purchase_orders ADD COLUMN expected_delivery_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Extend PO decision options: add move_supplier, pay_fee
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.supplier_purchase_orders
  DROP CONSTRAINT IF EXISTS supplier_purchase_orders_decision_check;

ALTER TABLE public.supplier_purchase_orders
  ADD CONSTRAINT supplier_purchase_orders_decision_check
  CHECK (decision IS NULL OR decision IN (
    'complete_order',
    'send_extra',
    'wait_next_cycle',
    'move_supplier',
    'pay_fee'
  ));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Config: confirmation timeout
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.ccm_configs (key, scope, value)
SELECT 'po_confirmation_timeout_hours', 'global', '48'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.ccm_configs WHERE key = 'po_confirmation_timeout_hours' AND scope = 'global'
);
