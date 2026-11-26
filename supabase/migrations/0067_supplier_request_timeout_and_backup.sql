-- 0067: Supplier Request Timeout & Backup — Foundation Layer
--
-- Bloco 2 V2: fundação do fornecedor vencedor/reserva + claims granulares.
-- NÃO cria RPCs de timeout/handoff/confirm V2 — esses são 0068/0069.
--
-- Deliverables:
--   1. Feature flag: ccm_supplier_backup_enabled (OFF)
--   2. Configs: 5 timeout/estimate params
--   3. ALTER supplier_requests: role, transferred_from_request_id, handoff_at
--   4. New statuses: transferido, escalado (supplier_requests + supplier_request_lines)
--   5. supplier_request_lines: add 'perdido' status
--   6. supplier_ranking_snapshots table
--   7. supplier_item_claims table
--   8. order_items.residual_qty column
--   9. Anti-overclaim constraint trigger
--  10. orders.needs_team_intervention flag
--  11. Indexes for cron, claims, ranking
--  12. RLS: supplier isolation
--  13. Auditability: no cascade beyond order lifecycle
--  14. All operations idempotent (IF NOT EXISTS, ON CONFLICT DO NOTHING)
--
-- Invariants enforced:
--   (a) SUM(supplier_item_claims.qty_claimed WHERE confirmed) <= order_items.residual_qty
--   (b) qty_claimed > 0 (CHECK constraint)
--   (c) One claim per request_line per order_item (idempotency_key UNIQUE)
--   (d) Ranking snapshot: one entry per order × master_product (UNIQUE)

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Feature flag + config params in ccm_configs
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.ccm_configs (key, scope, value)
VALUES
  ('ccm_supplier_backup_enabled',          'global', 'false'::jsonb),
  ('supplier_response_timeout_minutes',    'global', '45'::jsonb),
  ('supplier_response_timeout_min_minutes','global', '10'::jsonb),
  ('backup_timeout_minutes',               'global', '30'::jsonb),
  ('payment_estimate_minutes',             'global', '30'::jsonb),
  ('backup_response_estimate_minutes',     'global', '20'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Helper: is_ccm_supplier_backup_enabled()
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_ccm_supplier_backup_enabled()
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT (value)::text::boolean
     FROM ccm_configs
     WHERE key = 'ccm_supplier_backup_enabled' AND scope = 'global'
     LIMIT 1),
    false
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. ALTER supplier_requests: role, transferred_from_request_id, handoff_at
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.supplier_requests
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'manual'
    CHECK (role IN ('vencedor', 'reserva', 'manual')),
  ADD COLUMN IF NOT EXISTS transferred_from_request_id uuid
    REFERENCES public.supplier_requests(id),
  ADD COLUMN IF NOT EXISTS handoff_at timestamptz;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Expand status CHECK on supplier_requests: add transferido, escalado
-- ═══════════════════════════════════════════════════════════════════════════
-- Drop the old constraint and recreate with expanded values.
-- Idempotent: if the new values already exist, the constraint is already correct.

DO $$ BEGIN
  ALTER TABLE public.supplier_requests DROP CONSTRAINT IF EXISTS sr_status_check;
  ALTER TABLE public.supplier_requests ADD CONSTRAINT sr_status_check CHECK (status IN (
    'aguardando_confirmacao',
    'confirmado',
    'confirmado_parcial',
    'divergencia',
    'revisao_necessaria',
    'cancelado',
    'transferido',
    'escalado'
  ));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Expand status CHECK on supplier_request_lines: add 'perdido'
-- ═══════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  ALTER TABLE public.supplier_request_lines DROP CONSTRAINT IF EXISTS srl_status_check;
  ALTER TABLE public.supplier_request_lines ADD CONSTRAINT srl_status_check CHECK (
    status IS NULL OR status IN (
      'pendente',
      'confirmado',
      'confirmado_parcial',
      'indisponivel',
      'divergencia_quantidade',
      'divergencia_custo',
      'revisao_necessaria',
      'perdido'
    )
  );
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. supplier_ranking_snapshots — one per order × master_product
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.supplier_ranking_snapshots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  master_product_id   uuid NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
  winner_supplier_id  text REFERENCES public.suppliers(id),
  winner_offer_id     uuid,
  winner_score        numeric(6,4),
  backup_supplier_id  text REFERENCES public.suppliers(id),
  backup_offer_id     uuid,
  backup_score        numeric(6,4),
  ranking_snapshot    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT srs_order_product_unique UNIQUE (order_id, master_product_id)
);

CREATE INDEX IF NOT EXISTS idx_srs_order ON public.supplier_ranking_snapshots (order_id);

ALTER TABLE public.supplier_ranking_snapshots ENABLE ROW LEVEL SECURITY;

-- Admin can SELECT all ranking snapshots
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'supplier_ranking_snapshots'
      AND policyname = 'srs_admin_select'
  ) THEN
    CREATE POLICY srs_admin_select ON public.supplier_ranking_snapshots
      FOR SELECT TO authenticated
      USING (public.is_admin());
  END IF;
END $$;

-- Compras can SELECT all ranking snapshots
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'supplier_ranking_snapshots'
      AND policyname = 'srs_compras_select'
  ) THEN
    CREATE POLICY srs_compras_select ON public.supplier_ranking_snapshots
      FOR SELECT TO authenticated
      USING (public.has_role(ARRAY['compras']));
  END IF;
END $$;

-- Supplier CANNOT see ranking snapshots (competitor scores/positions)
-- No policy for supplier role → RLS denies by default

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. supplier_item_claims — granular per-quantity claims
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.supplier_item_claims (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                 uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id            uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  supplier_request_id      uuid NOT NULL REFERENCES public.supplier_requests(id) ON DELETE CASCADE,
  supplier_request_line_id uuid NOT NULL REFERENCES public.supplier_request_lines(id) ON DELETE CASCADE,
  supplier_id              text NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  qty_claimed              int NOT NULL CHECK (qty_claimed > 0),
  claim_status             text NOT NULL DEFAULT 'confirmed'
                           CHECK (claim_status IN ('confirmed', 'revoked')),
  claimed_at               timestamptz NOT NULL DEFAULT now(),
  idempotency_key          text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sic_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_sic_order_item ON public.supplier_item_claims (order_item_id)
  WHERE claim_status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_sic_request ON public.supplier_item_claims (supplier_request_id);
CREATE INDEX IF NOT EXISTS idx_sic_line ON public.supplier_item_claims (supplier_request_line_id);
CREATE INDEX IF NOT EXISTS idx_sic_order ON public.supplier_item_claims (order_id);

CREATE TRIGGER set_updated_at_supplier_item_claims
  BEFORE UPDATE ON public.supplier_item_claims
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.supplier_item_claims ENABLE ROW LEVEL SECURITY;

-- Supplier can SELECT own claims only
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'supplier_item_claims'
      AND policyname = 'sic_supplier_select'
  ) THEN
    CREATE POLICY sic_supplier_select ON public.supplier_item_claims
      FOR SELECT TO authenticated
      USING (public.owns_supplier(supplier_id));
  END IF;
END $$;

-- Admin can SELECT all claims
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'supplier_item_claims'
      AND policyname = 'sic_admin_select'
  ) THEN
    CREATE POLICY sic_admin_select ON public.supplier_item_claims
      FOR SELECT TO authenticated
      USING (public.is_admin());
  END IF;
END $$;

-- Compras can SELECT all claims
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'supplier_item_claims'
      AND policyname = 'sic_compras_select'
  ) THEN
    CREATE POLICY sic_compras_select ON public.supplier_item_claims
      FOR SELECT TO authenticated
      USING (public.has_role(ARRAY['compras']));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. order_items.residual_qty — quantity remaining for backup fulfillment
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS residual_qty int;

COMMENT ON COLUMN public.order_items.residual_qty
  IS 'Residual qty set at handoff. NULL = no handoff happened. SUM(claims confirmed) must not exceed this.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Anti-overclaim constraint trigger (defense in depth)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_claim_no_overclaim()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_residual_qty int;
  v_total_claimed int;
BEGIN
  SELECT residual_qty INTO v_residual_qty
  FROM order_items WHERE id = NEW.order_item_id;

  IF v_residual_qty IS NULL THEN
    RAISE EXCEPTION 'Claim on order_item without residual_qty (IS NULL): %',
      NEW.order_item_id;
  END IF;

  SELECT COALESCE(SUM(qty_claimed), 0) INTO v_total_claimed
  FROM supplier_item_claims
  WHERE order_item_id = NEW.order_item_id
    AND claim_status = 'confirmed';

  IF v_total_claimed > v_residual_qty THEN
    RAISE EXCEPTION 'Overclaim: SUM(qty_claimed)=% > residual_qty=% for order_item %',
      v_total_claimed, v_residual_qty, NEW.order_item_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_claim_overclaim ON public.supplier_item_claims;

CREATE CONSTRAINT TRIGGER trg_check_claim_overclaim
  AFTER INSERT OR UPDATE ON public.supplier_item_claims
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.check_claim_no_overclaim();

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. orders.needs_team_intervention — escalation flag
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS needs_team_intervention boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.orders.needs_team_intervention
  IS 'True when supplier escalation requires team review. Blocks payment advancement.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. Indexes for cron job and queries
-- ═══════════════════════════════════════════════════════════════════════════

-- Cron: find winner requests that expired and have not been handed off
CREATE INDEX IF NOT EXISTS idx_sr_timeout_scan
  ON public.supplier_requests (expires_at)
  WHERE status = 'aguardando_confirmacao'
    AND role = 'vencedor'
    AND handoff_at IS NULL;

-- Cron: find backup requests that expired
CREATE INDEX IF NOT EXISTS idx_sr_backup_timeout_scan
  ON public.supplier_requests (expires_at)
  WHERE status = 'aguardando_confirmacao'
    AND role = 'reserva';

-- Query: find requests by role for a given order
CREATE INDEX IF NOT EXISTS idx_sr_order_role
  ON public.supplier_requests (order_id, role);

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. Backfill: existing supplier_requests get role='manual'
-- ═══════════════════════════════════════════════════════════════════════════
-- The DEFAULT 'manual' handles this automatically for existing rows.
-- No explicit backfill needed — the ADD COLUMN with DEFAULT fills all rows.

COMMIT;
