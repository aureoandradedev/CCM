-- Migration 0071: Fix PO creation to exclude 'perdido' lines
--
-- Problem: create_pos_from_requests (0058) filters only 'indisponivel'
-- but not 'perdido'. When remove_order_item_v2 (0070) sets request lines
-- to 'perdido', those phantom lines would still create PO items.
--
-- Fix: CREATE OR REPLACE the function adding 'perdido' to the exclusion.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_pos_from_requests(
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_req RECORD;
  v_line RECORD;
  v_po_id uuid;
  v_cycle_date date := current_date;
  v_created_count int := 0;
  v_items_count int := 0;
BEGIN
  FOR v_req IN
    SELECT * FROM public.supplier_requests
    WHERE order_id = p_order_id
      AND status IN ('confirmado', 'confirmado_parcial', 'divergencia')
    ORDER BY supplier_id
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.supplier_purchase_orders
      WHERE source_request_id = v_req.id
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.supplier_purchase_orders (
      supplier_id, cycle_date, status, source_request_id,
      supplier_confirmation_status
    )
    VALUES (
      v_req.supplier_id,
      v_cycle_date,
      'draft',
      v_req.id,
      v_req.status
    )
    RETURNING id INTO v_po_id;

    v_created_count := v_created_count + 1;

    FOR v_line IN
      SELECT * FROM public.supplier_request_lines
      WHERE supplier_request_id = v_req.id
        AND (status IS NULL OR status NOT IN ('indisponivel', 'perdido'))
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

    UPDATE public.supplier_purchase_orders
    SET
      total_items = (SELECT count(*) FROM public.purchase_order_items WHERE purchase_order_id = v_po_id),
      total_centavos = (SELECT COALESCE(sum(subtotal_centavos), 0) FROM public.purchase_order_items WHERE purchase_order_id = v_po_id)
    WHERE id = v_po_id;
  END LOOP;

  RETURN jsonb_build_object(
    'created_pos', v_created_count,
    'created_items', v_items_count
  );
END;
$$;

COMMIT;
