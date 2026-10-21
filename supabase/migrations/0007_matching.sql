-- ============================================================================
-- CCM · Fase 4 — Matching de Produtos
-- ----------------------------------------------------------------------------
-- Função de batch update para persistir resultados de matching em lote.
-- Atualiza match_status, master_product_id, match_confidence e match_signals.
--
-- SEGURANÇA:
--   SECURITY DEFINER + is_admin() interna: somente admin pode executar.
--   p_catalog_id obrigatório: impede cross-catalog.
--   Item deve pertencer ao catálogo indicado.
--   REVOKE de PUBLIC e anon.
--
-- SEMÂNTICA de master_product_id:
--   Enquanto match_status IN ('match_sugerido','revisao_manual'),
--   master_product_id é SUGESTÃO, não aprovação definitiva.
--   Aprovação requer match_status = 'aprovado' (ação humana futura).
-- ============================================================================

CREATE INDEX IF NOT EXISTS master_products_model_idx
  ON public.master_products (brand_slug, model)
  WHERE model IS NOT NULL;

-- ── Batch update matching results ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_match_results(
  p_catalog_id uuid,
  p_items jsonb
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'acesso negado: somente admin pode executar matching';
  END IF;

  WITH updates AS (
    UPDATE supplier_catalog_items sci
    SET
      match_status     = COALESCE(item.val ->> 'match_status', sci.match_status),
      master_product_id = CASE
        WHEN item.val ->> 'master_product_id' = '' OR item.val ->> 'master_product_id' IS NULL
          THEN NULL
        ELSE (item.val ->> 'master_product_id')::uuid
      END,
      match_confidence = CASE
        WHEN item.val ->> 'match_confidence' IS NOT NULL
          THEN (item.val ->> 'match_confidence')::numeric(5,2)
        ELSE sci.match_confidence
      END,
      match_signals    = CASE
        WHEN item.val -> 'match_signals' IS NOT NULL
          THEN (item.val -> 'match_signals')::jsonb
        ELSE sci.match_signals
      END
    FROM jsonb_array_elements(p_items) AS item(val)
    WHERE sci.id = (item.val ->> 'id')::uuid
      AND sci.catalog_id = p_catalog_id
    RETURNING 1
  )
  SELECT count(*) INTO updated_count FROM updates;

  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.update_match_results(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_match_results(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_match_results(uuid, jsonb) TO authenticated;
