-- ============================================================================
-- CCM · 0058 — Supplier requests (pre-payment confirmation, separate from POs)
-- ============================================================================
--
-- Before payment: creates supplier_requests + supplier_request_lines at checkout.
-- After payment: creates official supplier_purchase_orders via RPC.
--
-- Guards implemented:
--   G1: Transactional creation (RPC create_supplier_requests_for_order)
--   G2: request→PO linkage (supplier_purchase_orders.source_request_id FK)
--   G3: Idempotency (UNIQUE constraints, ON CONFLICT DO NOTHING)
--   G4: Pre-payment cancellation (cancel_order_requests RPC)
--   G5: Partial confirmation feeds order_items adjustments
--   G6: viewed_at idempotent registration
--   G7: Outbox/events for all lifecycle stages
--   G8: Checkout no longer uses purchase_requirements
--   G9: PO official only after payment, compatible with operational flow
--   G10: No edits to 0056/0057, no deletions
--
-- All operations are idempotent (IF NOT EXISTS, ON CONFLICT DO NOTHING).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. supplier_requests — pre-payment confirmation requests
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.supplier_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  supplier_id      text NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'aguardando_confirmacao',
  round_number     int NOT NULL DEFAULT 1,
  sent_at          timestamptz NOT NULL DEFAULT now(),
  viewed_at        timestamptz,
  responded_at     timestamptz,
  responded_by     uuid REFERENCES public.profiles(id),
  expires_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  idempotency_key  text NOT NULL,
  CONSTRAINT sr_status_check CHECK (status IN (
    'aguardando_confirmacao',
    'confirmado',
    'confirmado_parcial',
    'divergencia',
    'revisao_necessaria',
    'cancelado'
  )),
  CONSTRAINT sr_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_sr_order ON public.supplier_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_sr_supplier ON public.supplier_requests(supplier_id);
CREATE INDEX IF NOT EXISTS idx_sr_status ON public.supplier_requests(status)
  WHERE status = 'aguardando_confirmacao';

ALTER TABLE public.supplier_requests ENABLE ROW LEVEL SECURITY;

-- Supplier can SELECT own requests
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'supplier_requests' AND policyname = 'sr_supplier_select'
  ) THEN
    CREATE POLICY sr_supplier_select ON public.supplier_requests
      FOR SELECT TO authenticated
      USING (public.owns_supplier(supplier_id));
  END IF;
END $$;

-- Admin can SELECT all
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'supplier_requests' AND policyname = 'sr_admin_select'
  ) THEN
    CREATE POLICY sr_admin_select ON public.supplier_requests
      FOR SELECT TO authenticated
      USING (public.is_admin());
  END IF;
END $$;

-- ============================================================================
-- 2. supplier_request_lines — items within a request
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.supplier_request_lines (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_request_id     uuid NOT NULL REFERENCES public.supplier_requests(id) ON DELETE CASCADE,
  order_item_id           uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  master_product_id       text,
  product_name            text NOT NULL,
  quantity_requested      int NOT NULL,
  unit                    text,
  unit_cost_centavos      int NOT NULL,
  quantity_confirmed      int,
  status                  text,
  cost_confirmed_centavos int,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT srl_status_check CHECK (status IS NULL OR status IN (
    'pendente',
    'confirmado',
    'confirmado_parcial',
    'indisponivel',
    'divergencia_quantidade',
    'divergencia_custo',
    'revisao_necessaria'
  ))
);

CREATE INDEX IF NOT EXISTS idx_srl_request ON public.supplier_request_lines(supplier_request_id);
CREATE INDEX IF NOT EXISTS idx_srl_order_item ON public.supplier_request_lines(order_item_id);

ALTER TABLE public.supplier_request_lines ENABLE ROW LEVEL SECURITY;

-- Supplier can SELECT own request lines (via join to supplier_requests)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'supplier_request_lines' AND policyname = 'srl_supplier_select'
  ) THEN
    CREATE POLICY srl_supplier_select ON public.supplier_request_lines
      FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.supplier_requests sr
        WHERE sr.id = supplier_request_id AND public.owns_supplier(sr.supplier_id)
      ));
  END IF;
END $$;

-- Admin can SELECT all
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'supplier_request_lines' AND policyname = 'srl_admin_select'
  ) THEN
    CREATE POLICY srl_admin_select ON public.supplier_request_lines
      FOR SELECT TO authenticated
      USING (public.is_admin());
  END IF;
END $$;

-- ============================================================================
-- 3. supplier_request_mirrors — espelhos linked to requests
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.supplier_request_mirrors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_request_id uuid NOT NULL REFERENCES public.supplier_requests(id) ON DELETE CASCADE,
  supplier_id         text NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  uploaded_by         uuid NOT NULL REFERENCES public.profiles(id),
  file_path           text NOT NULL,
  file_type           text NOT NULL,
  file_size_bytes     int,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT srm_file_type_check CHECK (file_type IN ('pdf','jpeg','png','webp'))
);

CREATE INDEX IF NOT EXISTS idx_srm_request ON public.supplier_request_mirrors(supplier_request_id);

ALTER TABLE public.supplier_request_mirrors ENABLE ROW LEVEL SECURITY;

-- Supplier can INSERT on own requests
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'supplier_request_mirrors' AND policyname = 'srm_supplier_insert'
  ) THEN
    CREATE POLICY srm_supplier_insert ON public.supplier_request_mirrors
      FOR INSERT TO authenticated
      WITH CHECK (public.owns_supplier(supplier_id));
  END IF;
END $$;

-- Supplier can SELECT own mirrors
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'supplier_request_mirrors' AND policyname = 'srm_supplier_select'
  ) THEN
    CREATE POLICY srm_supplier_select ON public.supplier_request_mirrors
      FOR SELECT TO authenticated
      USING (public.owns_supplier(supplier_id));
  END IF;
END $$;

-- Admin can SELECT all
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'supplier_request_mirrors' AND policyname = 'srm_admin_select'
  ) THEN
    CREATE POLICY srm_admin_select ON public.supplier_request_mirrors
      FOR SELECT TO authenticated
      USING (public.is_admin());
  END IF;
END $$;

-- ============================================================================
-- 4. Add source_request_id to supplier_purchase_orders (G2: request→PO linkage)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'supplier_purchase_orders'
      AND column_name = 'source_request_id'
  ) THEN
    ALTER TABLE public.supplier_purchase_orders
      ADD COLUMN source_request_id uuid REFERENCES public.supplier_requests(id);
    CREATE INDEX idx_spo_source_request ON public.supplier_purchase_orders(source_request_id)
      WHERE source_request_id IS NOT NULL;
  END IF;
END $$;

-- ============================================================================
-- 5. RPC: create_supplier_requests_for_order (G1: transactional creation)
-- ============================================================================
-- Called by backend at checkout. Creates one supplier_request per supplier,
-- with supplier_request_lines for each order_item from that supplier.
-- Also inserts outbox rows and an order_event. All in one transaction.

CREATE OR REPLACE FUNCTION public.create_supplier_requests_for_order(
  p_order_id uuid,
  p_suppliers jsonb  -- [{supplier_id, items: [{order_item_id, master_product_id, product_name, quantity, unit, unit_cost_centavos}]}]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order record;
  v_supplier jsonb;
  v_item jsonb;
  v_request_id uuid;
  v_idem_key text;
  v_created_count int := 0;
  v_line_count int := 0;
BEGIN
  -- Lock order to prevent concurrent creation
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao encontrado.');
  END IF;

  IF v_order.order_status <> 'aguardando-confirmacao' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao esta em aguardando-confirmacao.');
  END IF;

  FOR v_supplier IN SELECT * FROM jsonb_array_elements(p_suppliers)
  LOOP
    v_idem_key := p_order_id || ':sr:' || (v_supplier->>'supplier_id') || ':r1';

    -- Idempotent insert (G3)
    INSERT INTO public.supplier_requests (
      order_id, supplier_id, status, round_number, idempotency_key
    )
    VALUES (
      p_order_id,
      v_supplier->>'supplier_id',
      'aguardando_confirmacao',
      1,
      v_idem_key
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_request_id;

    IF v_request_id IS NULL THEN
      -- Already exists (idempotent retry); look it up
      SELECT id INTO v_request_id FROM public.supplier_requests
        WHERE idempotency_key = v_idem_key;
      CONTINUE;
    END IF;

    v_created_count := v_created_count + 1;

    -- Insert lines for this supplier
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_supplier->'items')
    LOOP
      INSERT INTO public.supplier_request_lines (
        supplier_request_id, order_item_id, master_product_id,
        product_name, quantity_requested, unit, unit_cost_centavos
      )
      VALUES (
        v_request_id,
        (v_item->>'order_item_id')::uuid,
        v_item->>'master_product_id',
        v_item->>'product_name',
        (v_item->>'quantity')::int,
        v_item->>'unit',
        (v_item->>'unit_cost_centavos')::int
      );
      v_line_count := v_line_count + 1;
    END LOOP;

    -- Outbox: nova_solicitacao_fornecedor (G7, G3: idempotent)
    INSERT INTO public.order_notification_outbox (
      order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
    )
    VALUES (
      p_order_id,
      'nova_solicitacao_fornecedor',
      'supplier',
      v_supplier->>'supplier_id',
      jsonb_build_object(
        'request_id', v_request_id,
        'code', v_order.code,
        'supplier_id', v_supplier->>'supplier_id',
        'item_count', jsonb_array_length(v_supplier->'items')
      ),
      p_order_id || ':nova_solicitacao_fornecedor:' || (v_supplier->>'supplier_id')
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;

  -- Order event (G7)
  IF v_created_count > 0 THEN
    INSERT INTO public.order_events (order_id, type, data, actor_kind)
    VALUES (
      p_order_id,
      'supplier_requests_criadas',
      jsonb_build_object('requests_count', v_created_count, 'lines_count', v_line_count),
      'system'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'requests_created', v_created_count,
    'lines_created', v_line_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_supplier_requests_for_order(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_supplier_requests_for_order(uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.create_supplier_requests_for_order(uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_supplier_requests_for_order(uuid, jsonb) TO service_role;

-- ============================================================================
-- 6. RPC: confirm_supplier_request (G5: partial confirmation → order_items)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.confirm_supplier_request(
  p_request_id uuid,
  p_supplier_id text,
  p_confirmations jsonb  -- [{line_id, qty_confirmed, status, cost_confirmed_centavos?, notes?}]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_req record;
  v_caller_id uuid;
  v_conf jsonb;
  v_line record;
  v_all_confirmed boolean := true;
  v_has_partial boolean := false;
  v_has_divergence boolean := false;
  v_has_review boolean := false;
  v_final_status text;
  v_updated int := 0;
  v_has_adjustments boolean := false;
BEGIN
  v_caller_id := auth.uid();

  -- 1. Load and lock request
  SELECT * INTO v_req FROM public.supplier_requests
    WHERE id = p_request_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitacao nao encontrada.');
  END IF;

  IF NOT public.owns_supplier(v_req.supplier_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
  END IF;

  -- G4: cannot confirm cancelled request
  IF v_req.status = 'cancelado' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitacao cancelada.');
  END IF;

  IF v_req.status NOT IN ('aguardando_confirmacao') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esta solicitacao ja foi respondida.');
  END IF;

  -- 2. Process each line
  FOR v_conf IN SELECT * FROM jsonb_array_elements(p_confirmations)
  LOOP
    SELECT * INTO v_line FROM public.supplier_request_lines
      WHERE id = (v_conf->>'line_id')::uuid
        AND supplier_request_id = p_request_id
      FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Linha nao encontrada: ' || (v_conf->>'line_id'));
    END IF;

    UPDATE public.supplier_request_lines SET
      quantity_confirmed = (v_conf->>'qty_confirmed')::int,
      status = v_conf->>'status',
      cost_confirmed_centavos = CASE
        WHEN v_conf->>'cost_confirmed_centavos' IS NOT NULL
        THEN (v_conf->>'cost_confirmed_centavos')::int
        ELSE NULL
      END,
      notes = v_conf->>'notes'
    WHERE id = v_line.id;

    v_updated := v_updated + 1;

    -- G5: Feed confirmation into order_items
    UPDATE public.order_items SET
      qty_confirmed = (v_conf->>'qty_confirmed')::int,
      removal_reason = CASE
        WHEN v_conf->>'status' = 'indisponivel' THEN 'Fornecedor: indisponível'
        WHEN v_conf->>'status' = 'confirmado_parcial' THEN 'Fornecedor: quantidade parcial'
        WHEN v_conf->>'status' = 'divergencia_quantidade' THEN 'Fornecedor: divergência de quantidade'
        WHEN v_conf->>'status' = 'divergencia_custo' THEN 'Fornecedor: divergência de custo'
        ELSE removal_reason
      END
    WHERE id = v_line.order_item_id;

    -- Track adjustments
    IF (v_conf->>'qty_confirmed')::int <> v_line.quantity_requested THEN
      v_has_adjustments := true;
    END IF;

    -- Track status composition
    CASE v_conf->>'status'
      WHEN 'confirmado' THEN NULL;
      WHEN 'confirmado_parcial' THEN v_has_partial := true; v_all_confirmed := false;
      WHEN 'indisponivel' THEN v_has_partial := true; v_all_confirmed := false;
      WHEN 'divergencia_quantidade' THEN v_has_divergence := true; v_all_confirmed := false;
      WHEN 'divergencia_custo' THEN v_has_divergence := true; v_all_confirmed := false;
      WHEN 'revisao_necessaria' THEN v_has_review := true; v_all_confirmed := false;
      ELSE v_all_confirmed := false;
    END CASE;
  END LOOP;

  -- 3. Determine request-level status
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

  -- 4. Update request
  UPDATE public.supplier_requests SET
    status = v_final_status,
    responded_at = now(),
    responded_by = v_caller_id
  WHERE id = p_request_id;

  -- 5. Event (G7)
  INSERT INTO public.order_events (order_id, type, data, actor_kind, actor_id)
  VALUES (
    v_req.order_id,
    'confirmacao_fornecedor',
    jsonb_build_object(
      'request_id', p_request_id,
      'supplier_id', v_req.supplier_id,
      'status', v_final_status,
      'items_updated', v_updated,
      'has_adjustments', v_has_adjustments
    ),
    'supplier',
    v_caller_id
  );

  -- 6. Outbox: request respondida (G7)
  INSERT INTO public.order_notification_outbox (
    order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
  )
  VALUES (
    v_req.order_id,
    'request_respondida',
    'supplier',
    v_req.supplier_id,
    jsonb_build_object('request_id', p_request_id, 'status', v_final_status),
    v_req.order_id || ':request_respondida:' || v_req.supplier_id
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  -- 7. If has divergence, outbox divergencia event (G7)
  IF v_final_status IN ('divergencia', 'confirmado_parcial', 'revisao_necessaria') THEN
    INSERT INTO public.order_notification_outbox (
      order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
    )
    VALUES (
      v_req.order_id,
      'divergencia_fornecedor',
      'customer',
      COALESCE((SELECT profile_id::text FROM public.orders WHERE id = v_req.order_id), 'guest'),
      jsonb_build_object('request_id', p_request_id, 'supplier_id', v_req.supplier_id, 'status', v_final_status),
      v_req.order_id || ':divergencia_fornecedor:' || v_req.supplier_id
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', v_final_status,
    'items_updated', v_updated,
    'has_adjustments', v_has_adjustments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_supplier_request(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_supplier_request(uuid, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_supplier_request(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_supplier_request(uuid, text, jsonb) TO service_role;

-- ============================================================================
-- 7. RPC: check_order_request_gate — all supplier requests resolved?
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_order_request_gate(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order record;
  v_total_requests int;
  v_resolved_requests int;
  v_has_adjustments boolean := false;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao encontrado.');
  END IF;

  IF v_order.order_status <> 'aguardando-confirmacao' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao esta em aguardando-confirmacao.');
  END IF;

  -- Count requests for this order
  SELECT
    COUNT(*),
    COUNT(*) FILTER (
      WHERE status NOT IN ('aguardando_confirmacao', 'revisao_necessaria')
    )
  INTO v_total_requests, v_resolved_requests
  FROM public.supplier_requests
  WHERE order_id = p_order_id
    AND status <> 'cancelado';

  IF v_total_requests = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nenhuma solicitacao encontrada para este pedido.');
  END IF;

  -- Check if there are quantity adjustments
  SELECT EXISTS(
    SELECT 1 FROM public.order_items
    WHERE order_id = p_order_id
      AND qty_confirmed IS NOT NULL
      AND qty_confirmed <> qty
  ) INTO v_has_adjustments;

  -- If all resolved and has adjustments, set customer_acceptance_required
  IF v_total_requests = v_resolved_requests AND v_has_adjustments THEN
    UPDATE public.orders SET customer_acceptance_required = true
    WHERE id = p_order_id AND NOT customer_acceptance_required;
  END IF;

  -- If all resolved and NO adjustments, advance directly to aguardando-pagamento
  IF v_total_requests = v_resolved_requests AND NOT v_has_adjustments THEN
    UPDATE public.orders SET order_status = 'aguardando-pagamento'
    WHERE id = p_order_id AND order_status = 'aguardando-confirmacao';

    -- Outbox: pagamento_liberado (G7)
    INSERT INTO public.order_notification_outbox (
      order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
    )
    VALUES (
      p_order_id,
      'pagamento_liberado',
      'customer',
      COALESCE(v_order.profile_id::text, 'guest'),
      jsonb_build_object('code', v_order.code, 'total_centavos', v_order.total_centavos),
      p_order_id || ':pagamento_liberado:' || COALESCE(v_order.profile_id::text, 'guest')
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    -- Event
    INSERT INTO public.order_events (order_id, type, data, actor_kind)
    VALUES (p_order_id, 'gate_liberado', jsonb_build_object(
      'total_requests', v_total_requests,
      'has_adjustments', false
    ), 'system');
  END IF;

  -- If all resolved and has adjustments, outbox confirmacao_concluida
  IF v_total_requests = v_resolved_requests AND v_has_adjustments THEN
    INSERT INTO public.order_notification_outbox (
      order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
    )
    VALUES (
      p_order_id,
      'confirmacao_concluida',
      'customer',
      COALESCE(v_order.profile_id::text, 'guest'),
      jsonb_build_object('code', v_order.code, 'has_adjustments', true),
      p_order_id || ':confirmacao_concluida:' || COALESCE(v_order.profile_id::text, 'guest')
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    INSERT INTO public.order_events (order_id, type, data, actor_kind)
    VALUES (p_order_id, 'confirmacao_concluida_com_ajuste', jsonb_build_object(
      'total_requests', v_total_requests,
      'has_adjustments', true
    ), 'system');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'total_requests', v_total_requests,
    'resolved_requests', v_resolved_requests,
    'all_resolved', v_total_requests = v_resolved_requests,
    'has_adjustments', v_has_adjustments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_order_request_gate(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_order_request_gate(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.check_order_request_gate(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_order_request_gate(uuid) TO service_role;

-- ============================================================================
-- 8. RPC: create_official_pos_from_requests (G2, G3, G9: idempotent, post-payment)
-- ============================================================================
-- Creates one supplier_purchase_order per confirmed supplier_request.
-- Links back via source_request_id. Idempotent: UNIQUE(source_request_id).

CREATE OR REPLACE FUNCTION public.create_official_pos_from_requests(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order record;
  v_req record;
  v_line record;
  v_po_id uuid;
  v_cycle_date date;
  v_created_count int := 0;
  v_items_count int := 0;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao encontrado.');
  END IF;

  -- G9: only after payment
  IF v_order.payment_status <> 'pago' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao esta pago.');
  END IF;

  v_cycle_date := CURRENT_DATE;

  FOR v_req IN
    SELECT * FROM public.supplier_requests
    WHERE order_id = p_order_id
      AND status IN ('confirmado', 'confirmado_parcial', 'divergencia')
    ORDER BY supplier_id
  LOOP
    -- G3: idempotent — skip if PO already exists for this request
    IF EXISTS (
      SELECT 1 FROM public.supplier_purchase_orders
      WHERE source_request_id = v_req.id
    ) THEN
      CONTINUE;
    END IF;

    -- Create the official PO
    INSERT INTO public.supplier_purchase_orders (
      supplier_id, cycle_date, status, source_request_id,
      supplier_confirmation_status
    )
    VALUES (
      v_req.supplier_id,
      v_cycle_date,
      'draft',
      v_req.id,
      v_req.status  -- carry over confirmation status
    )
    RETURNING id INTO v_po_id;

    v_created_count := v_created_count + 1;

    -- Create PO items from confirmed request lines
    FOR v_line IN
      SELECT * FROM public.supplier_request_lines
      WHERE supplier_request_id = v_req.id
        AND (status IS NULL OR status <> 'indisponivel')
    LOOP
      INSERT INTO public.purchase_order_items (
        purchase_order_id, master_product_id, product_name,
        quantity_units, unit_cost_centavos, subtotal_centavos,
        unidade_compra,
        qty_supplier_confirmed, supplier_item_status,
        cost_supplier_confirmed_centavos, supplier_notes
      )
      VALUES (
        v_po_id,
        v_line.master_product_id::uuid,
        v_line.product_name,
        v_line.quantity_requested,
        v_line.unit_cost_centavos,
        v_line.quantity_requested * v_line.unit_cost_centavos,
        COALESCE(v_line.unit, 'un'),
        v_line.quantity_confirmed,
        v_line.status,
        v_line.cost_confirmed_centavos,
        v_line.notes
      );
      v_items_count := v_items_count + 1;
    END LOOP;

    -- Update PO aggregates
    UPDATE public.supplier_purchase_orders SET
      item_count = (SELECT COUNT(*) FROM public.purchase_order_items WHERE purchase_order_id = v_po_id),
      subtotal_centavos = COALESCE((SELECT SUM(subtotal_centavos) FROM public.purchase_order_items WHERE purchase_order_id = v_po_id), 0),
      total_centavos = COALESCE((SELECT SUM(subtotal_centavos) FROM public.purchase_order_items WHERE purchase_order_id = v_po_id), 0)
    WHERE id = v_po_id;

    -- Outbox: po_oficial_criada (G7)
    INSERT INTO public.order_notification_outbox (
      order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
    )
    VALUES (
      p_order_id,
      'po_oficial_criada',
      'supplier',
      v_req.supplier_id,
      jsonb_build_object('po_id', v_po_id, 'request_id', v_req.id),
      p_order_id || ':po_oficial_criada:' || v_req.supplier_id
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;

  -- Event (G7)
  IF v_created_count > 0 THEN
    INSERT INTO public.order_events (order_id, type, data, actor_kind)
    VALUES (
      p_order_id,
      'pos_oficiais_criadas',
      jsonb_build_object('pos_created', v_created_count, 'items_created', v_items_count),
      'system'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'pos_created', v_created_count,
    'items_created', v_items_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_official_pos_from_requests(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_official_pos_from_requests(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.create_official_pos_from_requests(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_official_pos_from_requests(uuid) TO service_role;

-- ============================================================================
-- 9. RPC: cancel_order_requests (G4: pre-payment cancellation)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cancel_order_requests(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cancelled int;
BEGIN
  UPDATE public.supplier_requests SET
    status = 'cancelado'
  WHERE order_id = p_order_id
    AND status NOT IN ('cancelado');

  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  IF v_cancelled > 0 THEN
    -- Event (G7)
    INSERT INTO public.order_events (order_id, type, data, actor_kind)
    VALUES (
      p_order_id,
      'requests_canceladas',
      jsonb_build_object('cancelled_count', v_cancelled),
      'system'
    );

    -- Outbox: cancellation per supplier
    INSERT INTO public.order_notification_outbox (
      order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
    )
    SELECT
      p_order_id,
      'solicitacao_cancelada',
      'supplier',
      sr.supplier_id,
      jsonb_build_object('request_id', sr.id),
      p_order_id || ':solicitacao_cancelada:' || sr.supplier_id
    FROM public.supplier_requests sr
    WHERE sr.order_id = p_order_id
      AND sr.status = 'cancelado'
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('ok', true, 'cancelled', v_cancelled);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_order_requests(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_order_requests(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_order_requests(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order_requests(uuid) TO service_role;

-- ============================================================================
-- 10. RPC: mark_request_viewed (G6: idempotent viewed_at)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mark_request_viewed(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_req record;
BEGIN
  SELECT * INTO v_req FROM public.supplier_requests
    WHERE id = p_request_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitacao nao encontrada.');
  END IF;

  IF NOT public.owns_supplier(v_req.supplier_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
  END IF;

  -- Idempotent: only set if not already set (G6)
  IF v_req.viewed_at IS NULL THEN
    UPDATE public.supplier_requests SET viewed_at = now()
    WHERE id = p_request_id AND viewed_at IS NULL;

    -- Event (G7)
    INSERT INTO public.order_events (order_id, type, data, actor_kind, actor_id)
    VALUES (
      v_req.order_id,
      'request_visualizada',
      jsonb_build_object('request_id', p_request_id, 'supplier_id', v_req.supplier_id),
      'supplier',
      auth.uid()
    );

    -- Outbox (G7)
    INSERT INTO public.order_notification_outbox (
      order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
    )
    VALUES (
      v_req.order_id,
      'request_visualizada',
      'supplier',
      v_req.supplier_id,
      jsonb_build_object('request_id', p_request_id),
      v_req.order_id || ':request_visualizada:' || v_req.supplier_id
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_request_viewed(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_request_viewed(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_request_viewed(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_request_viewed(uuid) TO service_role;

-- ============================================================================
-- 11. COMMENTS
-- ============================================================================

COMMENT ON TABLE public.supplier_requests IS
  'Pre-payment confirmation requests sent to suppliers at checkout time. Separate from official purchase orders.';

COMMENT ON TABLE public.supplier_request_lines IS
  'Individual items within a supplier request, one per order_item from that supplier.';

COMMENT ON TABLE public.supplier_request_mirrors IS
  'Espelhos/mirror documents uploaded by suppliers to confirm request pricing and availability.';

COMMENT ON COLUMN public.supplier_purchase_orders.source_request_id IS
  'Links the official PO back to the supplier_request that originated it (created after payment).';

COMMENT ON FUNCTION public.create_supplier_requests_for_order(uuid, jsonb) IS
  'Transactionally creates supplier_requests + lines + outbox at checkout. Idempotent via idempotency_key.';

COMMENT ON FUNCTION public.confirm_supplier_request(uuid, text, jsonb) IS
  'Supplier confirms request item by item. Feeds back into order_items.qty_confirmed for adjustments.';

COMMENT ON FUNCTION public.check_order_request_gate(uuid) IS
  'Checks whether all supplier requests for an order are resolved. Auto-advances if no adjustments.';

COMMENT ON FUNCTION public.create_official_pos_from_requests(uuid) IS
  'Post-payment: creates official supplier_purchase_orders from confirmed requests. Idempotent.';

COMMENT ON FUNCTION public.cancel_order_requests(uuid) IS
  'Cancels all pending supplier_requests for an order (pre-payment cancellation).';

COMMENT ON FUNCTION public.mark_request_viewed(uuid) IS
  'Idempotently marks a supplier_request as viewed by the supplier.';

-- Fix: relax purchase_orders_supplier_cycle_uniq for request-based POs
-- The old constraint (one PO per supplier per day) only applies to cycle-based POs.
-- Request-based POs need one PO per supplier_request, not one per supplier per day.
DROP INDEX IF EXISTS purchase_orders_supplier_cycle_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_supplier_cycle_uniq
  ON public.supplier_purchase_orders (supplier_id, cycle_date)
  WHERE source_request_id IS NULL AND status NOT IN ('cancelled');
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_source_request_uniq
  ON public.supplier_purchase_orders (source_request_id)
  WHERE source_request_id IS NOT NULL;

COMMIT;
