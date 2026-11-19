-- 0050_supplier_promotions.sql
-- Fase K: Auto promoção por fornecedor, com proteção de margem.
-- OFF por padrão. Admin configura desconto % para produtos de um fornecedor;
-- a margem mínima impede que o preço caia abaixo do custo + min_margin_pct.

-- ============================================================================
-- 1. TABELA supplier_promotions
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.supplier_promotions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id      text NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,

  -- desconto aplicado sobre o retail_price
  discount_pct     numeric(5,2) NOT NULL CHECK (discount_pct > 0 AND discount_pct <= 50),

  -- margem mínima: nunca vender abaixo de cost * (1 + min_margin_pct/100)
  min_margin_pct   numeric(5,2) NOT NULL DEFAULT 10 CHECK (min_margin_pct >= 0),

  -- vigência (NULL = sem limite)
  valid_from       date,
  valid_to         date,

  -- controle
  active           boolean NOT NULL DEFAULT false,
  created_by       uuid REFERENCES public.profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES public.profiles(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT valid_range CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE UNIQUE INDEX one_active_per_supplier ON public.supplier_promotions (supplier_id) WHERE (active = true);
CREATE INDEX idx_supplier_promotions_supplier ON public.supplier_promotions (supplier_id);

CREATE TRIGGER supplier_promotions_updated_at
  BEFORE UPDATE ON public.supplier_promotions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 2. RLS
-- ============================================================================

ALTER TABLE public.supplier_promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_full_access" ON public.supplier_promotions
  FOR ALL
  USING (public.has_role(ARRAY['admin']))
  WITH CHECK (public.has_role(ARRAY['admin']));

CREATE POLICY "compras_read" ON public.supplier_promotions
  FOR SELECT
  USING (public.has_role(ARRAY['compras']));

-- ============================================================================
-- 3. RPC: aplicar promoção a um produto (puro, sem side effect)
-- Retorna o preço promocional protegido por margem mínima.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_supplier_promo(
  p_retail_price_centavos int,
  p_cost_centavos int,
  p_discount_pct numeric,
  p_min_margin_pct numeric
)
RETURNS int
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_discounted int;
  v_floor int;
BEGIN
  -- preço com desconto
  v_discounted := ROUND(p_retail_price_centavos * (1 - p_discount_pct / 100));

  -- piso de margem: cost * (1 + min_margin_pct / 100)
  v_floor := ROUND(p_cost_centavos * (1 + p_min_margin_pct / 100));

  -- retorna o maior (protege a margem)
  RETURN GREATEST(v_discounted, v_floor);
END;
$$;

COMMENT ON TABLE public.supplier_promotions IS
  'Promoções automáticas por fornecedor: desconto % sobre retail, com piso de margem.';
