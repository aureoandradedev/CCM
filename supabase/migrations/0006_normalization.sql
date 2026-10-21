-- ============================================================================
-- CCM · Fase 3 — Normalização e Taxonomia
-- ----------------------------------------------------------------------------
-- Adiciona coluna para dados normalizados em supplier_catalog_items e
-- função de batch update para evitar N+1 na persistência.
-- ============================================================================

-- Coluna jsonb para armazenar resultado da normalização.
-- Preserva dados originais nas colunas existentes; este campo contém
-- apenas a versão normalizada/enriquecida para matching futuro.
ALTER TABLE public.supplier_catalog_items
  ADD COLUMN IF NOT EXISTS normalized_data jsonb;

-- Índice parcial no EAN normalizado para matching rápido na Fase 4.
CREATE INDEX IF NOT EXISTS catalog_items_norm_ean_idx
  ON public.supplier_catalog_items ((normalized_data->>'ean_clean'))
  WHERE normalized_data IS NOT NULL AND normalized_data->>'ean_clean' IS NOT NULL;

-- Índice parcial na marca normalizada para agrupamento na Fase 4.
CREATE INDEX IF NOT EXISTS catalog_items_norm_brand_idx
  ON public.supplier_catalog_items ((normalized_data->>'brand_slug'))
  WHERE normalized_data IS NOT NULL AND normalized_data->>'brand_slug' IS NOT NULL;

-- ── Batch update: atualiza normalized_data + match_status em lote ───────────
-- SECURITY INVOKER = RLS se aplica (fornecedor só atualiza próprios itens).
-- p_catalog_id obrigatório: impede que chamada RPC direta atualize item de
-- outro catálogo, mesmo dentro do mesmo fornecedor.
CREATE OR REPLACE FUNCTION public.update_normalized_items(
  p_catalog_id uuid,
  p_items jsonb
)
RETURNS int
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  updated_count int;
BEGIN
  WITH updates AS (
    UPDATE supplier_catalog_items sci
    SET
      normalized_data = (item.val -> 'normalized_data')::jsonb,
      match_status = COALESCE(item.val ->> 'match_status', sci.match_status)
    FROM jsonb_array_elements(p_items) AS item(val)
    WHERE sci.id = (item.val ->> 'id')::uuid
      AND sci.catalog_id = p_catalog_id
    RETURNING 1
  )
  SELECT count(*) INTO updated_count FROM updates;

  RETURN updated_count;
END;
$$;

-- Permissões explícitas: somente authenticated. Sem acesso para anon/public.
REVOKE ALL ON FUNCTION public.update_normalized_items(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_normalized_items(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_normalized_items(uuid, jsonb) TO authenticated;
