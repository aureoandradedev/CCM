-- Migration 0044: Tighten compras access (security audit)
--
-- Changes:
--   1. DROP orchestrator_lease ALL policy for compras
--   2. DROP master_products INSERT policy for compras
--   3. DROP brands INSERT policy for compras
--   4. CREATE RPC create_master_from_catalog_item (SECURITY DEFINER)
--      Replaces direct INSERT; validates role, item state, fields, dedup, brand

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Remove orchestrator_lease ALL for compras
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "compras all orchestrator lease" ON public.orchestrator_lease;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Remove INSERT on master_products and brands for compras
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "compras inserts master products" ON public.master_products;
DROP POLICY IF EXISTS "compras inserts brands" ON public.brands;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. RPC: create_master_from_catalog_item (SECURITY DEFINER)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_master_from_catalog_item(
  p_item_id uuid,
  p_name text,
  p_brand_slug text DEFAULT NULL,
  p_brand_name text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_ean text DEFAULT NULL,
  p_category_slug text DEFAULT NULL,
  p_subcategory_slug text DEFAULT NULL,
  p_unit text DEFAULT 'un'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_master_id uuid;
  v_existing_brand text;
  v_existing_ean uuid;
  v_resolved_brand_slug text;
BEGIN
  -- 1. Role check: compras or admin
  IF NOT public.has_role(ARRAY['compras']) THEN
    RAISE EXCEPTION 'permission_denied: role compras ou admin necessária';
  END IF;

  -- 2. Validate required fields
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'validation_error: item_id é obrigatório';
  END IF;
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'validation_error: nome é obrigatório';
  END IF;

  -- 3. Validate item exists and is in compatible state
  SELECT id, match_status, supplier_id, supplier_sku, ean, name, normalized_data
    INTO v_item
    FROM supplier_catalog_items
    WHERE id = p_item_id;

  IF v_item IS NULL THEN
    RAISE EXCEPTION 'not_found: item de catálogo não encontrado';
  END IF;

  IF v_item.match_status NOT IN ('match_sugerido', 'revisao_manual', 'normalizado') THEN
    RAISE EXCEPTION 'invalid_state: item deve estar em match_sugerido, revisao_manual ou normalizado (atual: %)', v_item.match_status;
  END IF;

  -- 4. Dedup by EAN if provided
  IF p_ean IS NOT NULL AND trim(p_ean) <> '' THEN
    SELECT id INTO v_existing_ean
      FROM master_products
      WHERE ean = trim(p_ean)
      LIMIT 1;
    IF v_existing_ean IS NOT NULL THEN
      RAISE EXCEPTION 'duplicate_ean: já existe produto mestre com EAN % (id: %)', trim(p_ean), v_existing_ean;
    END IF;
  END IF;

  -- 5. Brand: check existence, create only when needed
  v_resolved_brand_slug := NULL;
  IF p_brand_slug IS NOT NULL AND trim(p_brand_slug) <> '' THEN
    SELECT slug INTO v_existing_brand
      FROM brands
      WHERE slug = trim(p_brand_slug);

    IF v_existing_brand IS NULL THEN
      INSERT INTO brands (slug, name)
        VALUES (
          trim(p_brand_slug),
          COALESCE(NULLIF(trim(p_brand_name), ''), trim(p_brand_slug))
        );
    END IF;
    v_resolved_brand_slug := trim(p_brand_slug);
  END IF;

  -- 6. INSERT master product
  INSERT INTO master_products (
    name, brand_slug, brand_name, model, ean,
    category_slug, subcategory_slug, unit
  ) VALUES (
    trim(p_name),
    v_resolved_brand_slug,
    NULLIF(trim(COALESCE(p_brand_name, '')), ''),
    NULLIF(trim(COALESCE(p_model, '')), ''),
    NULLIF(trim(COALESCE(p_ean, '')), ''),
    NULLIF(trim(COALESCE(p_category_slug, '')), ''),
    NULLIF(trim(COALESCE(p_subcategory_slug, '')), ''),
    COALESCE(NULLIF(trim(p_unit), ''), 'un')
  )
  RETURNING id INTO v_master_id;

  -- 7. Bypass the trg_protect_catalog_derived trigger (from 0021)
  PERFORM set_config('ccm.pipeline_context', 'true', true);

  -- 8. Link item → master product
  UPDATE supplier_catalog_items
    SET master_product_id = v_master_id,
        match_status = 'aprovado',
        match_confidence = 100,
        match_signals = jsonb_build_array(
          jsonb_build_object(
            'signal', 'admin_created_master',
            'weight', 100,
            'matched', true,
            'detail', 'Produto mestre criado via fluxo de compras'
          )
        )
    WHERE id = p_item_id;

  -- 9. Return data for TypeScript post-processing (bindings, offer, auto-sourcing)
  RETURN jsonb_build_object(
    'master_product_id', v_master_id,
    'supplier_id', v_item.supplier_id,
    'supplier_sku', v_item.supplier_sku,
    'ean', v_item.ean,
    'item_name', v_item.name,
    'name_normalized', COALESCE(
      v_item.normalized_data->>'name_normalized',
      v_item.name
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_master_from_catalog_item(
  uuid, text, text, text, text, text, text, text, text
) TO authenticated;
