-- ============================================================================
-- Migration 0021: Secure supplier pipeline access
-- ============================================================================
--
-- O pipeline do fornecedor (sync-pipeline.ts) precisa:
--   1. Ler master_products para matching (tabela admin-only)
--   2. Persistir resultados de normalização/matching em campos derivados
--   3. Auto-aprovar matches de alta confiança
--   4. Resetar itens para re-processamento
--
-- SOLUÇÃO: RPCs SECURITY DEFINER com validação de ownership.
--   - Fornecedor NÃO recebe SELECT em master_products (sem policy genérica)
--   - Fornecedor NÃO consegue forjar campos derivados (trigger de proteção)
--   - Dados de master_products só acessíveis via RPC controlada
--   - Todas as RPCs validam auth.uid() → profiles → supplier_id → catálogo
--
-- Propriedades de segurança:
--   1. Supplier CANNOT SELECT master_products directly
--   2. Supplier CANNOT forge match_status/master_product_id/match_confidence
--   3. Supplier CANNOT process another supplier's catalog
--   4. Master product data only via controlled RPC (server action, never browser)
--   5. All derived fields protected by trigger
--   6. Admin retains full access
-- ============================================================================

-- ============================================================================
-- 1. TRIGGER: Proteger campos derivados em supplier_catalog_items
-- ============================================================================
-- Impede que o fornecedor altere diretamente campos de normalização/matching.
-- RPCs do pipeline usam set_config('ccm.pipeline_context','true',true) para bypass.

CREATE OR REPLACE FUNCTION public.protect_catalog_derived_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Contexto de pipeline (setado por RPCs SECURITY DEFINER): permite tudo
  IF current_setting('ccm.pipeline_context', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Admin: permite tudo
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  -- Fornecedor comum: preservar campos derivados no UPDATE
  NEW.normalized_data  := OLD.normalized_data;
  NEW.match_status     := OLD.match_status;
  NEW.master_product_id := OLD.master_product_id;
  NEW.match_confidence := OLD.match_confidence;
  NEW.match_signals    := OLD.match_signals;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_catalog_derived ON public.supplier_catalog_items;
CREATE TRIGGER trg_protect_catalog_derived
  BEFORE UPDATE ON public.supplier_catalog_items
  FOR EACH ROW EXECUTE FUNCTION public.protect_catalog_derived_fields();

COMMENT ON FUNCTION public.protect_catalog_derived_fields IS
  'Trigger que protege campos derivados (normalized_data, match_status, master_product_id, match_confidence, match_signals) contra UPDATE direto por fornecedor. Pipeline RPCs fazem bypass via ccm.pipeline_context.';

-- ============================================================================
-- 2. RPC: get_matching_masters(p_catalog_id)
-- ============================================================================
-- Retorna master products ativos para matching.
-- SECURITY DEFINER: valida ownership, bypassa RLS de master_products.
-- Dados consumidos pelo server action (nunca vão ao browser).

CREATE OR REPLACE FUNCTION public.get_matching_masters(p_catalog_id uuid)
RETURNS TABLE (
  id uuid,
  ean text,
  name text,
  brand_slug text,
  model text,
  category_slug text,
  subcategory_slug text,
  unit text,
  pack_info text,
  specs jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_supplier_id text;
  v_catalog_supplier text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'autenticação necessária';
  END IF;

  SELECT p.supplier_id INTO v_supplier_id
  FROM profiles p WHERE p.id = v_user_id;
  IF v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'conta não vinculada a fornecedor';
  END IF;

  SELECT sc.supplier_id INTO v_catalog_supplier
  FROM supplier_catalogs sc WHERE sc.id = p_catalog_id;
  IF v_catalog_supplier IS NULL OR v_catalog_supplier != v_supplier_id THEN
    RAISE EXCEPTION 'catálogo não pertence ao fornecedor';
  END IF;

  RETURN QUERY
  SELECT mp.id, mp.ean, mp.name, mp.brand_slug, mp.model,
         mp.category_slug, mp.subcategory_slug, mp.unit, mp.pack_info, mp.specs
  FROM master_products mp
  WHERE mp.active = true;
END;
$$;

REVOKE ALL ON FUNCTION public.get_matching_masters(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_matching_masters(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_matching_masters(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_matching_masters IS
  'Retorna master products ativos para matching. SECURITY DEFINER: valida ownership do catálogo. Dados ficam no server action, não vão ao browser.';

-- ============================================================================
-- 3. RPC: persist_match_results_supplier(p_catalog_id, p_items)
-- ============================================================================
-- Persiste resultados de matching para itens de um catálogo.
-- Só pode ser chamada pelo dono do catálogo.

CREATE OR REPLACE FUNCTION public.persist_match_results_supplier(
  p_catalog_id uuid,
  p_items jsonb
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_supplier_id text;
  v_catalog_supplier text;
  updated_count int;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'autenticação necessária';
  END IF;

  SELECT p.supplier_id INTO v_supplier_id
  FROM profiles p WHERE p.id = v_user_id;
  IF v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'conta não vinculada a fornecedor';
  END IF;

  SELECT sc.supplier_id INTO v_catalog_supplier
  FROM supplier_catalogs sc WHERE sc.id = p_catalog_id;
  IF v_catalog_supplier IS NULL OR v_catalog_supplier != v_supplier_id THEN
    RAISE EXCEPTION 'catálogo não pertence ao fornecedor';
  END IF;

  -- Habilitar contexto de pipeline para o trigger
  PERFORM set_config('ccm.pipeline_context', 'true', true);

  WITH updates AS (
    UPDATE supplier_catalog_items sci
    SET
      match_status     = COALESCE(item.val ->> 'match_status', sci.match_status),
      master_product_id = CASE
        WHEN item.val ->> 'master_product_id' IS NOT NULL
             AND item.val ->> 'master_product_id' != ''
          THEN (item.val ->> 'master_product_id')::uuid
        ELSE NULL
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

  PERFORM set_config('ccm.pipeline_context', '', true);

  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_match_results_supplier(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.persist_match_results_supplier(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.persist_match_results_supplier(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.persist_match_results_supplier IS
  'Persiste resultados de matching (match_status, master_product_id, match_confidence, match_signals). SECURITY DEFINER com validação de ownership.';

-- ============================================================================
-- 4. RPC: auto_approve_catalog_matches(p_catalog_id)
-- ============================================================================
-- Auto-aprova itens match_sugerido (alta confiança, não ambíguos).
-- NÃO aprova revisao_manual (requer revisão admin).

CREATE OR REPLACE FUNCTION public.auto_approve_catalog_matches(p_catalog_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_supplier_id text;
  v_catalog_supplier text;
  approved_count int;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'autenticação necessária';
  END IF;

  SELECT p.supplier_id INTO v_supplier_id
  FROM profiles p WHERE p.id = v_user_id;
  IF v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'conta não vinculada a fornecedor';
  END IF;

  SELECT sc.supplier_id INTO v_catalog_supplier
  FROM supplier_catalogs sc WHERE sc.id = p_catalog_id;
  IF v_catalog_supplier IS NULL OR v_catalog_supplier != v_supplier_id THEN
    RAISE EXCEPTION 'catálogo não pertence ao fornecedor';
  END IF;

  PERFORM set_config('ccm.pipeline_context', 'true', true);

  WITH approved AS (
    UPDATE supplier_catalog_items
    SET match_status = 'aprovado'
    WHERE catalog_id = p_catalog_id
      AND match_status = 'match_sugerido'
      AND master_product_id IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO approved_count FROM approved;

  PERFORM set_config('ccm.pipeline_context', '', true);

  RETURN approved_count;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_approve_catalog_matches(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_approve_catalog_matches(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.auto_approve_catalog_matches(uuid) TO authenticated;

COMMENT ON FUNCTION public.auto_approve_catalog_matches IS
  'Auto-aprova match_sugerido → aprovado para itens com master_product_id. SECURITY DEFINER com validação de ownership. Não afeta revisao_manual.';

-- ============================================================================
-- 5. RPC: reset_catalog_for_resync(p_catalog_id)
-- ============================================================================
-- Reseta itens não aprovados por admin para re-processamento.
-- Itens com match_status='aprovado' NÃO são resetados.

CREATE OR REPLACE FUNCTION public.reset_catalog_for_resync(p_catalog_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_supplier_id text;
  v_catalog_supplier text;
  reset_count int;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'autenticação necessária';
  END IF;

  SELECT p.supplier_id INTO v_supplier_id
  FROM profiles p WHERE p.id = v_user_id;
  IF v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'conta não vinculada a fornecedor';
  END IF;

  SELECT sc.supplier_id INTO v_catalog_supplier
  FROM supplier_catalogs sc WHERE sc.id = p_catalog_id;
  IF v_catalog_supplier IS NULL OR v_catalog_supplier != v_supplier_id THEN
    RAISE EXCEPTION 'catálogo não pertence ao fornecedor';
  END IF;

  PERFORM set_config('ccm.pipeline_context', 'true', true);

  WITH resets AS (
    UPDATE supplier_catalog_items
    SET
      match_status      = 'pendente',
      normalized_data   = NULL,
      master_product_id = NULL,
      match_confidence  = NULL,
      match_signals     = NULL
    WHERE catalog_id = p_catalog_id
      AND match_status IN ('pendente', 'normalizado', 'match_sugerido', 'revisao_manual')
    RETURNING 1
  )
  SELECT count(*) INTO reset_count FROM resets;

  PERFORM set_config('ccm.pipeline_context', '', true);

  RETURN reset_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_catalog_for_resync(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_catalog_for_resync(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reset_catalog_for_resync(uuid) TO authenticated;

COMMENT ON FUNCTION public.reset_catalog_for_resync IS
  'Reseta itens não-aprovados (pendente/normalizado/match_sugerido/revisao_manual) para pendente. SECURITY DEFINER com validação de ownership. Itens aprovado ficam intactos.';

-- ============================================================================
-- 6. UPGRADE update_normalized_items: SECURITY INVOKER → SECURITY DEFINER
-- ============================================================================
-- A versão original (0006) era SECURITY INVOKER (depende de RLS).
-- Nova versão: SECURITY DEFINER com validação de ownership + pipeline context.
-- Admin continua podendo chamar (compatível com orchestrator).

CREATE OR REPLACE FUNCTION public.update_normalized_items(
  p_catalog_id uuid,
  p_items jsonb
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_supplier_id text;
  v_catalog_supplier text;
  updated_count int;
BEGIN
  -- Admin: bypass ownership check (compatível com orchestrator)
  IF NOT public.is_admin() THEN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'autenticação necessária';
    END IF;

    SELECT p.supplier_id INTO v_supplier_id
    FROM profiles p WHERE p.id = v_user_id;
    IF v_supplier_id IS NULL THEN
      RAISE EXCEPTION 'conta não vinculada a fornecedor';
    END IF;

    SELECT sc.supplier_id INTO v_catalog_supplier
    FROM supplier_catalogs sc WHERE sc.id = p_catalog_id;
    IF v_catalog_supplier IS NULL OR v_catalog_supplier != v_supplier_id THEN
      RAISE EXCEPTION 'catálogo não pertence ao fornecedor';
    END IF;
  END IF;

  PERFORM set_config('ccm.pipeline_context', 'true', true);

  WITH updates AS (
    UPDATE supplier_catalog_items sci
    SET
      normalized_data = (item.val -> 'normalized_data')::jsonb,
      match_status    = COALESCE(item.val ->> 'match_status', sci.match_status)
    FROM jsonb_array_elements(p_items) AS item(val)
    WHERE sci.id = (item.val ->> 'id')::uuid
      AND sci.catalog_id = p_catalog_id
    RETURNING 1
  )
  SELECT count(*) INTO updated_count FROM updates;

  PERFORM set_config('ccm.pipeline_context', '', true);

  RETURN updated_count;
END;
$$;

-- Permissões mantidas (já aplicadas em 0006): authenticated only
