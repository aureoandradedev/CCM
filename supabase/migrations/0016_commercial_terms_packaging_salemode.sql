-- ============================================================================
-- CCM · Migration 0016 — Condições comerciais, embalagem, modo de venda
-- ============================================================================
-- Fases 10-12 do documento CCM_Estrutura_Operacao_TI.docx
--
-- Novas tabelas:
--   supplier_commercial_terms  — condições versionadas por fornecedor
--   section_configs            — config por seção (desconto caixa, limite aumento)
--   product_config_overrides   — exceção por produto (desconto caixa)
--   config_audit_log           — auditoria genérica de alteração de configs
--   ccm_configs                — configurações centralizadas (chave/valor + scope)
--   ccm_config_history         — trilha de auditoria de ccm_configs
--
-- Alterações:
--   profiles                   — add permissions text[]
--   supplier_catalog_items     — add packaging fields
--   supplier_offers            — add sale_mode + packaging
--   products                   — add sale_mode + packaging + availability
--   products_public view       — add sale_mode + packaging (sem custo)
--   procurement_exceptions     — add novos tipos de exceção
--
-- Novas funções:
--   has_permission(text)                    — verifica permissão do usuário
--   is_supplier_operationally_active(text)  — verifica se terms válidos
--   save_ccm_config(...)                    — salva config com audit trail
--   version_supplier_offer(...)             — atualizada com packaging
-- ============================================================================

-- ============================================================================
-- 1. PERMISSÕES — extensão mínima para "direção"
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS permissions text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.has_permission(p_perm text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND p_perm = ANY(permissions)
  );
$$;

REVOKE ALL ON FUNCTION public.has_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_permission(text) TO authenticated;

-- ============================================================================
-- 2. SUPPLIER_COMMERCIAL_TERMS — condições comerciais versionadas
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.supplier_commercial_terms (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id            text NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,

  pedido_minimo_tipo     text NOT NULL DEFAULT 'valor'
                         CHECK (pedido_minimo_tipo IN ('valor', 'volume')),
  pedido_minimo          numeric(12,2) NOT NULL CHECK (pedido_minimo >= 0),

  dias_pedido            int[] NOT NULL,

  prazo_entrega_cd_dias  int NOT NULL CHECK (prazo_entrega_cd_dias >= 0),

  frete_tipo             text NOT NULL CHECK (frete_tipo IN ('gratis_acima', 'fixo')),
  frete_gratis_acima     numeric(12,2),
  frete_valor            numeric(12,2),

  cutoff_time            time,

  active                 boolean NOT NULL DEFAULT true,
  valid_from             timestamptz NOT NULL DEFAULT now(),
  valid_to               timestamptz,

  created_by             uuid REFERENCES auth.users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT frete_coherent CHECK (
    CASE frete_tipo
      WHEN 'fixo' THEN
        frete_valor IS NOT NULL AND frete_valor >= 0
      WHEN 'gratis_acima' THEN
        frete_gratis_acima IS NOT NULL AND frete_gratis_acima > 0
        AND frete_valor IS NOT NULL AND frete_valor >= 0
    END
  ),
  CONSTRAINT dias_pedido_not_empty CHECK (
    array_length(dias_pedido, 1) > 0
  ),
  CONSTRAINT dias_pedido_valid CHECK (
    dias_pedido <@ ARRAY[0,1,2,3,4,5,6]
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_commercial_terms_active_idx
  ON public.supplier_commercial_terms (supplier_id)
  WHERE active = true AND valid_to IS NULL;

CREATE INDEX IF NOT EXISTS supplier_commercial_terms_supplier_idx
  ON public.supplier_commercial_terms (supplier_id, created_at DESC);

-- ============================================================================
-- 3. FUNÇÃO: is_supplier_operationally_active
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_supplier_operationally_active(p_supplier_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.supplier_commercial_terms
    WHERE supplier_id = p_supplier_id
    AND active = true
    AND valid_to IS NULL
    AND pedido_minimo_tipo = 'valor'
  );
$$;

-- ============================================================================
-- 4. PACKAGING — campos em supplier_catalog_items
-- ============================================================================

ALTER TABLE public.supplier_catalog_items
  ADD COLUMN IF NOT EXISTS unidade_compra text NOT NULL DEFAULT 'unidade'
    CHECK (unidade_compra IN ('unidade', 'caixa', 'fardo', 'rolo')),
  ADD COLUMN IF NOT EXISTS qtd_por_embalagem int NOT NULL DEFAULT 1
    CHECK (qtd_por_embalagem >= 1),
  ADD COLUMN IF NOT EXISTS vende_avulso boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS unit_cost_centavos int;

UPDATE public.supplier_catalog_items
  SET unit_cost_centavos = cost_centavos
  WHERE unit_cost_centavos IS NULL AND cost_centavos IS NOT NULL;

ALTER TABLE public.supplier_catalog_items
  ADD CONSTRAINT catalog_item_unit_coherent CHECK (
    unidade_compra <> 'unidade'
    OR (qtd_por_embalagem = 1 AND vende_avulso = true)
  ) NOT VALID;

-- ============================================================================
-- 5. SALE MODE + PACKAGING — em supplier_offers
-- ============================================================================

ALTER TABLE public.supplier_offers
  ADD COLUMN IF NOT EXISTS sale_mode text NOT NULL DEFAULT 'por_unidade'
    CHECK (sale_mode IN ('por_unidade', 'embalagem_fechada', 'unidade_e_caixa', 'nao_vender')),
  ADD COLUMN IF NOT EXISTS unidade_compra text
    CHECK (unidade_compra IS NULL OR unidade_compra IN ('unidade', 'caixa', 'fardo', 'rolo')),
  ADD COLUMN IF NOT EXISTS qtd_por_embalagem int CHECK (qtd_por_embalagem IS NULL OR qtd_por_embalagem >= 1),
  ADD COLUMN IF NOT EXISTS vende_avulso boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pack_cost_centavos int,
  ADD COLUMN IF NOT EXISTS unit_cost_centavos int;

-- ============================================================================
-- 6. SALE MODE + PACKAGING — em products
-- ============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sale_mode text NOT NULL DEFAULT 'por_unidade'
    CHECK (sale_mode IN ('por_unidade', 'embalagem_fechada', 'unidade_e_caixa', 'nao_vender')),
  ADD COLUMN IF NOT EXISTS unidade_compra text
    CHECK (unidade_compra IS NULL OR unidade_compra IN ('unidade', 'caixa', 'fardo', 'rolo')),
  ADD COLUMN IF NOT EXISTS qtd_por_embalagem int DEFAULT 1 CHECK (qtd_por_embalagem IS NULL OR qtd_por_embalagem >= 1),
  ADD COLUMN IF NOT EXISTS package_discount_pct numeric(5,2)
    CHECK (package_discount_pct IS NULL OR (package_discount_pct >= 0 AND package_discount_pct <= 100)),
  ADD COLUMN IF NOT EXISTS expected_availability_date date;

-- ============================================================================
-- 7. SECTION_CONFIGS — configurações por seção (departamento)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.section_configs (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_slug                  text NOT NULL REFERENCES public.categories(slug) ON DELETE CASCADE,
  package_discount_pct          numeric(5,2) NOT NULL DEFAULT 0
                                CHECK (package_discount_pct >= 0 AND package_discount_pct <= 100),
  auto_price_increase_limit_pct numeric(5,2) NOT NULL DEFAULT 10
                                CHECK (auto_price_increase_limit_pct >= 0),
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS section_configs_section_unique_idx
  ON public.section_configs (section_slug);

CREATE TRIGGER set_updated_at_section_configs
  BEFORE UPDATE ON public.section_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 8. PRODUCT_CONFIG_OVERRIDES — exceção por produto
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.product_config_overrides (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id    uuid NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
  package_discount_pct numeric(5,2)
                       CHECK (package_discount_pct IS NULL OR (package_discount_pct >= 0 AND package_discount_pct <= 100)),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_config_overrides_product_unique_idx
  ON public.product_config_overrides (master_product_id);

CREATE TRIGGER set_updated_at_product_config_overrides
  BEFORE UPDATE ON public.product_config_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 9. CONFIG_AUDIT_LOG — auditoria genérica de alteração de configuração
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.config_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_table text NOT NULL,
  config_scope text,
  config_key  text NOT NULL,
  old_value   jsonb,
  new_value   jsonb,
  changed_by  uuid NOT NULL REFERENCES auth.users(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS config_audit_log_table_idx
  ON public.config_audit_log (config_table, changed_at DESC);

-- ============================================================================
-- 10. CCM_CONFIGS — configurações centralizadas (chave/valor + scope)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ccm_configs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL,
  scope       text NOT NULL DEFAULT 'global'
              CHECK (scope IN ('global', 'section', 'product')),
  scope_ref   text,
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES public.profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ccm_configs_unique_idx
  ON public.ccm_configs (key, scope, COALESCE(scope_ref, ''));

CREATE TRIGGER ccm_configs_updated_at
  BEFORE UPDATE ON public.ccm_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 11. CCM_CONFIG_HISTORY — trilha de auditoria de ccm_configs
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ccm_config_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id   uuid NOT NULL REFERENCES public.ccm_configs(id) ON DELETE CASCADE,
  key         text NOT NULL,
  scope       text NOT NULL,
  scope_ref   text,
  old_value   jsonb,
  new_value   jsonb NOT NULL,
  changed_by  uuid NOT NULL REFERENCES public.profiles(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ccm_config_history_config_idx
  ON public.ccm_config_history (config_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS ccm_config_history_key_idx
  ON public.ccm_config_history (key, changed_at DESC);

-- ============================================================================
-- 12. RPC: save_ccm_config — salvar config com audit trail atômico
-- ============================================================================

CREATE OR REPLACE FUNCTION public.save_ccm_config(
  p_key       text,
  p_scope     text,
  p_scope_ref text,
  p_value     jsonb,
  p_admin_id  uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id   uuid;
  v_existing   record;
  v_config_id  uuid;
  v_scope_ref  text;
BEGIN
  v_admin_id := COALESCE(p_admin_id, auth.uid());
  IF v_admin_id IS NULL OR NOT is_admin() THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  v_scope_ref := NULLIF(TRIM(COALESCE(p_scope_ref, '')), '');

  SELECT id, value INTO v_existing
    FROM ccm_configs
   WHERE key = p_key
     AND scope = p_scope
     AND COALESCE(scope_ref, '') = COALESCE(v_scope_ref, '');

  IF v_existing IS NOT NULL THEN
    INSERT INTO ccm_config_history (config_id, key, scope, scope_ref, old_value, new_value, changed_by)
    VALUES (v_existing.id, p_key, p_scope, v_scope_ref, v_existing.value, p_value, v_admin_id);

    UPDATE ccm_configs SET value = p_value, updated_by = v_admin_id
    WHERE id = v_existing.id;

    RETURN jsonb_build_object('ok', true, 'action', 'updated', 'config_id', v_existing.id);
  ELSE
    INSERT INTO ccm_configs (key, scope, scope_ref, value, updated_by)
    VALUES (p_key, p_scope, v_scope_ref, p_value, v_admin_id)
    RETURNING id INTO v_config_id;

    INSERT INTO ccm_config_history (config_id, key, scope, scope_ref, old_value, new_value, changed_by)
    VALUES (v_config_id, p_key, p_scope, v_scope_ref, NULL, p_value, v_admin_id);

    RETURN jsonb_build_object('ok', true, 'action', 'created', 'config_id', v_config_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_ccm_config FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_ccm_config FROM anon;
GRANT EXECUTE ON FUNCTION public.save_ccm_config TO authenticated;

-- Defaults iniciais
DO $$
BEGIN
  INSERT INTO public.ccm_configs (key, scope, scope_ref, value)
  VALUES
    ('leftover_ceiling_centavos', 'global', NULL, '500000'::jsonb),
    ('auto_price_enabled', 'global', NULL, 'false'::jsonb),
    ('auto_switch_enabled', 'global', NULL, 'false'::jsonb)
  ON CONFLICT DO NOTHING;
END $$;

-- ============================================================================
-- 13. FEATURE FLAGS — em site_settings
-- ============================================================================

INSERT INTO public.site_settings (key, value) VALUES
  ('feature_flags', '{
    "automatic_price_updates_enabled": false,
    "automatic_supplier_switch_enabled": false
  }'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.site_settings (key, value) VALUES
  ('ccm_operations', '{
    "max_leftover_inventory_value_centavos": null
  }'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 14. NOVOS TIPOS DE EXCEÇÃO — em procurement_exceptions
-- ============================================================================

DO $$
BEGIN
  ALTER TABLE public.procurement_exceptions
    DROP CONSTRAINT IF EXISTS procurement_exceptions_type_check;

  ALTER TABLE public.procurement_exceptions
    ADD CONSTRAINT procurement_exceptions_type_check
    CHECK (type IN (
      'review_match',
      'review_ranking',
      'no_offer',
      'no_master_candidate',
      'source_changed',
      'economy_opportunity',
      'stale_sourcing',
      'stale_publication',
      'inactive_item',
      'price_increase_blocked',
      'supplier_replacement',
      'minimum_order_not_met'
    ));
END $$;

-- ============================================================================
-- 15. PRODUCTS_PUBLIC VIEW — adicionar campos públicos
-- ============================================================================

CREATE OR REPLACE VIEW public.products_public AS
  SELECT
    p.id, p.slug, p.sku, p.ean, p.name,
    p.brand_slug, p.brand_name,
    p.category_slug, p.subcategory_slug,
    p.unit, p.pack_info,
    p.retail_price, p.wholesale_price, p.wholesale_min_qty,
    p.list_price, p.pix_discount_pct,
    p.images,
    p.rating, p.review_count, p.badges,
    p.short_description, p.description, p.specs,
    p.stock, p.max_per_order, p.max_per_order_enabled, p.stock_status,
    p.tags, p.yield_hint, p.sort, p.active,
    p.created_at, p.updated_at,
    p.sale_mode,
    p.unidade_compra,
    p.qtd_por_embalagem,
    p.package_discount_pct,
    p.expected_availability_date
  FROM public.products p
  WHERE p.active = true;

GRANT SELECT ON public.products_public TO anon;
GRANT SELECT ON public.products_public TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.products_public FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.products_public FROM authenticated;

-- ============================================================================
-- 16. version_supplier_offer — atualizada com packaging
-- ============================================================================

CREATE OR REPLACE FUNCTION public.version_supplier_offer(
  p_master_product_id  uuid,
  p_supplier_id        text,
  p_catalog_item_id    uuid,
  p_cost_centavos      int,
  p_stock              int DEFAULT NULL,
  p_lead_time_days     int DEFAULT 3
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing       record;
  v_new_id         uuid;
  v_unidade_compra text;
  v_qtd_emb        int;
  v_vende_avulso   boolean;
  v_unit_cost      int;
BEGIN
  IF NOT is_admin() THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  IF p_cost_centavos <= 0 THEN
    RETURN jsonb_build_object('error', 'Custo invalido.');
  END IF;

  SELECT sci.unidade_compra, sci.qtd_por_embalagem, sci.vende_avulso
    INTO v_unidade_compra, v_qtd_emb, v_vende_avulso
    FROM supplier_catalog_items sci
   WHERE sci.id = p_catalog_item_id;

  v_unidade_compra := COALESCE(v_unidade_compra, 'unidade');
  v_qtd_emb := COALESCE(v_qtd_emb, 1);
  v_vende_avulso := COALESCE(v_vende_avulso, true);
  v_unit_cost := p_cost_centavos / GREATEST(v_qtd_emb, 1);

  SELECT id, cost_centavos, stock, lead_time_days, catalog_item_id,
         unidade_compra, qtd_por_embalagem, vende_avulso
    INTO v_existing
    FROM supplier_offers
   WHERE master_product_id = p_master_product_id
     AND supplier_id = p_supplier_id
     AND status = 'ativa'
     AND replaced_at IS NULL;

  IF v_existing IS NULL THEN
    INSERT INTO supplier_offers (
      master_product_id, supplier_id, catalog_item_id,
      cost_centavos, stock, lead_time_days, status,
      unidade_compra, qtd_por_embalagem, vende_avulso, unit_cost_centavos
    ) VALUES (
      p_master_product_id, p_supplier_id, p_catalog_item_id,
      p_cost_centavos, p_stock, p_lead_time_days, 'ativa',
      v_unidade_compra, v_qtd_emb, v_vende_avulso, v_unit_cost
    ) RETURNING id INTO v_new_id;

    RETURN jsonb_build_object(
      'ok', true, 'offer_id', v_new_id, 'action', 'created'
    );
  END IF;

  IF v_existing.cost_centavos = p_cost_centavos
     AND v_existing.stock IS NOT DISTINCT FROM p_stock
     AND v_existing.lead_time_days = p_lead_time_days
     AND v_existing.unidade_compra IS NOT DISTINCT FROM v_unidade_compra
     AND v_existing.qtd_por_embalagem IS NOT DISTINCT FROM v_qtd_emb
     AND v_existing.vende_avulso IS NOT DISTINCT FROM v_vende_avulso THEN
    IF v_existing.catalog_item_id IS DISTINCT FROM p_catalog_item_id THEN
      UPDATE supplier_offers SET catalog_item_id = p_catalog_item_id, updated_at = now()
      WHERE id = v_existing.id;
    END IF;
    RETURN jsonb_build_object(
      'ok', true, 'offer_id', v_existing.id, 'action', 'unchanged'
    );
  END IF;

  UPDATE supplier_offers SET replaced_at = now(), updated_at = now()
  WHERE id = v_existing.id;

  INSERT INTO supplier_offers (
    master_product_id, supplier_id, catalog_item_id,
    cost_centavos, stock, lead_time_days, status,
    unidade_compra, qtd_por_embalagem, vende_avulso, unit_cost_centavos
  ) VALUES (
    p_master_product_id, p_supplier_id, p_catalog_item_id,
    p_cost_centavos, p_stock, p_lead_time_days, 'ativa',
    v_unidade_compra, v_qtd_emb, v_vende_avulso, v_unit_cost
  ) RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'ok', true,
    'offer_id', v_new_id,
    'action', 'versioned',
    'previous_offer_id', v_existing.id,
    'previous_cost', v_existing.cost_centavos,
    'previous_stock', v_existing.stock,
    'previous_lead_time', v_existing.lead_time_days
  );
END;
$$;

-- ============================================================================
-- 17. RLS — todas as novas tabelas
-- ============================================================================

-- supplier_commercial_terms
ALTER TABLE public.supplier_commercial_terms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "supplier own terms read"
  ON public.supplier_commercial_terms FOR SELECT
  USING (public.owns_supplier(supplier_id));

CREATE POLICY "admin manage terms"
  ON public.supplier_commercial_terms FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "admin update terms"
  ON public.supplier_commercial_terms FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "admin delete terms"
  ON public.supplier_commercial_terms FOR DELETE
  USING (public.is_admin());

REVOKE ALL ON public.supplier_commercial_terms FROM anon;

-- section_configs
ALTER TABLE public.section_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin all section_configs"
  ON public.section_configs FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON public.section_configs FROM anon;

-- product_config_overrides
ALTER TABLE public.product_config_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin all product_config_overrides"
  ON public.product_config_overrides FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON public.product_config_overrides FROM anon;

-- config_audit_log
ALTER TABLE public.config_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin read config_audit_log"
  ON public.config_audit_log FOR SELECT
  USING (public.is_admin());

CREATE POLICY "admin insert config_audit_log"
  ON public.config_audit_log FOR INSERT
  WITH CHECK (public.is_admin());

REVOKE ALL ON public.config_audit_log FROM anon;

-- ccm_configs
ALTER TABLE public.ccm_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin all ccm_configs"
  ON public.ccm_configs FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON public.ccm_configs FROM anon;

-- ccm_config_history
ALTER TABLE public.ccm_config_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin read ccm_config_history"
  ON public.ccm_config_history FOR SELECT
  USING (public.is_admin());

REVOKE ALL ON public.ccm_config_history FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.ccm_config_history FROM authenticated;
GRANT SELECT ON public.ccm_config_history TO authenticated;

-- ============================================================================
-- 18. COMENTÁRIOS
-- ============================================================================

COMMENT ON TABLE public.supplier_commercial_terms IS
  'Condições comerciais versionadas do fornecedor. Apenas uma linha ativa por fornecedor (unique index). Novas condições desativam as anteriores.';
COMMENT ON COLUMN public.supplier_commercial_terms.pedido_minimo_tipo IS
  'valor = pedido mínimo em reais; volume = em unidades (BLOQUEADO até definição de unidade de volume pelo negócio).';
COMMENT ON COLUMN public.supplier_commercial_terms.dias_pedido IS
  'Dias da semana em que a CCM envia pedido. Ints: 0=dom, 1=seg, 2=ter, 3=qua, 4=qui, 5=sex, 6=sab.';
COMMENT ON COLUMN public.supplier_commercial_terms.cutoff_time IS
  'LACUNA: horário de corte não definido pelo documento. Campo preparado para configuração futura.';
COMMENT ON COLUMN public.supplier_catalog_items.unidade_compra IS
  'Unidade de compra do fornecedor: unidade, caixa, fardo, rolo.';
COMMENT ON COLUMN public.supplier_catalog_items.unit_cost_centavos IS
  'Custo por unidade avulsa = cost_centavos / qtd_por_embalagem (R2.2).';
COMMENT ON COLUMN public.products.sale_mode IS
  'Modo de venda: por_unidade, embalagem_fechada, unidade_e_caixa, nao_vender (Fase 12).';
COMMENT ON COLUMN public.products.expected_availability_date IS
  'Data estimada de disponibilidade no CD = próximo ciclo + prazo_entrega_cd_dias úteis (R4.2).';
COMMENT ON TABLE public.section_configs IS
  'Configurações operacionais por seção/departamento. R3.2: desconto caixa; R5.2: limite aumento.';
COMMENT ON TABLE public.product_config_overrides IS
  'Exceções de configuração por produto. R3.2: desconto caixa pode ser diferente da seção.';
COMMENT ON TABLE public.config_audit_log IS
  'Auditoria genérica de alterações de configuração (Fase 21). Imutável, INSERT-only.';
COMMENT ON TABLE public.ccm_configs IS
  'Configurações operacionais da CCM (desconto de caixa, limite de aumento, teto de sobra). Escopo: global, section, product.';
COMMENT ON TABLE public.ccm_config_history IS
  'Trilha de auditoria de todas as alterações em ccm_configs. Imutável — escrita apenas via RPC save_ccm_config.';
COMMENT ON FUNCTION public.has_permission(text) IS
  'Verifica se o usuário autenticado tem a permissão especificada no array profiles.permissions. R3.1: direcao para unidade_e_caixa.';
COMMENT ON FUNCTION public.is_supplier_operationally_active(text) IS
  'Retorna true se o fornecedor tem condições comerciais ativas e válidas. R1.1: todos os campos obrigatórios para ficar ativo.';
COMMENT ON FUNCTION public.save_ccm_config IS
  'Salva configuração com audit trail atômico. Grava quem alterou, quando e o valor anterior.';
