-- ============================================================================
-- CCM · 0057 — Supplier confirmation infrastructure
-- ============================================================================
--
-- Suppliers must confirm item availability before customers pay.
-- This migration adds:
--   1. po_mirrors table (espelhos/mirror documents uploaded by supplier)
--   2. supplier_confirmation_status + columns on supplier_purchase_orders
--   3. Item-level confirmation columns on purchase_order_items
--   4. customer_acceptance_required + customer_accepted_at on orders
--   5. order_notification_outbox table (async notification dispatch)
--   6. Storage policies for the 'espelhos' bucket (created in 0056)
--   7. RPC confirm_supplier_po     — supplier confirms PO item by item
--   8. RPC check_order_supplier_gate — checks if all supplier parts resolved
--   9. RPC accept_order_adjustments — customer accepts price/qty changes
--
-- All operations are idempotent.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. po_mirrors — espelhos / mirror documents
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.po_mirrors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.supplier_purchase_orders(id) ON DELETE CASCADE,
  supplier_id       text NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  uploaded_by       uuid NOT NULL REFERENCES public.profiles(id),
  file_path         text NOT NULL,
  file_type         text NOT NULL,
  file_size_bytes   int,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT po_mirrors_file_type_check CHECK (file_type IN ('pdf','jpeg','png','webp'))
);

CREATE INDEX IF NOT EXISTS idx_po_mirrors_po ON public.po_mirrors(purchase_order_id);

ALTER TABLE public.po_mirrors ENABLE ROW LEVEL SECURITY;

-- Supplier can INSERT on own POs (owns_supplier from migration 0013)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'po_mirrors' AND policyname = 'po_mirrors_supplier_insert'
  ) THEN
    CREATE POLICY po_mirrors_supplier_insert ON public.po_mirrors
      FOR INSERT TO authenticated
      WITH CHECK (public.owns_supplier(supplier_id));
  END IF;
END $$;

-- Supplier can SELECT own mirrors
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'po_mirrors' AND policyname = 'po_mirrors_supplier_select'
  ) THEN
    CREATE POLICY po_mirrors_supplier_select ON public.po_mirrors
      FOR SELECT TO authenticated
      USING (public.owns_supplier(supplier_id));
  END IF;
END $$;

-- Admin/compras can SELECT all
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'po_mirrors' AND policyname = 'po_mirrors_admin_select'
  ) THEN
    CREATE POLICY po_mirrors_admin_select ON public.po_mirrors
      FOR SELECT TO authenticated
      USING (public.is_admin());
  END IF;
END $$;

-- ============================================================================
-- 2. Add supplier confirmation columns to supplier_purchase_orders
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'supplier_purchase_orders'
      AND column_name = 'supplier_confirmation_status'
  ) THEN
    ALTER TABLE public.supplier_purchase_orders
      ADD COLUMN supplier_confirmation_status text NOT NULL DEFAULT 'aguardando_confirmacao_fornecedor',
      ADD COLUMN supplier_confirmed_at timestamptz,
      ADD COLUMN supplier_confirmed_by uuid REFERENCES public.profiles(id);

    ALTER TABLE public.supplier_purchase_orders
      ADD CONSTRAINT spo_supplier_confirmation_status_check
      CHECK (supplier_confirmation_status IN (
        'aguardando_confirmacao_fornecedor',
        'confirmado',
        'confirmado_parcial',
        'divergencia',
        'revisao_necessaria'
      ));
  END IF;
END $$;

-- ============================================================================
-- 3. Add supplier confirmation columns to purchase_order_items
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'purchase_order_items'
      AND column_name = 'qty_supplier_confirmed'
  ) THEN
    ALTER TABLE public.purchase_order_items
      ADD COLUMN qty_supplier_confirmed int,
      ADD COLUMN supplier_item_status text,
      ADD COLUMN cost_supplier_confirmed_centavos int,
      ADD COLUMN supplier_notes text;

    ALTER TABLE public.purchase_order_items
      ADD CONSTRAINT poi_supplier_item_status_check
      CHECK (supplier_item_status IN (
        'confirmado',
        'confirmado_parcial',
        'indisponivel',
        'divergencia_quantidade',
        'divergencia_custo',
        'revisao_necessaria'
      ));
  END IF;
END $$;

-- ============================================================================
-- 4. Add customer acceptance columns to orders (used by accept_order_adjustments)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'
      AND column_name = 'customer_acceptance_required'
  ) THEN
    ALTER TABLE public.orders
      ADD COLUMN customer_acceptance_required boolean NOT NULL DEFAULT false,
      ADD COLUMN customer_accepted_at timestamptz;
  END IF;
END $$;

-- ============================================================================
-- 5. order_notification_outbox — async notification dispatch
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.order_notification_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event_type      text NOT NULL,
  recipient_type  text NOT NULL,
  recipient_id    text,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  CONSTRAINT outbox_recipient_type_check CHECK (recipient_type IN ('customer','supplier')),
  CONSTRAINT outbox_status_check CHECK (status IN ('pending','sent','failed','skipped')),
  CONSTRAINT outbox_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_outbox_status ON public.order_notification_outbox(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_outbox_order  ON public.order_notification_outbox(order_id);

ALTER TABLE public.order_notification_outbox ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated — service_role only via backend

-- ============================================================================
-- 6. Storage policies for 'espelhos' bucket (created in 0056)
-- ============================================================================

-- Supplier can upload to their own path: espelhos/{supplier_id}/*
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'espelhos_supplier_upload'
  ) THEN
    CREATE POLICY espelhos_supplier_upload ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'espelhos'
        AND public.owns_supplier((storage.foldername(name))[1])
      );
  END IF;
END $$;

-- Supplier can read own files
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'espelhos_supplier_read'
  ) THEN
    CREATE POLICY espelhos_supplier_read ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'espelhos'
        AND public.owns_supplier((storage.foldername(name))[1])
      );
  END IF;
END $$;

-- Admin can read all espelhos
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'espelhos_admin_read'
  ) THEN
    CREATE POLICY espelhos_admin_read ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'espelhos'
        AND public.is_admin()
      );
  END IF;
END $$;

-- ============================================================================
-- 7. RPC: confirm_supplier_po — supplier confirms PO item by item
-- ============================================================================

CREATE OR REPLACE FUNCTION public.confirm_supplier_po(
  p_po_id uuid,
  p_items jsonb,  -- array of {item_id, qty_confirmed, status, cost_confirmed_centavos?, notes?}
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_po record;
  v_caller_id uuid;
  v_item jsonb;
  v_poi record;
  v_all_confirmed boolean := true;
  v_has_partial boolean := false;
  v_has_divergence boolean := false;
  v_has_review boolean := false;
  v_final_status text;
  v_updated int := 0;
BEGIN
  v_caller_id := auth.uid();

  -- 1. Load PO and validate ownership
  SELECT spo.* INTO v_po
    FROM public.supplier_purchase_orders spo
   WHERE spo.id = p_po_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido de compra nao encontrado.');
  END IF;

  IF NOT public.owns_supplier(v_po.supplier_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
  END IF;

  IF v_po.supplier_confirmation_status NOT IN ('aguardando_confirmacao_fornecedor') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esta solicitacao ja foi respondida.');
  END IF;

  -- 2. Process each item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_poi
      FROM public.purchase_order_items
     WHERE id = (v_item->>'item_id')::uuid
       AND purchase_order_id = p_po_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Item nao encontrado: ' || (v_item->>'item_id'));
    END IF;

    UPDATE public.purchase_order_items SET
      qty_supplier_confirmed = (v_item->>'qty_confirmed')::int,
      supplier_item_status = v_item->>'status',
      cost_supplier_confirmed_centavos = CASE
        WHEN v_item->>'cost_confirmed_centavos' IS NOT NULL
        THEN (v_item->>'cost_confirmed_centavos')::int
        ELSE NULL
      END,
      supplier_notes = v_item->>'notes'
    WHERE id = v_poi.id;

    v_updated := v_updated + 1;

    -- Track status composition
    CASE v_item->>'status'
      WHEN 'confirmado' THEN NULL; -- all good
      WHEN 'confirmado_parcial' THEN v_has_partial := true; v_all_confirmed := false;
      WHEN 'indisponivel' THEN v_has_partial := true; v_all_confirmed := false;
      WHEN 'divergencia_quantidade' THEN v_has_divergence := true; v_all_confirmed := false;
      WHEN 'divergencia_custo' THEN v_has_divergence := true; v_all_confirmed := false;
      WHEN 'revisao_necessaria' THEN v_has_review := true; v_all_confirmed := false;
      ELSE v_all_confirmed := false;
    END CASE;
  END LOOP;

  -- 3. Determine PO-level status
  IF v_has_review THEN
    v_final_status := 'revisao_necessaria';
  ELSIF v_has_divergence THEN
    v_final_status := 'divergencia';
  ELSIF v_has_partial THEN
    v_final_status := 'confirmado_parcial';
  ELSIF v_all_confirmed THEN
    v_final_status := 'confirmado';
  ELSE
    v_final_status := 'divergencia';
  END IF;

  -- 4. Update PO
  UPDATE public.supplier_purchase_orders SET
    supplier_confirmation_status = v_final_status,
    supplier_confirmed_at = now(),
    supplier_confirmed_by = v_caller_id
  WHERE id = p_po_id;

  -- 5. Register event (find any order linked to this PO's requirements)
  INSERT INTO public.order_events (order_id, type, data, actor_kind, actor_id)
  SELECT DISTINCT pr.source_order_id,
    'confirmacao_fornecedor',
    jsonb_build_object(
      'po_id', p_po_id,
      'supplier_id', v_po.supplier_id,
      'status', v_final_status,
      'items_updated', v_updated
    ),
    'supplier',
    v_caller_id::text
  FROM public.purchase_requirements pr
  JOIN public.purchase_order_items poi ON poi.master_product_id = pr.master_product_id
    AND poi.purchase_order_id = p_po_id
  WHERE pr.source_order_id IS NOT NULL
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'status', v_final_status,
    'items_updated', v_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_supplier_po(uuid, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_supplier_po(uuid, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_supplier_po(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_supplier_po(uuid, jsonb, text) TO service_role;

-- ============================================================================
-- 8. RPC: check_order_supplier_gate — all supplier parts resolved?
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_order_supplier_gate(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order record;
  v_total_pos int;
  v_resolved_pos int;
  v_unresolved jsonb;
  v_has_adjustments boolean := false;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao encontrado.');
  END IF;

  IF v_order.order_status <> 'aguardando-confirmacao' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao esta em aguardando-confirmacao.');
  END IF;

  -- Count POs linked to this order via purchase_requirements
  SELECT
    COUNT(DISTINCT spo.id),
    COUNT(DISTINCT spo.id) FILTER (
      WHERE spo.supplier_confirmation_status NOT IN ('aguardando_confirmacao_fornecedor', 'revisao_necessaria')
    )
  INTO v_total_pos, v_resolved_pos
  FROM public.purchase_requirements pr
  JOIN public.purchase_order_items poi ON poi.master_product_id = pr.master_product_id
    AND poi.purchase_order_id IN (
      SELECT spo2.id FROM public.supplier_purchase_orders spo2
      WHERE spo2.supplier_id = pr.supplier_id AND spo2.cycle_date = pr.cycle_date
    )
  JOIN public.supplier_purchase_orders spo ON spo.id = poi.purchase_order_id
  WHERE pr.source_order_id = p_order_id;

  IF v_total_pos = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nenhuma PO encontrada para este pedido.');
  END IF;

  -- Check if there are quantity adjustments
  SELECT EXISTS(
    SELECT 1 FROM public.order_items
    WHERE order_id = p_order_id
      AND qty_confirmed IS NOT NULL
      AND qty_confirmed <> qty
  ) INTO v_has_adjustments;

  RETURN jsonb_build_object(
    'ok', true,
    'total_pos', v_total_pos,
    'resolved_pos', v_resolved_pos,
    'all_resolved', v_total_pos = v_resolved_pos,
    'has_adjustments', v_has_adjustments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_order_supplier_gate(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_order_supplier_gate(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.check_order_supplier_gate(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_order_supplier_gate(uuid) TO service_role;

-- ============================================================================
-- 9. RPC: accept_order_adjustments — customer accepts price/qty changes
-- ============================================================================

CREATE OR REPLACE FUNCTION public.accept_order_adjustments(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order record;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao encontrado.');
  END IF;

  IF v_order.order_status <> 'aguardando-confirmacao' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao esta aguardando aceite.');
  END IF;

  IF NOT v_order.customer_acceptance_required THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este pedido nao requer aceite.');
  END IF;

  -- Mark accepted and advance to aguardando-pagamento
  UPDATE public.orders SET
    customer_accepted_at = now(),
    order_status = 'aguardando-pagamento'
  WHERE id = p_order_id;

  -- Register event
  INSERT INTO public.order_events (order_id, type, data, actor_kind)
  VALUES (p_order_id, 'cliente_aceitou_ajuste', '{}'::jsonb, 'customer');

  -- Outbox: payment unlocked
  INSERT INTO public.order_notification_outbox (
    order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
  )
  VALUES (
    p_order_id,
    'pagamento_liberado',
    'customer',
    v_order.profile_id::text,
    jsonb_build_object('code', v_order.code, 'total_centavos', v_order.total_centavos),
    p_order_id || ':pagamento_liberado:' || COALESCE(v_order.profile_id::text, 'guest')
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_order_adjustments(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_order_adjustments(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_order_adjustments(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_order_adjustments(uuid) TO service_role;

-- ============================================================================
-- 10. COMMENTS
-- ============================================================================

COMMENT ON TABLE public.po_mirrors IS
  'Espelhos/mirror documents uploaded by suppliers to confirm PO pricing and availability.';

COMMENT ON COLUMN public.po_mirrors.purchase_order_id IS 'The purchase order this mirror belongs to.';
COMMENT ON COLUMN public.po_mirrors.file_path IS 'Storage path within the espelhos bucket.';
COMMENT ON COLUMN public.po_mirrors.file_type IS 'MIME sub-type: pdf, jpeg, png, or webp.';

COMMENT ON TABLE public.order_notification_outbox IS
  'Transactional outbox for async order notifications (email, push, WhatsApp). Processed by backend worker.';

COMMENT ON COLUMN public.order_notification_outbox.idempotency_key IS 'Prevents duplicate notifications for the same event.';
COMMENT ON COLUMN public.order_notification_outbox.status IS 'pending -> sent | failed | skipped.';

COMMENT ON COLUMN public.supplier_purchase_orders.supplier_confirmation_status IS
  'Supplier-side confirmation status: aguardando_confirmacao_fornecedor, confirmado, confirmado_parcial, divergencia, revisao_necessaria.';
COMMENT ON COLUMN public.supplier_purchase_orders.supplier_confirmed_at IS 'Timestamp when supplier confirmed.';
COMMENT ON COLUMN public.supplier_purchase_orders.supplier_confirmed_by IS 'Profile that confirmed on behalf of the supplier.';

COMMENT ON COLUMN public.purchase_order_items.qty_supplier_confirmed IS 'Quantity the supplier confirmed as available.';
COMMENT ON COLUMN public.purchase_order_items.supplier_item_status IS 'Item-level supplier confirmation status.';
COMMENT ON COLUMN public.purchase_order_items.cost_supplier_confirmed_centavos IS 'Unit cost confirmed by supplier (centavos). NULL = same as requested.';
COMMENT ON COLUMN public.purchase_order_items.supplier_notes IS 'Free-text notes from supplier about this item.';

COMMENT ON COLUMN public.orders.customer_acceptance_required IS 'True when supplier confirmation resulted in changes the customer must accept before paying.';
COMMENT ON COLUMN public.orders.customer_accepted_at IS 'When the customer accepted the adjustments.';

COMMENT ON FUNCTION public.confirm_supplier_po(uuid, jsonb, text) IS
  'Supplier confirms a purchase order item by item. Updates item statuses, PO confirmation status, and registers an order event.';

COMMENT ON FUNCTION public.check_order_supplier_gate(uuid) IS
  'Checks whether all supplier purchase orders linked to a customer order are resolved (confirmed or partially confirmed).';

COMMENT ON FUNCTION public.accept_order_adjustments(uuid) IS
  'Customer accepts price/quantity adjustments from supplier confirmation. Advances order to aguardando-pagamento.';

COMMIT;
