-- CCM · Migration 0030 — Recriar products_public com colunas de packaging/sale_mode
--
-- CAUSA RAIZ: a migration 0016 adicionou sale_mode, unidade_compra,
--   qtd_por_embalagem, package_discount_pct e expected_availability_date
--   à tabela products e fez CREATE OR REPLACE VIEW products_public com
--   essas colunas. Porém a view no Supabase dev ficou na versão de 0013
--   (33 colunas), sem as 5 novas. O código (catalog.ts PRODUCT_SELECT)
--   pede essas colunas → PostgREST retorna erro → catálogo cai em mock.
--
-- CORREÇÃO: recriar a view com todas as colunas públicas legítimas.
--   Nenhuma coluna sensível (cost, margin, supplier_id, offer_*, image_*
--   internals, master_product_id, sourcing_selection_id, search, packaging,
--   publish_status) é exposta.

CREATE OR REPLACE VIEW public.products_public AS
  SELECT
    p.id,
    p.slug,
    p.sku,
    p.ean,
    p.name,
    p.brand_slug,
    p.brand_name,
    p.category_slug,
    p.subcategory_slug,
    p.unit,
    p.pack_info,
    p.retail_price,
    p.wholesale_price,
    p.wholesale_min_qty,
    p.list_price,
    p.pix_discount_pct,
    p.images,
    p.rating,
    p.review_count,
    p.badges,
    p.short_description,
    p.description,
    p.specs,
    p.stock,
    p.max_per_order,
    p.max_per_order_enabled,
    p.stock_status,
    p.tags,
    p.yield_hint,
    p.sort,
    p.active,
    p.created_at,
    p.updated_at,
    p.sale_mode,
    p.unidade_compra,
    p.qtd_por_embalagem,
    p.package_discount_pct,
    p.expected_availability_date
  FROM public.products p
  WHERE p.active = true;

-- Permissões: leitura pública, sem escrita
GRANT SELECT ON public.products_public TO anon;
GRANT SELECT ON public.products_public TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.products_public FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.products_public FROM authenticated;
