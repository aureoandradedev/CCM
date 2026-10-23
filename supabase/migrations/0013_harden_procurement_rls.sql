-- ============================================================================
-- CCM · Fase 10 — Hardening de RLS em tabelas de procurement
-- ============================================================================
--
-- Contexto: QA funcional detectou que RLS pode estar desabilitado em tabelas
-- de procurement no banco de produção (migrations 0005+ podem não ter sido
-- aplicadas). Esta migration reafirma ENABLE RLS, recria policies
-- corretamente e protege colunas sensíveis de `products`.
--
-- Tabelas afetadas:
--   supplier_catalog_items, supplier_offers, master_products,
--   margin_rules, products, supplier_catalogs
--
-- Modelo de acesso:
--   - Fornecedor: vê SOMENTE dados próprios (via owns_supplier)
--   - Admin: acesso completo a todas as tabelas
--   - Anon/cliente: vitrine pública via view products_public (sem custo/margem)
--   - service_role: bypass (padrão Supabase)
-- ============================================================================

-- ============================================================================
-- 1. GARANTIR QUE HELPERS EXISTEM
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT role = 'admin' FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.owns_supplier(sid text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.supplier_id = sid
      );
$$;

-- ============================================================================
-- 2. supplier_catalog_items — Fornecedor vê só os próprios; admin vê tudo
-- ============================================================================

ALTER TABLE public.supplier_catalog_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner rw supplier_catalog_items" ON public.supplier_catalog_items;
CREATE POLICY "owner rw supplier_catalog_items"
  ON public.supplier_catalog_items FOR ALL
  USING (public.owns_supplier(supplier_id))
  WITH CHECK (public.owns_supplier(supplier_id));

-- ============================================================================
-- 3. supplier_offers — Fornecedor vê SOMENTE as próprias; admin vê tudo
-- ============================================================================

ALTER TABLE public.supplier_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner rw supplier_offers" ON public.supplier_offers;
CREATE POLICY "owner rw supplier_offers"
  ON public.supplier_offers FOR ALL
  USING (public.owns_supplier(supplier_id))
  WITH CHECK (public.owns_supplier(supplier_id));

-- ============================================================================
-- 4. master_products — Somente admin
-- ============================================================================

ALTER TABLE public.master_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin all master_products" ON public.master_products;
CREATE POLICY "admin all master_products"
  ON public.master_products FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================================
-- 5. margin_rules — Somente admin (estratégia interna CCM)
-- ============================================================================

ALTER TABLE public.margin_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin all margin_rules" ON public.margin_rules;
CREATE POLICY "admin all margin_rules"
  ON public.margin_rules FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================================
-- 6. supplier_catalogs — Fornecedor vê só os próprios
-- ============================================================================

ALTER TABLE public.supplier_catalogs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner rw supplier_catalogs" ON public.supplier_catalogs;
CREATE POLICY "owner rw supplier_catalogs"
  ON public.supplier_catalogs FOR ALL
  USING (public.owns_supplier(supplier_id))
  WITH CHECK (public.owns_supplier(supplier_id));

-- ============================================================================
-- 7. products — Restringir tabela a admin; vitrine pública via view
-- ============================================================================
--
-- Problema: a policy "public read products" (0001_init.sql) permite SELECT
-- de TODAS as colunas para anon/authenticated, expondo cost_centavos,
-- margin_pct, winning_offer_id, offer_score etc.
--
-- Solução:
--   1. Tabela products → somente admin (leitura e escrita)
--   2. View products_public → colunas seguras para vitrine
--   3. catalog.ts passa a ler de products_public
--
-- A view roda como o owner (security_invoker = false, padrão PG).
-- Isso bypassa RLS da tabela products — a view é a barreira de segurança.
-- PostgREST expõe a view normalmente via GRANT SELECT.
-- ============================================================================

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Remover policies existentes e recriar
DROP POLICY IF EXISTS "public read products" ON public.products;
DROP POLICY IF EXISTS "admin all products" ON public.products;

-- Somente admin acessa a tabela diretamente (inclui colunas sensíveis)
CREATE POLICY "admin all products"
  ON public.products FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Revogar acesso direto à tabela para anon e autenticados não-admin
-- Anon lê via products_public view; admin bypassa via policy acima
REVOKE SELECT ON public.products FROM anon;

-- View pública: SOMENTE colunas seguras para a vitrine
-- security_invoker = false (default) → executa como owner, bypassa RLS da tabela.
-- A view filtra active = true, então só produtos publicados aparecem.
-- NÃO expõe: supplier_id, cost_centavos, margin_pct, winning_offer_id,
-- master_product_id, sourcing_selection_id, offer_score, offer_approved_*.
-- O cliente final não pode descobrir qual fornecedor ganhou.
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
    p.created_at, p.updated_at
  FROM public.products p
  WHERE p.active = true;

-- Dar SELECT na view para anon e authenticated (clientes)
GRANT SELECT ON public.products_public TO anon;
GRANT SELECT ON public.products_public TO authenticated;

-- ============================================================================
-- 8. REVOGAÇÕES COMPLEMENTARES — Anon não acessa procurement
-- ============================================================================

REVOKE INSERT, UPDATE, DELETE ON public.supplier_catalog_items FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.supplier_offers FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.master_products FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.margin_rules FROM anon;
REVOKE ALL ON public.sourcing_selections FROM anon;
REVOKE ALL ON public.procurement_exceptions FROM anon;
REVOKE ALL ON public.procurement_audit_log FROM anon;
REVOKE ALL ON public.orchestrator_lease FROM anon;
REVOKE ALL ON public.publication_log FROM anon;

REVOKE SELECT ON public.supplier_catalog_items FROM anon;
REVOKE SELECT ON public.supplier_offers FROM anon;
REVOKE SELECT ON public.master_products FROM anon;
REVOKE SELECT ON public.margin_rules FROM anon;
REVOKE SELECT ON public.sourcing_selections FROM anon;
REVOKE SELECT ON public.procurement_exceptions FROM anon;
REVOKE SELECT ON public.procurement_audit_log FROM anon;
REVOKE SELECT ON public.orchestrator_lease FROM anon;

REVOKE ALL ON public.supplier_catalogs FROM anon;

-- ============================================================================
-- 9. DOCUMENTAÇÃO
-- ============================================================================

COMMENT ON VIEW public.products_public IS
  'View pública da vitrine. Exclui: supplier_id, cost_centavos, margin_pct, winning_offer_id, offer_score, master_product_id, sourcing_selection_id, offer_approved_*, image_*_meta. Cliente final não descobre fornecedor vencedor.';

COMMENT ON POLICY "admin all products" ON public.products IS
  'Somente admin acessa a tabela products diretamente (inclui colunas sensíveis de procurement).';

COMMENT ON POLICY "owner rw supplier_catalog_items" ON public.supplier_catalog_items IS
  'Tenant isolation: fornecedor vê/edita somente itens do próprio catálogo. Admin vê tudo via owns_supplier().';

COMMENT ON POLICY "owner rw supplier_offers" ON public.supplier_offers IS
  'Tenant isolation: fornecedor vê/edita somente as próprias ofertas. Admin vê tudo via owns_supplier().';

COMMENT ON POLICY "admin all master_products" ON public.master_products IS
  'Somente admin pode acessar master products (dados internos CCM).';

COMMENT ON POLICY "admin all margin_rules" ON public.margin_rules IS
  'Somente admin pode acessar regras de margem (estratégia interna CCM).';
