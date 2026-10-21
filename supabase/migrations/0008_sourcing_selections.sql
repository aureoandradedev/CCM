-- ============================================================================
-- CCM · Fase 6 revisão — Decisões de sourcing separadas de status comercial
-- ----------------------------------------------------------------------------
-- Separa a decisão "qual oferta é a vencedora" do status comercial da oferta.
--
-- Antes:  supplier_offers.status = 'escolhida' marcava a vencedora.
--         Trocar vencedora forçava a anterior a 'vencida' (perdia validade
--         comercial sem justificativa real).
--
-- Agora:  supplier_offers.status reflete apenas disponibilidade comercial:
--           ativa        = oferta comercialmente válida
--           indisponivel = sem disponibilidade
--           vencida      = validade comercial expirada
--           escolhida    = legado, mantido no CHECK, não utilizado
--
--         sourcing_selections registra qual oferta foi selecionada como
--         vencedora para cada master_product, com histórico e auditoria.
-- ============================================================================

-- ============================================================================
-- 1. TABELA DE SELEÇÕES DE SOURCING
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sourcing_selections (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
  supplier_offer_id uuid NOT NULL REFERENCES public.supplier_offers(id) ON DELETE CASCADE,
  selected_by       uuid NOT NULL REFERENCES public.profiles(id),
  selected_at       timestamptz NOT NULL DEFAULT now(),
  replaced_at       timestamptz,
  note              text,
  score             numeric(6,2),
  ambiguous         boolean NOT NULL DEFAULT false,
  ranking_snapshot  jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Garantia no banco: no máximo 1 seleção ativa por master_product.
-- Duas requisições concorrentes não podem deixar dois vencedores.
CREATE UNIQUE INDEX IF NOT EXISTS sourcing_selections_active_idx
  ON public.sourcing_selections (master_product_id)
  WHERE replaced_at IS NULL;

CREATE INDEX IF NOT EXISTS sourcing_selections_master_idx
  ON public.sourcing_selections (master_product_id, selected_at DESC);

CREATE INDEX IF NOT EXISTS sourcing_selections_offer_idx
  ON public.sourcing_selections (supplier_offer_id);

-- ============================================================================
-- 2. RLS — somente admin
-- ============================================================================

ALTER TABLE public.sourcing_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin all sourcing_selections"
  ON public.sourcing_selections FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ============================================================================
-- 3. RPC ATÔMICA — selecionar oferta vencedora
-- ============================================================================
-- SECURITY DEFINER: executa com permissões do owner (bypass RLS internamente).
-- Verificação de admin via is_admin().
-- Protege contra race condition: UPDATE + INSERT em transação única.

CREATE OR REPLACE FUNCTION public.select_sourcing_offer(
  p_master_product_id uuid,
  p_supplier_offer_id uuid,
  p_selected_by       uuid,
  p_note              text    DEFAULT NULL,
  p_score             numeric DEFAULT NULL,
  p_ambiguous         boolean DEFAULT false,
  p_ranking_snapshot  jsonb   DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Acesso restrito ao administrador.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM supplier_offers
    WHERE id = p_supplier_offer_id
      AND master_product_id = p_master_product_id
      AND status = 'ativa'
  ) THEN
    RAISE EXCEPTION 'Oferta não encontrada ou não está ativa.';
  END IF;

  UPDATE sourcing_selections
  SET replaced_at = now()
  WHERE master_product_id = p_master_product_id
    AND replaced_at IS NULL;

  INSERT INTO sourcing_selections (
    master_product_id, supplier_offer_id, selected_by,
    note, score, ambiguous, ranking_snapshot
  ) VALUES (
    p_master_product_id, p_supplier_offer_id, p_selected_by,
    p_note, p_score, p_ambiguous, p_ranking_snapshot
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.select_sourcing_offer(uuid, uuid, uuid, text, numeric, boolean, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.select_sourcing_offer(uuid, uuid, uuid, text, numeric, boolean, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.select_sourcing_offer(uuid, uuid, uuid, text, numeric, boolean, jsonb) TO authenticated;

-- ============================================================================
-- 4. COMENTÁRIOS
-- ============================================================================

COMMENT ON TABLE public.sourcing_selections IS
  'Decisões de sourcing: qual oferta foi selecionada como vencedora para cada master_product. Histórico preservado via replaced_at.';

COMMENT ON COLUMN public.sourcing_selections.replaced_at IS
  'NULL = seleção atual ativa; NOT NULL = substituída por seleção mais recente.';

COMMENT ON COLUMN public.sourcing_selections.ranking_snapshot IS
  'Snapshot resumido do ranking no momento da decisão (posições, scores). Registro imutável.';

COMMENT ON COLUMN public.sourcing_selections.ambiguous IS
  'Se o ranking estava ambíguo no momento da decisão (gap < MIN_RANK_GAP entre top 2).';
