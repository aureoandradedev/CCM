-- 0039_fiscal_documents.sql
-- Fiscal document tracking for Uniplus DAV integration.
-- Tracks DAV lifecycle: creation, invoicing, cancellation.
-- Strategy (per-order vs per-shipment) controlled by ccm_configs.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. fiscal_documents — one row per fiscal document attempt
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.fiscal_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  shipment_id         uuid REFERENCES public.order_shipments(id) ON DELETE RESTRICT,
  provider            text NOT NULL DEFAULT 'uniplus_dav',
  provider_reference  text,
  codigo_ecommerce    text NOT NULL,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'sending',
    'created',
    'invoiced',
    'cancelled',
    'error'
  )),
  attempt_count       int NOT NULL DEFAULT 0,
  payload_hash        text,
  raw_response        jsonb,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz,
  invoiced_at         timestamptz,
  cancelled_at        timestamptz
);

CREATE TRIGGER fiscal_documents_updated_at
  BEFORE UPDATE ON public.fiscal_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Idempotency: one fiscal document per (order, shipment, provider) context
-- shipment_id IS NULL means "whole order" strategy
CREATE UNIQUE INDEX idx_fiscal_doc_idempotency
  ON public.fiscal_documents (order_id, COALESCE(shipment_id, '00000000-0000-0000-0000-000000000000'::uuid), provider)
  WHERE status != 'cancelled';

-- Lookup by codigoECommerce (for Uniplus find-by-reference)
CREATE UNIQUE INDEX idx_fiscal_doc_codigo_ecommerce
  ON public.fiscal_documents (codigo_ecommerce)
  WHERE status != 'cancelled';

-- Lookup by provider reference (DAV number from Uniplus)
CREATE INDEX idx_fiscal_doc_provider_ref
  ON public.fiscal_documents (provider_reference)
  WHERE provider_reference IS NOT NULL;

-- Pending documents for sync/watcher
CREATE INDEX idx_fiscal_doc_pending
  ON public.fiscal_documents (status, created_at)
  WHERE status IN ('pending', 'sending', 'created', 'error');

-- Per-order listing
CREATE INDEX idx_fiscal_doc_order
  ON public.fiscal_documents (order_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. RLS: admin-only
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.fiscal_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin all fiscal_documents"
  ON public.fiscal_documents FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON public.fiscal_documents FROM anon;
REVOKE ALL ON public.fiscal_documents FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.fiscal_documents TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Config: fiscal feature flag + strategy
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.ccm_configs (key, scope, value)
SELECT 'fiscal_uniplus_enabled', 'global', 'false'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.ccm_configs WHERE key = 'fiscal_uniplus_enabled' AND scope = 'global'
);

INSERT INTO public.ccm_configs (key, scope, value)
SELECT 'fiscal_strategy', 'global', '"per_order"'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.ccm_configs WHERE key = 'fiscal_strategy' AND scope = 'global'
);
