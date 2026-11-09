-- ============================================================================
-- CCM · Fases 17–20 — Pricing automático, troca de fornecedor, relatório diário
-- ============================================================================
--
-- R5.1–R5.5: Preço = custo do fornecedor ativo + regra de preço da seção.
--            Limite de aumento automático por seção. Feature flag OFF.
-- R6.1–R6.4: Troca automática de fornecedor. Feature flag OFF.
--            Log interno, nada enviado ao fornecedor.
-- R20: Relatório diário operacional.
-- ============================================================================

-- ============================================================================
-- 1. LOG DE ALTERAÇÕES DE PREÇO (auditoria R5.1–R5.5)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.price_change_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        text NOT NULL,
  master_product_id uuid REFERENCES public.master_products(id) ON DELETE CASCADE,
  supplier_id       text REFERENCES public.suppliers(id),
  old_cost_centavos int,
  new_cost_centavos int NOT NULL,
  old_price_centavos int,
  new_price_centavos int NOT NULL,
  change_pct        numeric(8,2),
  auto_applied      boolean NOT NULL DEFAULT false,
  blocked           boolean NOT NULL DEFAULT false,
  block_reason      text,
  approved_by       uuid REFERENCES public.profiles(id),
  approved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS price_change_log_product_idx
  ON public.price_change_log (product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS price_change_log_blocked_idx
  ON public.price_change_log (blocked, created_at DESC)
  WHERE blocked = true;

ALTER TABLE public.price_change_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin all price_change_log"
  ON public.price_change_log FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON public.price_change_log FROM anon;

-- ============================================================================
-- 2. LOG DE TROCA DE FORNECEDOR (R6.1–R6.4)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.supplier_replacement_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
  product_id        text,
  old_supplier_id   text REFERENCES public.suppliers(id),
  new_supplier_id   text REFERENCES public.suppliers(id),
  old_offer_id      uuid REFERENCES public.supplier_offers(id),
  new_offer_id      uuid REFERENCES public.supplier_offers(id),
  reason            text NOT NULL,
  old_cost_centavos int,
  new_cost_centavos int,
  price_change_pct  numeric(8,2),
  auto_applied      boolean NOT NULL DEFAULT false,
  approved_by       uuid REFERENCES public.profiles(id),
  approved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS replacement_log_product_idx
  ON public.supplier_replacement_log (master_product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS replacement_log_date_idx
  ON public.supplier_replacement_log (created_at DESC);

ALTER TABLE public.supplier_replacement_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin all supplier_replacement_log"
  ON public.supplier_replacement_log FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON public.supplier_replacement_log FROM anon;

-- ============================================================================
-- 3. VIEW: relatório diário operacional (R20, R6.4)
-- ============================================================================

CREATE OR REPLACE VIEW public.v_daily_operations AS
WITH price_changes AS (
  SELECT
    pc.created_at::date AS report_date,
    'price_change' AS event_type,
    pc.product_id,
    mp.name AS product_name,
    pc.old_price_centavos,
    pc.new_price_centavos,
    pc.change_pct,
    pc.auto_applied,
    pc.blocked,
    NULL::text AS old_supplier_name,
    NULL::text AS new_supplier_name,
    NULL::text AS reason,
    pc.created_at
  FROM public.price_change_log pc
  LEFT JOIN public.master_products mp ON mp.id = pc.master_product_id
),
replacements AS (
  SELECT
    rl.created_at::date AS report_date,
    'supplier_replacement' AS event_type,
    rl.product_id,
    mp.name AS product_name,
    rl.old_cost_centavos AS old_price_centavos,
    rl.new_cost_centavos AS new_price_centavos,
    rl.price_change_pct AS change_pct,
    rl.auto_applied,
    false AS blocked,
    os.name AS old_supplier_name,
    ns.name AS new_supplier_name,
    rl.reason,
    rl.created_at
  FROM public.supplier_replacement_log rl
  LEFT JOIN public.master_products mp ON mp.id = rl.master_product_id
  LEFT JOIN public.suppliers os ON os.id = rl.old_supplier_id
  LEFT JOIN public.suppliers ns ON ns.id = rl.new_supplier_id
),
purchase_orders AS (
  SELECT
    spo.cycle_date AS report_date,
    'purchase_order' AS event_type,
    NULL::text AS product_id,
    s.name AS product_name,
    spo.total_centavos AS old_price_centavos,
    CASE WHEN spo.minimum_value IS NOT NULL THEN (spo.minimum_value * 100)::int END AS new_price_centavos,
    NULL::numeric AS change_pct,
    false AS auto_applied,
    NOT spo.minimum_met AS blocked,
    NULL::text AS old_supplier_name,
    s.name AS new_supplier_name,
    spo.status AS reason,
    spo.created_at
  FROM public.supplier_purchase_orders spo
  LEFT JOIN public.suppliers s ON s.id = spo.supplier_id
)
SELECT * FROM price_changes
UNION ALL
SELECT * FROM replacements
UNION ALL
SELECT * FROM purchase_orders
ORDER BY created_at DESC;

-- ============================================================================
-- 4. FEATURE FLAGS DEFAULTS (auto_price e auto_switch já em 0016)
-- ============================================================================
-- Já inseridos em 0016 como false. Nada a fazer aqui.

-- ============================================================================
-- 5. COMENTÁRIOS
-- ============================================================================

COMMENT ON TABLE public.price_change_log IS
  'Auditoria de todas as alterações de preço. R5.1–R5.5: registra se foi auto-aplicada ou bloqueada por exceder limite.';

COMMENT ON COLUMN public.price_change_log.auto_applied IS
  'true = preço mudou automaticamente (dentro do limite da seção). R5.3.';

COMMENT ON COLUMN public.price_change_log.blocked IS
  'true = preço ultrapassou limite e não foi aplicado. R5.4: gera notificação [Aprovar][Tirar da venda].';

COMMENT ON TABLE public.supplier_replacement_log IS
  'R6.4: Toda troca aparece no relatório do dia. Registro interno, nada enviado ao fornecedor (R6.2).';

COMMENT ON COLUMN public.supplier_replacement_log.reason IS
  'Motivo da troca: sem_estoque, indisponivel, custo_menor, etc.';

COMMENT ON VIEW public.v_daily_operations IS
  'Relatório diário operacional. Consolida alterações de preço, trocas de fornecedor e pedidos de compra.';
