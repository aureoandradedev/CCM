-- ============================================================================
-- Migration 0022: Admin hardening
-- ============================================================================
--
-- Contexto: O fornecedor não opera mais diretamente o CCM.
-- Todo cadastro, importação e gestão de condições comerciais é feito pelo admin.
--
-- Parte A: Revogar EXECUTE das RPCs supplier-facing da 0021.
--   As funções não são dropadas — podem ser re-concedidas se o fornecedor
--   voltar a operar no futuro. O trigger protect_catalog_derived_fields
--   permanece ativo (proteção de campos derivados continua válida).
--
-- Parte B: Nova RPC save_supplier_commercial_terms_admin com parâmetros
--   numeric(12,2) para preservar centavos. Atômica: deactivate + insert
--   na mesma transação.
-- ============================================================================

-- ============================================================================
-- PARTE A: Revogar RPCs supplier-facing
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.get_matching_masters(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.persist_match_results_supplier(uuid, jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_approve_catalog_matches(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.reset_catalog_for_resync(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.update_normalized_items(uuid, jsonb) FROM authenticated;

-- ============================================================================
-- PARTE B: RPC admin para condições comerciais com numeric(12,2)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.save_supplier_commercial_terms_admin(
  p_supplier_id           text,
  p_pedido_minimo_tipo    text,
  p_pedido_minimo         numeric(12,2),
  p_frete_tipo            text,
  p_frete_gratis_acima    numeric(12,2) DEFAULT NULL,
  p_frete_valor           numeric(12,2) DEFAULT NULL,
  p_dias_pedido           int[] DEFAULT ARRAY[1,2,3,4,5],
  p_prazo_entrega_cd_dias int DEFAULT 3
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Somente admin
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado. Somente administradores.');
  END IF;

  -- Validar supplier existe
  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Fornecedor não encontrado.');
  END IF;

  -- Validar pedido_minimo_tipo
  IF p_pedido_minimo_tipo NOT IN ('valor', 'volume') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Tipo de pedido mínimo inválido.');
  END IF;

  -- Validar pedido_minimo
  IF p_pedido_minimo IS NULL OR p_pedido_minimo <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido mínimo deve ser maior que zero.');
  END IF;

  -- Validar frete_tipo
  IF p_frete_tipo NOT IN ('gratis_acima', 'fixo') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Tipo de frete inválido.');
  END IF;

  -- Validar frete fixo
  IF p_frete_tipo = 'fixo' AND (p_frete_valor IS NULL OR p_frete_valor < 0) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Valor do frete fixo inválido.');
  END IF;

  -- Validar frete gratis_acima
  IF p_frete_tipo = 'gratis_acima' AND (p_frete_gratis_acima IS NULL OR p_frete_gratis_acima <= 0) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Valor mínimo para frete grátis inválido.');
  END IF;
  IF p_frete_tipo = 'gratis_acima' AND (p_frete_valor IS NULL OR p_frete_valor < 0) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Valor do frete para pedidos abaixo do mínimo inválido.');
  END IF;

  -- Validar dias_pedido
  IF p_dias_pedido IS NULL OR array_length(p_dias_pedido, 1) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe ao menos um dia de pedido.');
  END IF;

  -- Validar prazo
  IF p_prazo_entrega_cd_dias IS NULL OR p_prazo_entrega_cd_dias < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Prazo de entrega deve ser ao menos 1 dia.');
  END IF;

  -- ATÔMICO: encerrar termo ativo anterior
  UPDATE public.supplier_commercial_terms
  SET active = false, valid_to = now()
  WHERE supplier_id = p_supplier_id AND active = true AND valid_to IS NULL;

  -- Inserir novo termo ativo
  INSERT INTO public.supplier_commercial_terms (
    supplier_id, pedido_minimo_tipo, pedido_minimo,
    frete_tipo, frete_gratis_acima, frete_valor,
    dias_pedido, prazo_entrega_cd_dias, active
  ) VALUES (
    p_supplier_id, p_pedido_minimo_tipo, p_pedido_minimo,
    p_frete_tipo, p_frete_gratis_acima, p_frete_valor,
    p_dias_pedido, p_prazo_entrega_cd_dias, true
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'terms_id', v_id);
END;
$$;

-- Permissões: somente admin autenticado (checagem is_admin() interna é a barreira real)
REVOKE EXECUTE ON FUNCTION public.save_supplier_commercial_terms_admin FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_supplier_commercial_terms_admin FROM anon;
GRANT EXECUTE ON FUNCTION public.save_supplier_commercial_terms_admin(text, text, numeric, text, numeric, numeric, int[], int) TO authenticated;

-- ============================================================================
-- Comentários
-- ============================================================================

COMMENT ON FUNCTION public.save_supplier_commercial_terms_admin IS
  'Admin-only: define condições comerciais do fornecedor atomicamente. Parâmetros numeric(12,2) preservam centavos. Encerra termo anterior e insere novo ativo na mesma transação.';
