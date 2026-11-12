-- ============================================================================
-- CCM · Migration 0024 — Convite e cadastro de fornecedores
-- ============================================================================
--
-- Fluxo:
--   1. Admin gera convite (token aleatório, só hash salvo)
--   2. Fornecedor abre link público, preenche form
--   3. Solicitação chega no admin (sino + página de revisão)
--   4. Admin aprova → supplier + condições criados atomicamente
--
-- Tabelas:
--   supplier_invites               — convites gerados pelo admin
--   supplier_registration_requests — solicitações preenchidas pelo fornecedor
--
-- RPC:
--   approve_supplier_registration  — aprovação transacional (1 click)
-- ============================================================================

-- ============================================================================
-- 1. SUPPLIER_INVITES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.supplier_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   text        NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  status       text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'used', 'expired', 'revoked')),
  created_by   uuid        NOT NULL REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  used_at      timestamptz
);

COMMENT ON TABLE public.supplier_invites IS
  'Convites para cadastro de fornecedores. Token real nunca é salvo — apenas hash SHA-256.';

ALTER TABLE public.supplier_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_invites" ON public.supplier_invites
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================================
-- 2. SUPPLIER_REGISTRATION_REQUESTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.supplier_registration_requests (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id              uuid NOT NULL REFERENCES public.supplier_invites(id) ON DELETE CASCADE,

  -- Dados cadastrais do fornecedor
  trade_name             text NOT NULL,
  name                   text NOT NULL,
  cnpj                   text,
  state                  text,
  city                   text,
  contact_name           text NOT NULL,
  contact_email          text,
  contact_phone          text,

  -- Condições comerciais propostas
  pedido_minimo_tipo     text NOT NULL DEFAULT 'valor'
                         CHECK (pedido_minimo_tipo IN ('valor', 'volume')),
  pedido_minimo          numeric(12,2) NOT NULL CHECK (pedido_minimo >= 0),
  dias_pedido            int[] NOT NULL,
  prazo_entrega_cd_dias  int NOT NULL CHECK (prazo_entrega_cd_dias >= 0),
  frete_tipo             text NOT NULL CHECK (frete_tipo IN ('gratis_acima', 'fixo')),
  frete_gratis_acima     numeric(12,2),
  frete_valor            numeric(12,2),

  -- Status da solicitação
  status                 text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'approved', 'rejected', 'correction_requested')),
  admin_notes            text,
  reviewed_at            timestamptz,
  reviewed_by            uuid REFERENCES auth.users(id),
  supplier_id            text REFERENCES public.suppliers(id),

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT frete_coherent_req CHECK (
    CASE frete_tipo
      WHEN 'fixo' THEN
        frete_valor IS NOT NULL AND frete_valor >= 0
      WHEN 'gratis_acima' THEN
        frete_gratis_acima IS NOT NULL AND frete_gratis_acima > 0
        AND frete_valor IS NOT NULL AND frete_valor >= 0
    END
  ),
  CONSTRAINT dias_pedido_not_empty_req CHECK (
    array_length(dias_pedido, 1) > 0
  ),
  CONSTRAINT dias_pedido_valid_req CHECK (
    dias_pedido <@ ARRAY[0,1,2,3,4,5,6]
  )
);

COMMENT ON TABLE public.supplier_registration_requests IS
  'Solicitações de cadastro preenchidas por fornecedores via link de convite.';

ALTER TABLE public.supplier_registration_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_requests" ON public.supplier_registration_requests
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Anon pode inserir (form público) — somente se invite válido
CREATE POLICY "anon_insert_request" ON public.supplier_registration_requests
  FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.supplier_invites
      WHERE id = invite_id
        AND status = 'pending'
        AND expires_at > now()
    )
  );

-- ============================================================================
-- 3. RPC: validate_supplier_invite
-- ============================================================================
-- Chamada pela page pública para verificar se o token é válido.
-- Recebe o hash do token (client faz SHA-256 no browser).
-- Retorna { valid, invite_id, expired } sem vazar dados.

CREATE OR REPLACE FUNCTION public.validate_supplier_invite(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_invite record;
BEGIN
  SELECT id, status, expires_at
  INTO v_invite
  FROM public.supplier_invites
  WHERE token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
  END IF;

  IF v_invite.status = 'used' THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'already_used');
  END IF;

  IF v_invite.status = 'revoked' THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'revoked');
  END IF;

  IF v_invite.expires_at <= now() THEN
    UPDATE public.supplier_invites SET status = 'expired' WHERE id = v_invite.id AND status = 'pending';
    RETURN jsonb_build_object('valid', false, 'reason', 'expired');
  END IF;

  RETURN jsonb_build_object('valid', true, 'invite_id', v_invite.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_supplier_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_supplier_invite(text) TO anon;
GRANT EXECUTE ON FUNCTION public.validate_supplier_invite(text) TO authenticated;

COMMENT ON FUNCTION public.validate_supplier_invite IS
  'Valida hash de token de convite. Retorna {valid, invite_id} ou {valid:false, reason}.';

-- ============================================================================
-- 4. RPC: submit_supplier_registration
-- ============================================================================
-- Chamada pelo form público (anon). Insere a solicitação e marca o invite como used.

CREATE OR REPLACE FUNCTION public.submit_supplier_registration(
  p_token_hash           text,
  p_trade_name           text,
  p_name                 text,
  p_cnpj                 text     DEFAULT NULL,
  p_state                text     DEFAULT NULL,
  p_city                 text     DEFAULT NULL,
  p_contact_name         text     DEFAULT NULL,
  p_contact_email        text     DEFAULT NULL,
  p_contact_phone        text     DEFAULT NULL,
  p_pedido_minimo_tipo   text     DEFAULT 'valor',
  p_pedido_minimo        numeric  DEFAULT 0,
  p_dias_pedido          int[]    DEFAULT ARRAY[1,2,3,4,5],
  p_prazo_entrega_cd_dias int     DEFAULT 3,
  p_frete_tipo           text     DEFAULT 'fixo',
  p_frete_gratis_acima   numeric  DEFAULT NULL,
  p_frete_valor          numeric  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_invite record;
  v_req_id uuid;
BEGIN
  -- Buscar invite pelo hash
  SELECT id, status, expires_at
  INTO v_invite
  FROM public.supplier_invites
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Convite não encontrado.');
  END IF;

  IF v_invite.status != 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este convite já foi utilizado.');
  END IF;

  IF v_invite.expires_at <= now() THEN
    UPDATE public.supplier_invites SET status = 'expired' WHERE id = v_invite.id;
    RETURN jsonb_build_object('ok', false, 'error', 'Este convite expirou.');
  END IF;

  -- Validações básicas
  IF p_trade_name IS NULL OR length(trim(p_trade_name)) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Razão social obrigatória (mín. 3 caracteres).');
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nome fantasia obrigatório (mín. 2 caracteres).');
  END IF;

  IF p_contact_name IS NULL OR length(trim(p_contact_name)) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nome do contato obrigatório.');
  END IF;

  -- Inserir solicitação
  INSERT INTO public.supplier_registration_requests (
    invite_id,
    trade_name, name, cnpj, state, city,
    contact_name, contact_email, contact_phone,
    pedido_minimo_tipo, pedido_minimo, dias_pedido,
    prazo_entrega_cd_dias, frete_tipo, frete_gratis_acima, frete_valor
  ) VALUES (
    v_invite.id,
    trim(p_trade_name), trim(p_name), p_cnpj, p_state, p_city,
    trim(p_contact_name), p_contact_email, p_contact_phone,
    p_pedido_minimo_tipo, p_pedido_minimo, p_dias_pedido,
    p_prazo_entrega_cd_dias, p_frete_tipo, p_frete_gratis_acima, p_frete_valor
  )
  RETURNING id INTO v_req_id;

  -- Marcar invite como usado
  UPDATE public.supplier_invites
  SET status = 'used', used_at = now()
  WHERE id = v_invite.id;

  RETURN jsonb_build_object('ok', true, 'request_id', v_req_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_supplier_registration FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_supplier_registration TO anon;
GRANT EXECUTE ON FUNCTION public.submit_supplier_registration TO authenticated;

COMMENT ON FUNCTION public.submit_supplier_registration IS
  'Form público: insere solicitação de cadastro e marca convite como usado. Atômico.';

-- ============================================================================
-- 5. RPC: approve_supplier_registration
-- ============================================================================
-- Admin 1-click: cria supplier + condições comerciais atomicamente.

CREATE OR REPLACE FUNCTION public.approve_supplier_registration(
  p_request_id   uuid,
  p_supplier_id  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_req    record;
  v_sid    text;
  v_tid    uuid;
BEGIN
  -- Somente admin
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
  END IF;

  -- Buscar solicitação
  SELECT * INTO v_req
  FROM public.supplier_registration_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitação não encontrada.');
  END IF;

  IF v_req.status != 'pending' AND v_req.status != 'correction_requested' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitação já foi processada (status: ' || v_req.status || ').');
  END IF;

  -- Gerar supplier id (slug do nome fantasia) se não fornecido
  v_sid := coalesce(
    nullif(trim(p_supplier_id), ''),
    lower(regexp_replace(
      regexp_replace(
        translate(v_req.name, 'àáâãäéèêëíìîïóòôõöúùûüçñÀÁÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
                              'aaaaaeeeeiiiioooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'),
        '[^a-zA-Z0-9 -]', '', 'g'),
      '\s+', '-', 'g'))
  );

  -- Verificar se supplier id já existe
  IF EXISTS (SELECT 1 FROM public.suppliers WHERE id = v_sid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Já existe um fornecedor com o identificador "' || v_sid || '". Informe um ID diferente.');
  END IF;

  -- Criar supplier
  INSERT INTO public.suppliers (
    id, name, trade_name, cnpj, state, city,
    contact_name, contact_email, contact_phone,
    lead_time_days, active
  ) VALUES (
    v_sid, v_req.name, v_req.trade_name,
    CASE WHEN v_req.cnpj IS NOT NULL THEN regexp_replace(v_req.cnpj, '\D', '', 'g') ELSE NULL END,
    v_req.state, v_req.city,
    v_req.contact_name, v_req.contact_email, v_req.contact_phone,
    v_req.prazo_entrega_cd_dias, true
  );

  -- Criar condições comerciais
  INSERT INTO public.supplier_commercial_terms (
    supplier_id,
    pedido_minimo_tipo, pedido_minimo, dias_pedido,
    prazo_entrega_cd_dias, frete_tipo, frete_gratis_acima, frete_valor,
    created_by, active
  ) VALUES (
    v_sid,
    v_req.pedido_minimo_tipo, v_req.pedido_minimo, v_req.dias_pedido,
    v_req.prazo_entrega_cd_dias, v_req.frete_tipo, v_req.frete_gratis_acima, v_req.frete_valor,
    auth.uid(), true
  )
  RETURNING id INTO v_tid;

  -- Atualizar solicitação
  UPDATE public.supplier_registration_requests
  SET status      = 'approved',
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      supplier_id = v_sid,
      updated_at  = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'ok', true,
    'supplier_id', v_sid,
    'terms_id', v_tid
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_supplier_registration FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_supplier_registration FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_supplier_registration(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.approve_supplier_registration IS
  'Admin 1-click: cria fornecedor + condições comerciais a partir de uma solicitação. Transacional.';

-- ============================================================================
-- 6. Índices
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_invites_token_hash ON public.supplier_invites (token_hash);
CREATE INDEX IF NOT EXISTS idx_invites_status ON public.supplier_invites (status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_requests_status ON public.supplier_registration_requests (status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_requests_invite ON public.supplier_registration_requests (invite_id);
