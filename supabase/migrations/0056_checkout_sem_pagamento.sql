-- ============================================================================
-- CCM · Migration 0056 — Checkout sem pagamento antecipado
-- ============================================================================
--
-- O checkout passa a criar pedidos SEM forma de pagamento.
-- Após os fornecedores confirmarem disponibilidade, o cliente paga.
--
-- 1. payment_method nullable em orders
-- 2. Novas colunas em orders (address_id, customer_acceptance_required, customer_accepted_at)
-- 3. Tabela order_access_tokens (acesso guest via token hash)
-- 4. Atualiza materialize_order_requirements (troca check de payment_status por order_status)
-- 5. Bucket de storage "espelhos"
-- 6. RPC validate_order_token (guest token validation)
-- 7. RPC revoke_order_tokens (revogação em lote)
-- ============================================================================

-- ============================================================================
-- 1. PAYMENT_METHOD NULLABLE
-- ============================================================================

ALTER TABLE public.orders ALTER COLUMN payment_method DROP NOT NULL;

COMMENT ON COLUMN public.orders.payment_method IS
  'Forma de pagamento. NULL quando o pedido é criado sem pagamento (checkout sem pagamento antecipado).';

-- ============================================================================
-- 2. NOVAS COLUNAS EM ORDERS
-- ============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS address_id uuid REFERENCES public.addresses(id),
  ADD COLUMN IF NOT EXISTS customer_acceptance_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_accepted_at timestamptz;

COMMENT ON COLUMN public.orders.address_id IS
  'FK para endereço normalizado do cliente (substitui snapshot jsonb para novos pedidos).';

COMMENT ON COLUMN public.orders.customer_acceptance_required IS
  'Indica se o cliente precisa aceitar alterações no pedido (ex: substituições) antes de pagar.';

COMMENT ON COLUMN public.orders.customer_accepted_at IS
  'Timestamp de quando o cliente aceitou as alterações no pedido.';

-- ============================================================================
-- 3. TABELA ORDER_ACCESS_TOKENS
-- ============================================================================
-- Tokens de acesso guest para pedidos (ex: link de pagamento por WhatsApp).
-- O token NUNCA é armazenado em texto claro — apenas o hash SHA-256.

CREATE TABLE IF NOT EXISTS public.order_access_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  scope       text NOT NULL DEFAULT 'read_pay'
              CHECK (scope IN ('read_pay', 'read_only')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_oat_token_hash
  ON public.order_access_tokens(token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oat_order_id
  ON public.order_access_tokens(order_id);

ALTER TABLE public.order_access_tokens ENABLE ROW LEVEL SECURITY;

-- Sem policies para anon/authenticated — acesso SOMENTE via RPCs SECURITY DEFINER.

COMMENT ON TABLE public.order_access_tokens IS
  'Tokens de acesso guest para pedidos. Armazena apenas hash SHA-256 do token; '
  'acesso controlado exclusivamente por RPCs SECURITY DEFINER.';

-- ============================================================================
-- 4. ATUALIZA materialize_order_requirements
-- ============================================================================
-- Troca a verificação de payment_status = ''pago'' por
-- order_status IN (''aguardando-confirmacao'').
-- Toda a lógica restante permanece idêntica à versão da migration 0028.

CREATE OR REPLACE FUNCTION public.materialize_order_requirements(
  p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order_status text;
  v_item           record;
  v_terms          record;
  v_cycle_date     date;
  v_now_sp         timestamp;
  v_today          date;
  v_hora           time;
  v_cutoff         time := '17:30'::time;
  v_from_date      date;
  v_existing_id    uuid;
  v_created        int := 0;
  v_accumulated    int := 0;
  v_skipped        int := 0;
BEGIN
  -- 1. Verificar pedido existe e está em aguardando-confirmacao
  SELECT order_status INTO v_order_status
    FROM public.orders
   WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado.');
  END IF;

  IF v_order_status NOT IN ('aguardando-confirmacao') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido não está em aguardando-confirmacao.');
  END IF;

  -- 2. Hora atual em São Paulo (cutoff + cycle calculation)
  v_now_sp := now() AT TIME ZONE 'America/Sao_Paulo';
  v_today  := v_now_sp::date;
  v_hora   := v_now_sp::time;

  -- 3. Itens elegíveis: com snapshot de fornecedor, ainda não materializados
  FOR v_item IN
    SELECT
      oi.id                     AS item_id,
      oi.supplier_id,
      oi.supplier_offer_id,
      oi.master_product_id,
      oi.supplier_cost_centavos,
      oi.qty,
      so.cost_centavos          AS pack_cost,
      COALESCE(so.qtd_por_embalagem, 1)  AS qtd_por_embalagem,
      COALESCE(so.unidade_compra, 'unidade') AS unidade_compra
    FROM public.order_items oi
    LEFT JOIN public.supplier_offers so ON so.id = oi.supplier_offer_id
   WHERE oi.order_id = p_order_id
     AND oi.requirements_materialized_at IS NULL
     AND oi.supplier_id IS NOT NULL
     AND oi.master_product_id IS NOT NULL
   FOR UPDATE OF oi
  LOOP
    -- 4. Condições comerciais do fornecedor (dias_pedido)
    SELECT * INTO v_terms
      FROM public.supplier_commercial_terms
     WHERE supplier_id = v_item.supplier_id
       AND active = true
       AND valid_to IS NULL;

    IF NOT FOUND THEN
      v_skipped := v_skipped + 1;
      -- Marcar como materializado mesmo sem terms (evita reprocessamento)
      UPDATE public.order_items
         SET requirements_materialized_at = now()
       WHERE id = v_item.item_id;
      CONTINUE;
    END IF;

    -- 5. Calcular cycle_date (respeita cutoff + dias_pedido)
    v_from_date := v_today;
    IF v_hora >= v_cutoff THEN
      v_from_date := v_today + 1;
    END IF;
    v_cycle_date := public.calculate_next_cycle_date(
      v_terms.dias_pedido, v_from_date
    );

    IF v_cycle_date IS NULL THEN
      v_skipped := v_skipped + 1;
      UPDATE public.order_items
         SET requirements_materialized_at = now()
       WHERE id = v_item.item_id;
      CONTINUE;
    END IF;

    -- 6. Acumular ou criar requirement
    SELECT id INTO v_existing_id
      FROM public.purchase_requirements
     WHERE supplier_id      = v_item.supplier_id
       AND master_product_id = v_item.master_product_id
       AND cycle_date        = v_cycle_date
       AND status            = 'pending'
     FOR UPDATE;

    IF v_existing_id IS NOT NULL THEN
      -- Acumular no requirement existente
      UPDATE public.purchase_requirements
         SET quantity_units = quantity_units + v_item.qty
       WHERE id = v_existing_id;
      v_accumulated := v_accumulated + 1;
    ELSE
      -- Criar novo requirement
      INSERT INTO public.purchase_requirements (
        supplier_id, master_product_id,
        source_order_id, source_order_item_id,
        quantity_units, unit_cost_centavos, pack_cost_centavos,
        qtd_por_embalagem, unidade_compra,
        cycle_date, status
      ) VALUES (
        v_item.supplier_id,  v_item.master_product_id,
        p_order_id,          v_item.item_id,
        v_item.qty,          v_item.supplier_cost_centavos,  v_item.pack_cost,
        v_item.qtd_por_embalagem, v_item.unidade_compra,
        v_cycle_date,        'pending'
      );
      v_created := v_created + 1;
    END IF;

    -- 7. Marcar item como materializado (idempotência)
    UPDATE public.order_items
       SET requirements_materialized_at = now()
     WHERE id = v_item.item_id;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',          true,
    'created',     v_created,
    'accumulated', v_accumulated,
    'skipped',     v_skipped
  );
END;
$$;

-- Apenas service_role (backend) pode chamar
REVOKE ALL ON FUNCTION public.materialize_order_requirements(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.materialize_order_requirements(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.materialize_order_requirements(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.materialize_order_requirements(uuid) TO service_role;

COMMENT ON FUNCTION public.materialize_order_requirements IS
  'Materializa itens de pedido em aguardando-confirmacao em purchase_requirements. '
  'Idempotente via requirements_materialized_at. Acumula se mesmo (supplier, product, cycle). '
  'Atualizado na 0056: check por order_status em vez de payment_status.';

-- ============================================================================
-- 5. BUCKET DE STORAGE "espelhos"
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'espelhos', 'espelhos', false, 10485760,
  ARRAY['application/pdf','image/jpeg','image/png','image/webp']::text[]
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 6. RPC: validate_order_token
-- ============================================================================
-- Valida token de acesso guest (hash SHA-256).
-- Retorna dados do pedido se válido, erro se expirado/revogado/inexistente.

CREATE OR REPLACE FUNCTION public.validate_order_token(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_token record;
BEGIN
  SELECT oat.*, o.code AS order_code, o.order_status, o.payment_status
    INTO v_token
    FROM public.order_access_tokens oat
    JOIN public.orders o ON o.id = oat.order_id
   WHERE oat.token_hash = p_token_hash
     AND oat.revoked_at IS NULL
     AND oat.expires_at > now()
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Token inválido ou expirado.');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_token.order_id,
    'order_code', v_token.order_code,
    'order_status', v_token.order_status,
    'payment_status', v_token.payment_status,
    'scope', v_token.scope
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_order_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_order_token(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.validate_order_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_order_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.validate_order_token(text) TO service_role;

COMMENT ON FUNCTION public.validate_order_token IS
  'Valida token de acesso guest (hash SHA-256) e retorna dados básicos do pedido. '
  'Acessível por anon, authenticated e service_role.';

-- ============================================================================
-- 7. RPC: revoke_order_tokens
-- ============================================================================
-- Revoga todos os tokens ativos de um pedido (ex: após pagamento ou cancelamento).

CREATE OR REPLACE FUNCTION public.revoke_order_tokens(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.order_access_tokens
     SET revoked_at = now()
   WHERE order_id = p_order_id
     AND revoked_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_order_tokens(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_order_tokens(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.revoke_order_tokens(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_order_tokens(uuid) TO service_role;

COMMENT ON FUNCTION public.revoke_order_tokens IS
  'Revoga todos os tokens de acesso guest ativos de um pedido. Apenas service_role.';
