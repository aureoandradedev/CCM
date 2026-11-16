-- ============================================================================
-- CCM · Migration 0029 — R4.1/R4.3: Consolidação automática de POs no ciclo
-- ============================================================================
--
-- Fecha o gap entre R4.1b (materialização) e R4.1/R4.3 (geração de PO).
-- Itera todos os fornecedores com requirements pendentes no ciclo dado
-- e chama generate_purchase_order para cada um.
-- Idempotente: pula fornecedores que já possuem PO não-cancelado no ciclo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.consolidate_cycle_purchase_orders(
  p_cycle_date date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id    uuid;
  v_supplier_id text;
  v_result      jsonb;
  v_generated   int := 0;
  v_skipped     int := 0;
  v_errors      int := 0;
  v_details     jsonb := '[]'::jsonb;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
  END IF;

  FOR v_supplier_id IN
    SELECT DISTINCT pr.supplier_id
    FROM public.purchase_requirements pr
    WHERE pr.cycle_date = p_cycle_date
      AND pr.status = 'pending'
    ORDER BY pr.supplier_id
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.supplier_purchase_orders
      WHERE supplier_id = v_supplier_id
        AND cycle_date = p_cycle_date
        AND status NOT IN ('cancelled')
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_result := public.generate_purchase_order(v_supplier_id, p_cycle_date);

    IF (v_result->>'ok')::boolean THEN
      v_generated := v_generated + 1;
      v_details := v_details || jsonb_build_object(
        'supplier_id', v_supplier_id,
        'purchase_order_id', v_result->>'purchase_order_id',
        'total_centavos', (v_result->>'total_centavos')::int,
        'minimum_met', (v_result->>'minimum_met')::boolean
      );
    ELSE
      v_errors := v_errors + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'generated', v_generated,
    'skipped', v_skipped,
    'errors', v_errors,
    'details', v_details
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consolidate_cycle_purchase_orders(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consolidate_cycle_purchase_orders(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.consolidate_cycle_purchase_orders(date) TO authenticated;

COMMENT ON FUNCTION public.consolidate_cycle_purchase_orders IS
  'R4.1/R4.3: No dia do ciclo, gera POs para todos os fornecedores com requirements pendentes. '
  'Idempotente: pula fornecedores que já possuem PO não-cancelado. Requer admin.';
