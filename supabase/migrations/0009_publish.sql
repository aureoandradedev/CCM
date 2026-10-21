-- ============================================================================
-- CCM · Fase 7 — Publicação e precificação
-- ============================================================================
--
-- Fluxo:
--   master_product → sourcing_selection → supplier_offer → margin_rule → preço → products
--
-- Regras de estoque na publicação:
--   1ª publicação          → products.stock = supplier_offers.stock (inicializa)
--   Republicação mesma offer → products.stock preservado (vendas não resetam)
--   Troca de offer          → products.stock = nova offer.stock (reinicializa)
--
-- Semântica de estoque:
--   products.stock          = vendável, decrementado pelo checkout
--   supplier_offers.stock   = último conhecido do fornecedor, não afetado por vendas
--
-- Proteção contra dados obsoletos:
--   p_expected_cost_centavos   — custo revisado no preview; se mudou → bloqueia
--   p_margin_rule_id           — regra revisada; RPC resolve novamente, se diverge → bloqueia
--   p_expected_retail_centavos — preço revisado; se cálculo diverge → bloqueia
--
-- PostgreSQL/RPC é a FONTE DE VERDADE do cálculo de preço publicado.
-- TypeScript (pricing.ts) é somente preview.

-- ============================================================================
-- 1. UNIQUE PARCIAL — um master_product ativo por vez
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS products_unique_master_active_idx
  ON public.products (master_product_id)
  WHERE master_product_id IS NOT NULL AND publish_status IN ('publicada','rascunho','aguardando_aprovacao');

-- ============================================================================
-- 2. TABELA DE LOG DE PUBLICAÇÃO (imutável)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.publication_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id            text NOT NULL,
  master_product_id     uuid NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
  sourcing_selection_id uuid NOT NULL REFERENCES public.sourcing_selections(id),
  supplier_offer_id     uuid NOT NULL REFERENCES public.supplier_offers(id),
  supplier_id           text NOT NULL REFERENCES public.suppliers(id),
  published_by          uuid NOT NULL REFERENCES public.profiles(id),
  published_at          timestamptz NOT NULL DEFAULT now(),
  cost_centavos         int NOT NULL,
  margin_pct            numeric(6,2) NOT NULL,
  margin_rule_id        uuid REFERENCES public.margin_rules(id),
  retail_price          numeric(12,2) NOT NULL,
  rounding              text NOT NULL DEFAULT 'none',
  note                  text,
  action                text NOT NULL DEFAULT 'publish'
                        CHECK (action IN ('publish','republish','update_price')),
  -- Auditoria de estoque
  stock_before          int,
  offer_stock           int,
  stock_after           int,
  stock_action          text CHECK (stock_action IN ('initialized','preserved','reinitialized'))
);

CREATE INDEX IF NOT EXISTS publication_log_product_idx
  ON public.publication_log (product_id, published_at DESC);
CREATE INDEX IF NOT EXISTS publication_log_master_idx
  ON public.publication_log (master_product_id, published_at DESC);

ALTER TABLE public.publication_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin all publication_log" ON public.publication_log;
CREATE POLICY "admin read publication_log"
  ON public.publication_log FOR SELECT
  USING (public.is_admin());

REVOKE INSERT, UPDATE, DELETE ON public.publication_log FROM authenticated;
REVOKE ALL ON public.publication_log FROM anon;
GRANT SELECT ON public.publication_log TO authenticated;

-- ============================================================================
-- 3. Campo sourcing_selection_id em products
-- ============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sourcing_selection_id uuid REFERENCES public.sourcing_selections(id);

-- ============================================================================
-- 4. RPC ATÔMICA DE PUBLICAÇÃO
-- ============================================================================
-- PostgreSQL é a fonte de verdade: recarrega custo, resolve margem,
-- calcula preço — não confia em valores da UI.
-- UI envia valores esperados apenas para detecção de obsolescência.

DROP FUNCTION IF EXISTS public.publish_product(uuid, uuid, uuid, text, text, text, text);

CREATE OR REPLACE FUNCTION public.publish_product(
  p_master_product_id      uuid,
  p_sourcing_selection_id  uuid,
  p_margin_rule_id         uuid,
  p_expected_cost_centavos int,
  p_expected_retail_centavos int,
  p_product_id             text,
  p_product_slug           text,
  p_product_sku            text,
  p_note                   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id             uuid;
  v_mp                   record;
  v_sel                  record;
  v_offer                record;
  v_cost                 int;
  v_offer_stock          int;
  -- margin resolution
  v_resolved_rule_id     uuid;
  v_resolved_priority    int;
  v_tie_count            int;
  v_rule                 record;
  v_margin_pct           numeric(6,2);
  -- price calculation
  v_raw_price            int;
  v_rounded_price        int;
  v_retail_price         numeric(12,2);
  v_rounding             text;
  v_min_price            int;
  -- existing product / stock
  v_existing_id          text;
  v_existing_offer_id    uuid;
  v_existing_stock       int;
  v_is_republish         boolean;
  v_same_offer           boolean;
  v_stock                int;
  v_stock_status         text;
  v_stock_action         text;
  v_stock_before         int;
  v_final_product_id     text;
BEGIN
  -- ── 1. Admin check ──────────────────────────────────────────────────
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT is_admin() THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  -- ── 2. Load master product ──────────────────────────────────────────
  SELECT * INTO v_mp FROM master_products WHERE id = p_master_product_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Produto mestre nao encontrado.');
  END IF;
  IF v_mp.name IS NULL OR v_mp.name = '' THEN
    RETURN jsonb_build_object('error', 'Produto mestre sem nome.');
  END IF;

  -- ── 3. Verify selection unchanged ───────────────────────────────────
  SELECT * INTO v_sel
    FROM sourcing_selections
   WHERE master_product_id = p_master_product_id
     AND replaced_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Nenhuma selecao de sourcing ativa.');
  END IF;
  IF v_sel.id != p_sourcing_selection_id THEN
    RETURN jsonb_build_object('error', 'Selecao alterada desde o preview. Revise antes de publicar.');
  END IF;

  -- ── 4. Load offer, validate active + current version ────────────────
  SELECT * INTO v_offer FROM supplier_offers WHERE id = v_sel.supplier_offer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Oferta selecionada nao encontrada.');
  END IF;
  IF v_offer.status != 'ativa' THEN
    RETURN jsonb_build_object('error', format('Oferta com status %L (esperado: ativa).', v_offer.status));
  END IF;

  v_cost := v_offer.cost_centavos;
  IF v_cost <= 0 THEN
    RETURN jsonb_build_object('error', 'Custo invalido (zero ou negativo).');
  END IF;
  v_offer_stock := v_offer.stock;

  -- ── 5. Cost staleness check ─────────────────────────────────────────
  IF v_cost != p_expected_cost_centavos THEN
    RETURN jsonb_build_object('error',
      format('Custo da oferta mudou desde o preview (esperado: %s, atual: %s). Revise antes de publicar.',
        p_expected_cost_centavos, v_cost));
  END IF;

  -- ── 6. Load existing product ────────────────────────────────────────
  SELECT id, winning_offer_id, stock
    INTO v_existing_id, v_existing_offer_id, v_existing_stock
    FROM products
   WHERE master_product_id = p_master_product_id
     AND publish_status IN ('publicada','rascunho','aguardando_aprovacao');

  v_is_republish := v_existing_id IS NOT NULL;
  v_same_offer := v_is_republish AND v_existing_offer_id = v_offer.id;
  v_final_product_id := COALESCE(v_existing_id, p_product_id);

  -- ── 7. Stock behavior ──────────────────────────────────────────────
  IF NOT v_is_republish THEN
    v_stock := v_offer_stock;
    v_stock_action := 'initialized';
    v_stock_before := NULL;
  ELSIF v_same_offer THEN
    v_stock := v_existing_stock;
    v_stock_action := 'preserved';
    v_stock_before := v_existing_stock;
  ELSE
    v_stock := v_offer_stock;
    v_stock_action := 'reinitialized';
    v_stock_before := v_existing_stock;
  END IF;

  -- Validate offer stock only on first publish and offer change
  IF v_stock_action IN ('initialized', 'reinitialized') THEN
    IF v_offer_stock IS NOT NULL AND v_offer_stock <= 0 THEN
      RETURN jsonb_build_object('error', 'Estoque zerado na oferta.');
    END IF;
  END IF;

  -- ── 8. Resolve margin rule (product > category > global) ───────────
  v_resolved_rule_id := NULL;

  -- Product scope
  SELECT id, priority INTO v_resolved_rule_id, v_resolved_priority
    FROM margin_rules
   WHERE active = true AND scope = 'product'
     AND scope_ref = p_master_product_id::text
   ORDER BY priority DESC
   LIMIT 1;

  IF v_resolved_rule_id IS NOT NULL THEN
    SELECT count(*) INTO v_tie_count
      FROM margin_rules
     WHERE active = true AND scope = 'product'
       AND scope_ref = p_master_product_id::text
       AND priority = v_resolved_priority;
    IF v_tie_count > 1 THEN
      RETURN jsonb_build_object('error',
        format('Margem ambigua: %s regras empatadas no escopo produto (prioridade %s).', v_tie_count, v_resolved_priority));
    END IF;
  END IF;

  -- Category scope
  IF v_resolved_rule_id IS NULL AND v_mp.category_slug IS NOT NULL THEN
    SELECT id, priority INTO v_resolved_rule_id, v_resolved_priority
      FROM margin_rules
     WHERE active = true AND scope = 'category'
       AND scope_ref = v_mp.category_slug
     ORDER BY priority DESC
     LIMIT 1;

    IF v_resolved_rule_id IS NOT NULL THEN
      SELECT count(*) INTO v_tie_count
        FROM margin_rules
       WHERE active = true AND scope = 'category'
         AND scope_ref = v_mp.category_slug
         AND priority = v_resolved_priority;
      IF v_tie_count > 1 THEN
        RETURN jsonb_build_object('error',
          format('Margem ambigua: %s regras empatadas no escopo categoria (prioridade %s).', v_tie_count, v_resolved_priority));
      END IF;
    END IF;
  END IF;

  -- Global scope
  IF v_resolved_rule_id IS NULL THEN
    SELECT id, priority INTO v_resolved_rule_id, v_resolved_priority
      FROM margin_rules
     WHERE active = true AND scope = 'global'
     ORDER BY priority DESC
     LIMIT 1;

    IF v_resolved_rule_id IS NOT NULL THEN
      SELECT count(*) INTO v_tie_count
        FROM margin_rules
       WHERE active = true AND scope = 'global'
         AND priority = v_resolved_priority;
      IF v_tie_count > 1 THEN
        RETURN jsonb_build_object('error',
          format('Margem ambigua: %s regras empatadas no escopo global (prioridade %s).', v_tie_count, v_resolved_priority));
      END IF;
    END IF;
  END IF;

  IF v_resolved_rule_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Nenhuma regra de margem aplicavel.');
  END IF;

  -- ── 9. Compare resolved margin with expected ───────────────────────
  IF v_resolved_rule_id != p_margin_rule_id THEN
    RETURN jsonb_build_object('error', 'Regra de margem vencedora mudou desde o preview. Revise antes de publicar.');
  END IF;

  -- ── 10. Load rule, calculate price ─────────────────────────────────
  SELECT * INTO v_rule FROM margin_rules WHERE id = v_resolved_rule_id AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Regra de margem nao encontrada ou inativa.');
  END IF;

  v_margin_pct := v_rule.margin_pct;
  v_raw_price := round(v_cost * (1.0 + v_margin_pct / 100.0))::int;
  v_rounding := v_rule.rounding;
  v_min_price := v_rule.min_price_centavos;

  v_rounded_price := v_raw_price;
  IF v_rounding = 'X90' THEN
    v_rounded_price := (v_raw_price / 100) * 100 + 90;
    IF v_rounded_price < v_raw_price THEN
      v_rounded_price := v_rounded_price + 100;
    END IF;
  ELSIF v_rounding = 'X99' THEN
    v_rounded_price := (v_raw_price / 100) * 100 + 99;
    IF v_rounded_price < v_raw_price THEN
      v_rounded_price := v_rounded_price + 100;
    END IF;
  END IF;

  IF v_rounded_price < v_cost THEN
    v_rounded_price := v_cost;
  END IF;
  IF v_min_price IS NOT NULL AND v_rounded_price < v_min_price THEN
    v_rounded_price := v_min_price;
  END IF;

  v_retail_price := v_rounded_price / 100.0;

  -- ── 11. Price staleness check ──────────────────────────────────────
  IF v_rounded_price != p_expected_retail_centavos THEN
    RETURN jsonb_build_object('error',
      format('Preco calculado difere do revisado (esperado: %s ctv, calculado: %s ctv). Parametros da regra podem ter mudado. Revise antes de publicar.',
        p_expected_retail_centavos, v_rounded_price));
  END IF;

  -- ── 12. Stock status ───────────────────────────────────────────────
  IF v_stock IS NOT NULL AND v_stock > 0 THEN
    v_stock_status := 'in_stock';
  ELSIF v_stock IS NULL THEN
    v_stock_status := 'supplier';
  ELSE
    v_stock_status := 'out';
  END IF;

  -- ── 13. Upsert product ────────────────────────────────────────────
  IF v_is_republish THEN
    UPDATE products SET
      slug = p_product_slug,
      sku = p_product_sku,
      ean = v_mp.ean,
      name = v_mp.name,
      brand_slug = v_mp.brand_slug,
      brand_name = COALESCE(v_mp.brand_name, ''),
      category_slug = v_mp.category_slug,
      subcategory_slug = v_mp.subcategory_slug,
      supplier_id = v_offer.supplier_id,
      unit = COALESCE(v_mp.unit, 'un'),
      pack_info = v_mp.pack_info,
      retail_price = v_retail_price,
      description = v_mp.description,
      short_description = COALESCE(left(v_mp.description, 200), v_mp.name),
      specs = COALESCE(v_mp.specs, '[]'::jsonb),
      images = COALESCE(v_mp.images, '{}'::text[]),
      tags = COALESCE(v_mp.tags, '{}'::text[]),
      stock = v_stock,
      stock_status = v_stock_status,
      master_product_id = p_master_product_id,
      winning_offer_id = v_offer.id,
      cost_centavos = v_cost,
      margin_pct = v_margin_pct,
      publish_status = 'publicada',
      sourcing_selection_id = v_sel.id,
      offer_approved_by = v_admin_id,
      offer_approved_at = now(),
      offer_approval_note = p_note,
      offer_score = NULL,
      active = true,
      updated_at = now()
    WHERE id = v_existing_id;
  ELSE
    INSERT INTO products (
      id, slug, sku, ean, name, brand_slug, brand_name,
      category_slug, subcategory_slug, supplier_id, unit, pack_info,
      retail_price, description, short_description, specs, images, tags,
      stock, stock_status, master_product_id, winning_offer_id,
      cost_centavos, margin_pct, publish_status, sourcing_selection_id,
      offer_approved_by, offer_approved_at, offer_approval_note, offer_score,
      active
    ) VALUES (
      p_product_id, p_product_slug, p_product_sku, v_mp.ean, v_mp.name,
      v_mp.brand_slug, COALESCE(v_mp.brand_name, ''),
      v_mp.category_slug, v_mp.subcategory_slug, v_offer.supplier_id,
      COALESCE(v_mp.unit, 'un'), v_mp.pack_info,
      v_retail_price, v_mp.description,
      COALESCE(left(v_mp.description, 200), v_mp.name),
      COALESCE(v_mp.specs, '[]'::jsonb),
      COALESCE(v_mp.images, '{}'::text[]),
      COALESCE(v_mp.tags, '{}'::text[]),
      v_stock, v_stock_status, p_master_product_id, v_offer.id,
      v_cost, v_margin_pct, 'publicada', v_sel.id,
      v_admin_id, now(), p_note, NULL,
      true
    );
  END IF;

  -- ── 14. Insert audit log ───────────────────────────────────────────
  INSERT INTO publication_log (
    product_id, master_product_id, sourcing_selection_id,
    supplier_offer_id, supplier_id, published_by,
    cost_centavos, margin_pct, margin_rule_id, retail_price,
    rounding, note, action,
    stock_before, offer_stock, stock_after, stock_action
  ) VALUES (
    v_final_product_id, p_master_product_id, v_sel.id,
    v_offer.id, v_offer.supplier_id, v_admin_id,
    v_cost, v_margin_pct, v_rule.id, v_retail_price,
    v_rounding, p_note,
    CASE
      WHEN NOT v_is_republish THEN 'publish'
      WHEN v_same_offer THEN 'update_price'
      ELSE 'republish'
    END,
    v_stock_before, v_offer_stock, v_stock, v_stock_action
  );

  RETURN jsonb_build_object(
    'ok', CASE
      WHEN NOT v_is_republish THEN 'Produto publicado com sucesso.'
      WHEN v_same_offer THEN 'Produto atualizado com sucesso.'
      ELSE 'Produto republicado com sucesso (nova oferta).'
    END,
    'product_id', v_final_product_id,
    'retail_price', v_retail_price,
    'stock_action', v_stock_action
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_product FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_product FROM anon;
GRANT EXECUTE ON FUNCTION public.publish_product TO authenticated;

-- ============================================================================
-- 5. COMENTÁRIOS
-- ============================================================================

COMMENT ON TABLE public.publication_log IS
  'Log imutavel de publicacao CCM. Admin: SELECT. Escrita: somente via RPC publish_product.';

COMMENT ON COLUMN public.publication_log.action IS
  'publish = 1a publicacao; republish = troca de oferta; update_price = mesma oferta, ajuste de preco/margem.';

COMMENT ON COLUMN public.publication_log.stock_action IS
  'initialized = 1a publicacao (stock da offer); preserved = mesma offer (vendas mantidas); reinitialized = nova offer.';

COMMENT ON COLUMN public.products.sourcing_selection_id IS
  'Selecao de sourcing usada na ultima publicacao. Permite detectar desatualizacao.';

COMMENT ON COLUMN public.products.stock IS
  'Estoque vendavel publicado pelo CCM. Decrementado pelo checkout (create_order_atomic). Resetado ao trocar de oferta.';

COMMENT ON COLUMN public.supplier_offers.stock IS
  'Ultimo estoque conhecido informado pelo fornecedor. Nao e afetado por vendas do CCM.';

COMMENT ON FUNCTION public.publish_product IS
  'Publicacao atomica CCM. Resolve margem, calcula preco, verifica obsolescencia (custo/margem/preco). Estoque: inicializa na 1a pub, preserva na mesma offer, reinicializa na troca.';
