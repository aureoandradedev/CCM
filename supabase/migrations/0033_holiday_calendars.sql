-- ============================================================================
-- CCM · Migration 0033 — Holiday Calendars + Supplier Calendar Extensions
-- ============================================================================
-- Bloco 1: Calendário real por fornecedor
--
-- 1. holiday_calendars: feriados por escopo (national/state/municipal)
-- 2. supplier_commercial_terms: +business_hours jsonb, +lead_time_minutes int
-- 3. ccm_configs: cd_city, cd_state (100% configurável, sem default hardcoded)
-- 4. resolve_holidays(state, city): merge national+state+municipal → date[]
-- 5. effective_cutoff(supplier_id, dow): close−lead_time, fallback chain
-- 6. add_business_days_v2(date, int, date[]): versão com array de feriados
-- 7. Atualizar materialize_order_requirements para usar effective_cutoff
-- 8. Migrar feriados existentes de ccm_configs → holiday_calendars
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TABELA: holiday_calendars
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.holiday_calendars (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         text NOT NULL CHECK (scope IN ('national','state','municipal')),
  state_code    text,
  city_name     text,
  holiday_date  date NOT NULL,
  name          text NOT NULL,
  recurring     boolean NOT NULL DEFAULT false,
  created_by    uuid REFERENCES public.profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS holiday_calendars_unique_idx
  ON public.holiday_calendars (scope, COALESCE(state_code,''), COALESCE(city_name,''), holiday_date);

CREATE INDEX IF NOT EXISTS holiday_calendars_date_idx
  ON public.holiday_calendars (holiday_date);

CREATE INDEX IF NOT EXISTS holiday_calendars_scope_idx
  ON public.holiday_calendars (scope, state_code, city_name);

COMMENT ON TABLE public.holiday_calendars IS
  'Calendário de feriados por escopo. Admin-only. Frontend recebe apenas resultado calculado.';

-- RLS: admin read/write only
ALTER TABLE public.holiday_calendars ENABLE ROW LEVEL SECURITY;

CREATE POLICY holiday_calendars_admin_all ON public.holiday_calendars
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON public.holiday_calendars FROM anon;
REVOKE ALL ON public.holiday_calendars FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.holiday_calendars TO authenticated;

-- ============================================================================
-- 2. ESTENDER supplier_commercial_terms
-- ============================================================================

ALTER TABLE public.supplier_commercial_terms
  ADD COLUMN IF NOT EXISTS business_hours jsonb,
  ADD COLUMN IF NOT EXISTS lead_time_minutes int DEFAULT 30;

COMMENT ON COLUMN public.supplier_commercial_terms.business_hours IS
  'Horários de funcionamento por dia da semana ISO. {"1":{"open":"08:00","close":"17:00"}, ...}. '
  'Chaves: 1=seg..7=dom. Ausente/null = fechado nesse dia.';

COMMENT ON COLUMN public.supplier_commercial_terms.lead_time_minutes IS
  'Minutos antes do fechamento que o fornecedor precisa para processar pedido. '
  'Cutoff real = close_time - lead_time_minutes.';

-- ============================================================================
-- 3. CD CONFIG: cd_city, cd_state (100% configurável)
-- ============================================================================
-- NÃO inserir valores default. Admin DEVE configurar.
-- Goiânia/GO pode ser inserido via seed/teste, nunca como default de produção.

INSERT INTO public.ccm_configs (key, scope, value)
VALUES ('cd_city', 'global', 'null')
ON CONFLICT DO NOTHING;

INSERT INTO public.ccm_configs (key, scope, value)
VALUES ('cd_state', 'global', 'null')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 4. FUNCTION: resolve_holidays(state, city)
-- ============================================================================
-- Retorna array de dates: merge national + state match + municipal match.
-- Usado para calcular feriados aplicáveis a um contexto (fornecedor ou CD).

CREATE OR REPLACE FUNCTION public.resolve_holidays(
  p_state text DEFAULT NULL,
  p_city  text DEFAULT NULL
) RETURNS date[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_holidays date[];
BEGIN
  SELECT COALESCE(array_agg(DISTINCT h.holiday_date ORDER BY h.holiday_date), '{}')
    INTO v_holidays
    FROM public.holiday_calendars h
   WHERE h.scope = 'national'
      OR (h.scope = 'state' AND h.state_code = p_state)
      OR (h.scope = 'municipal' AND h.state_code = p_state AND h.city_name = p_city);

  RETURN v_holidays;
END;
$$;

COMMENT ON FUNCTION public.resolve_holidays IS
  'Merge feriados: national + state do contexto + municipal do contexto. Dedup por data.';

-- ============================================================================
-- 5. FUNCTION: effective_cutoff(supplier_id, dow)
-- ============================================================================
-- Calcula o cutoff real para um fornecedor em um dia da semana.
-- Fallback chain: business_hours[dow].close − lead_time → cutoff_time → global → 17:30
-- Retorna (cutoff_time, is_open).

CREATE OR REPLACE FUNCTION public.effective_cutoff(
  p_supplier_id text,
  p_dow         int  -- dia ISO: 1=seg..7=dom
) RETURNS TABLE(cutoff_time time, is_open boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_terms         record;
  v_bh            jsonb;
  v_day_hours     jsonb;
  v_close_str     text;
  v_close_time    time;
  v_lead          int;
  v_global_cutoff text;
BEGIN
  -- Buscar termos comerciais ativos
  SELECT sct.business_hours, sct.lead_time_minutes, sct.cutoff_time AS ct
    INTO v_terms
    FROM public.supplier_commercial_terms sct
   WHERE sct.supplier_id = p_supplier_id
     AND sct.active = true
     AND sct.valid_to IS NULL
   LIMIT 1;

  -- Se não encontrou termos, usar global
  IF NOT FOUND THEN
    SELECT c.value::jsonb #>> '{}' INTO v_global_cutoff
      FROM public.ccm_configs c
     WHERE c.key = 'horario_corte_ciclo' AND c.scope = 'global';
    cutoff_time := COALESCE(v_global_cutoff, '17:30')::time;
    is_open := true;
    RETURN NEXT;
    RETURN;
  END IF;

  v_bh := v_terms.business_hours;
  v_lead := COALESCE(v_terms.lead_time_minutes, 30);

  -- Tentar business_hours para o dia
  IF v_bh IS NOT NULL AND v_bh ? p_dow::text THEN
    v_day_hours := v_bh -> p_dow::text;
    v_close_str := v_day_hours ->> 'close';

    IF v_close_str IS NOT NULL THEN
      v_close_time := v_close_str::time;
      cutoff_time := v_close_time - (v_lead || ' minutes')::interval;
      is_open := true;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- Se business_hours existe mas o dia não está → fornecedor fechado
  IF v_bh IS NOT NULL AND jsonb_typeof(v_bh) = 'object' AND v_bh != '{}'::jsonb THEN
    cutoff_time := NULL;
    is_open := false;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Fallback: cutoff_time do terms
  IF v_terms.ct IS NOT NULL THEN
    cutoff_time := v_terms.ct;
    is_open := true;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Fallback: global
  SELECT c.value #>> '{}' INTO v_global_cutoff
    FROM public.ccm_configs c
   WHERE c.key = 'horario_corte_ciclo' AND c.scope = 'global';
  cutoff_time := COALESCE(v_global_cutoff, '17:30')::time;
  is_open := true;
  RETURN NEXT;
  RETURN;
END;
$$;

COMMENT ON FUNCTION public.effective_cutoff IS
  'Cutoff real: close_time - lead_time_minutes. Fallback: cutoff_time → global → 17:30. '
  'Retorna (cutoff_time, is_open). is_open=false quando fornecedor fechado no dia.';

REVOKE ALL ON FUNCTION public.effective_cutoff(text, int) FROM anon;

-- ============================================================================
-- 6. FUNCTION: add_business_days_v2(date, int, date[])
-- ============================================================================
-- Versão que recebe array de feriados direto (sem ler ccm_configs).
-- Coexiste com add_business_days original para backward compat.

CREATE OR REPLACE FUNCTION public.add_business_days_v2(
  p_start    date,
  p_days     int,
  p_holidays date[] DEFAULT '{}'
) RETURNS date
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_result    date := p_start;
  v_remaining int := p_days;
BEGIN
  IF p_days <= 0 THEN RETURN p_start; END IF;

  WHILE v_remaining > 0 LOOP
    v_result := v_result + 1;
    IF extract(dow FROM v_result)::int NOT IN (0, 6)
       AND v_result != ALL(p_holidays) THEN
      v_remaining := v_remaining - 1;
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;

-- ============================================================================
-- 7. ATUALIZAR materialize_order_requirements
-- ============================================================================
-- Substituir cutoff hardcoded 17:30 por effective_cutoff(supplier_id, dow).
-- Também usar resolve_holidays para add_business_days no cálculo de cycle.

CREATE OR REPLACE FUNCTION public.materialize_order_requirements(
  p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_payment_status text;
  v_item           record;
  v_terms          record;
  v_cycle_date     date;
  v_now_sp         timestamp;
  v_today          date;
  v_hora           time;
  v_cutoff_rec     record;
  v_from_date      date;
  v_existing_id    uuid;
  v_created        int := 0;
  v_accumulated    int := 0;
  v_skipped        int := 0;
  v_dow_iso        int;
BEGIN
  -- 1. Verificar pedido existe e está pago
  SELECT payment_status INTO v_payment_status
    FROM public.orders
   WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado.');
  END IF;

  IF v_payment_status <> 'pago' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido não está pago.');
  END IF;

  -- 2. Hora atual em São Paulo
  v_now_sp := now() AT TIME ZONE 'America/Sao_Paulo';
  v_today  := v_now_sp::date;
  v_hora   := v_now_sp::time;

  -- 3. Itens elegíveis
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
    -- 4. Condições comerciais do fornecedor
    SELECT * INTO v_terms
      FROM public.supplier_commercial_terms
     WHERE supplier_id = v_item.supplier_id
       AND active = true
       AND valid_to IS NULL;

    IF NOT FOUND THEN
      v_skipped := v_skipped + 1;
      UPDATE public.order_items
         SET requirements_materialized_at = now()
       WHERE id = v_item.item_id;
      CONTINUE;
    END IF;

    -- 5. Calcular cycle_date com effective_cutoff por fornecedor
    -- DOW ISO: 1=seg..7=dom (extract(isodow))
    v_dow_iso := extract(isodow FROM v_today)::int;

    SELECT ec.cutoff_time, ec.is_open
      INTO v_cutoff_rec
      FROM public.effective_cutoff(v_item.supplier_id, v_dow_iso) ec;

    v_from_date := v_today;

    -- Se fornecedor fechado hoje OU hora >= cutoff → avançar
    IF NOT v_cutoff_rec.is_open
       OR (v_cutoff_rec.cutoff_time IS NOT NULL AND v_hora >= v_cutoff_rec.cutoff_time) THEN
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
      UPDATE public.purchase_requirements
         SET quantity_units = quantity_units + v_item.qty
       WHERE id = v_existing_id;
      v_accumulated := v_accumulated + 1;
    ELSE
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

    -- 7. Marcar item como materializado
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

-- Manter permissões: service_role only
REVOKE ALL ON FUNCTION public.materialize_order_requirements(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.materialize_order_requirements(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.materialize_order_requirements(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.materialize_order_requirements(uuid) TO service_role;

-- ============================================================================
-- 8. MIGRAR FERIADOS EXISTENTES
-- ============================================================================
-- Ler ccm_configs key='feriados' scope='global' e inserir em holiday_calendars
-- como scope='national'.

DO $$
DECLARE
  v_holidays jsonb;
  v_date     text;
BEGIN
  SELECT c.value::jsonb INTO v_holidays
    FROM public.ccm_configs c
   WHERE c.key = 'feriados' AND c.scope = 'global';

  IF v_holidays IS NOT NULL AND jsonb_typeof(v_holidays) = 'array' THEN
    FOR v_date IN SELECT jsonb_array_elements_text(v_holidays) LOOP
      INSERT INTO public.holiday_calendars (scope, holiday_date, name, recurring)
      VALUES ('national', v_date::date, 'Migrado de ccm_configs', false)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
END;
$$;

COMMIT;
