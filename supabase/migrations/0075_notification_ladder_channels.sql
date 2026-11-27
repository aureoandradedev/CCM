-- Migration 0075: Notification ladder with explicit channels
--
-- Rewrites check_notification_ladder() to:
--   1. Create separate outbox entries per channel at each step
--   2. Consolidate per-supplier (one ladder, oldest request = anchor)
--   3. Respect business hours (skip if supplier is closed)
--   4. Explicit step→channel mapping:
--        0 min  → app + email
--       10 min  → app
--       20 min  → whatsapp + app + email
--       30 min  → ai_call
--       40 min  → team_task (recipient_type = 'team')
--       T-1     → app (final warning, NOT handoff)
--   5. Idempotency per supplier+step+channel
--
-- Does NOT touch check_supplier_request_timeouts() — handoff stays there.

-- ============================================================================
-- 1. Schema changes
-- ============================================================================

ALTER TABLE public.order_notification_outbox
  ADD COLUMN IF NOT EXISTS channel text;

ALTER TABLE public.order_notification_outbox
  DROP CONSTRAINT IF EXISTS outbox_recipient_type_check;
ALTER TABLE public.order_notification_outbox
  ADD CONSTRAINT outbox_recipient_type_check
  CHECK (recipient_type IN ('customer', 'supplier', 'team'));

ALTER TABLE public.supplier_notification_ladder
  ADD COLUMN IF NOT EXISTS supplier_id text;

-- ============================================================================
-- 2. Helper: check if current time is within supplier business hours
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_within_supplier_business_hours(
  p_supplier_id text
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hours jsonb;
  v_now_br text;
  v_dow_name text;
  v_day_hours jsonb;
  v_open text;
  v_close text;
  v_current_min int;
  v_open_min int;
  v_close_min int;
  v_today_str text;
  v_is_holiday boolean;
BEGIN
  SELECT business_hours INTO v_hours
  FROM supplier_commercial_terms
  WHERE supplier_id = p_supplier_id
  LIMIT 1;

  IF v_hours IS NULL THEN
    v_hours := '{"1":{"open":"07:00","close":"18:00"},"2":{"open":"07:00","close":"18:00"},"3":{"open":"07:00","close":"18:00"},"4":{"open":"07:00","close":"18:00"},"5":{"open":"07:00","close":"18:00"}}'::jsonb;
  END IF;

  v_now_br := (now() AT TIME ZONE 'America/Sao_Paulo')::time::text;
  v_current_min := EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/Sao_Paulo')::time)::int * 60
                  + EXTRACT(MINUTE FROM (now() AT TIME ZONE 'America/Sao_Paulo')::time)::int;

  v_dow_name := EXTRACT(ISODOW FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::text;

  v_day_hours := v_hours -> v_dow_name;
  IF v_day_hours IS NULL OR v_day_hours ->> 'open' IS NULL THEN
    RETURN false;
  END IF;

  v_open := v_day_hours ->> 'open';
  v_close := v_day_hours ->> 'close';
  v_open_min := SPLIT_PART(v_open, ':', 1)::int * 60 + SPLIT_PART(v_open, ':', 2)::int;
  v_close_min := SPLIT_PART(v_close, ':', 1)::int * 60 + SPLIT_PART(v_close, ':', 2)::int;

  IF v_current_min < v_open_min OR v_current_min >= v_close_min THEN
    RETURN false;
  END IF;

  v_today_str := to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD');
  SELECT EXISTS(
    SELECT 1 FROM holiday_calendars
    WHERE holiday_date = v_today_str::date
      AND scope IN ('national', 'state', 'municipal')
  ) INTO v_is_holiday;

  IF v_is_holiday THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

-- ============================================================================
-- 3. Rewrite check_notification_ladder with explicit channels
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_notification_ladder()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_supplier record;
  v_anchor record;
  v_elapsed_min int;
  v_total_timeout int;
  v_step int;
  v_channel text;
  v_channels text[];
  v_step_config int[][] := ARRAY[
    -- step, channel_set_index (see below)
  ];
  v_sent int := 0;
  v_idem_key text;
  v_pending_count int;
  v_pending_codes text[];
  v_order_id uuid;
  v_within_hours boolean;
  v_event_type text;
  v_recipient_type text;
  v_urgency text;
BEGIN
  v_flag := is_ccm_supplier_backup_enabled();
  IF NOT v_flag THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'Feature flag OFF');
  END IF;

  -- Iterate per supplier (consolidation)
  FOR v_supplier IN
    SELECT DISTINCT sr.supplier_id
    FROM supplier_requests sr
    WHERE sr.expires_at IS NOT NULL
      AND sr.status IN ('aguardando_confirmacao', 'confirmado_parcial')
      AND sr.expires_at > now()
  LOOP
    -- Business hours gate
    v_within_hours := is_within_supplier_business_hours(v_supplier.supplier_id);
    IF NOT v_within_hours THEN
      CONTINUE;
    END IF;

    -- Find anchor (oldest pending request for this supplier)
    SELECT sr.id, sr.supplier_id, sr.order_id, sr.sent_at, sr.expires_at, sr.role
    INTO v_anchor
    FROM supplier_requests sr
    WHERE sr.supplier_id = v_supplier.supplier_id
      AND sr.expires_at IS NOT NULL
      AND sr.status IN ('aguardando_confirmacao', 'confirmado_parcial')
      AND sr.expires_at > now()
    ORDER BY sr.sent_at ASC
    LIMIT 1;

    IF v_anchor IS NULL THEN
      CONTINUE;
    END IF;

    -- Count all pending requests for this supplier
    SELECT COUNT(*), array_agg(DISTINCT o.code)
    INTO v_pending_count, v_pending_codes
    FROM supplier_requests sr
    JOIN orders o ON o.id = sr.order_id
    WHERE sr.supplier_id = v_supplier.supplier_id
      AND sr.expires_at IS NOT NULL
      AND sr.status IN ('aguardando_confirmacao', 'confirmado_parcial')
      AND sr.expires_at > now();

    v_elapsed_min := EXTRACT(EPOCH FROM (now() - v_anchor.sent_at))::int / 60;
    v_total_timeout := EXTRACT(EPOCH FROM (v_anchor.expires_at - v_anchor.sent_at))::int / 60;
    v_order_id := v_anchor.order_id;

    -- Step 0 → app + email
    IF v_elapsed_min >= 0 THEN
      FOREACH v_channel IN ARRAY ARRAY['app', 'email']
      LOOP
        v_idem_key := v_supplier.supplier_id || ':ladder:0:' || v_channel;

        INSERT INTO supplier_notification_ladder (
          supplier_request_id, supplier_id, step_minutes, channel, idempotency_key
        ) VALUES (
          v_anchor.id, v_supplier.supplier_id, 0, v_channel, v_idem_key
        ) ON CONFLICT (idempotency_key) DO NOTHING;

        IF FOUND THEN
          INSERT INTO order_notification_outbox (
            order_id, event_type, recipient_type, recipient_id, channel, payload, idempotency_key
          ) VALUES (
            v_order_id,
            'supplier_reminder',
            'supplier',
            v_supplier.supplier_id,
            v_channel,
            jsonb_build_object(
              'anchor_request_id', v_anchor.id,
              'step_minutes', 0,
              'channel', v_channel,
              'total_timeout_minutes', v_total_timeout,
              'elapsed_minutes', v_elapsed_min,
              'pending_count', v_pending_count,
              'pending_codes', to_jsonb(v_pending_codes),
              'urgency', 'low'
            ),
            v_supplier.supplier_id || ':supplier_reminder:0:' || v_channel
          ) ON CONFLICT (idempotency_key) DO NOTHING;

          v_sent := v_sent + 1;
        END IF;
      END LOOP;
    END IF;

    -- Step 10 → app
    IF v_elapsed_min >= 10 THEN
      v_channel := 'app';
      v_idem_key := v_supplier.supplier_id || ':ladder:10:' || v_channel;

      INSERT INTO supplier_notification_ladder (
        supplier_request_id, supplier_id, step_minutes, channel, idempotency_key
      ) VALUES (
        v_anchor.id, v_supplier.supplier_id, 10, v_channel, v_idem_key
      ) ON CONFLICT (idempotency_key) DO NOTHING;

      IF FOUND THEN
        INSERT INTO order_notification_outbox (
          order_id, event_type, recipient_type, recipient_id, channel, payload, idempotency_key
        ) VALUES (
          v_order_id,
          'supplier_reminder',
          'supplier',
          v_supplier.supplier_id,
          v_channel,
          jsonb_build_object(
            'anchor_request_id', v_anchor.id,
            'step_minutes', 10,
            'channel', v_channel,
            'total_timeout_minutes', v_total_timeout,
            'elapsed_minutes', v_elapsed_min,
            'pending_count', v_pending_count,
            'pending_codes', to_jsonb(v_pending_codes),
            'urgency', 'low'
          ),
          v_supplier.supplier_id || ':supplier_reminder:10:' || v_channel
        ) ON CONFLICT (idempotency_key) DO NOTHING;

        v_sent := v_sent + 1;
      END IF;
    END IF;

    -- Step 20 → whatsapp + app + email
    IF v_elapsed_min >= 20 THEN
      FOREACH v_channel IN ARRAY ARRAY['whatsapp', 'app', 'email']
      LOOP
        v_idem_key := v_supplier.supplier_id || ':ladder:20:' || v_channel;

        INSERT INTO supplier_notification_ladder (
          supplier_request_id, supplier_id, step_minutes, channel, idempotency_key
        ) VALUES (
          v_anchor.id, v_supplier.supplier_id, 20, v_channel, v_idem_key
        ) ON CONFLICT (idempotency_key) DO NOTHING;

        IF FOUND THEN
          INSERT INTO order_notification_outbox (
            order_id, event_type, recipient_type, recipient_id, channel, payload, idempotency_key
          ) VALUES (
            v_order_id,
            'supplier_reminder',
            'supplier',
            v_supplier.supplier_id,
            v_channel,
            jsonb_build_object(
              'anchor_request_id', v_anchor.id,
              'step_minutes', 20,
              'channel', v_channel,
              'total_timeout_minutes', v_total_timeout,
              'elapsed_minutes', v_elapsed_min,
              'pending_count', v_pending_count,
              'pending_codes', to_jsonb(v_pending_codes),
              'urgency', 'medium'
            ),
            v_supplier.supplier_id || ':supplier_reminder:20:' || v_channel
          ) ON CONFLICT (idempotency_key) DO NOTHING;

          v_sent := v_sent + 1;
        END IF;
      END LOOP;
    END IF;

    -- Step 30 → ai_call
    IF v_elapsed_min >= 30 THEN
      v_channel := 'ai_call';
      v_idem_key := v_supplier.supplier_id || ':ladder:30:' || v_channel;

      INSERT INTO supplier_notification_ladder (
        supplier_request_id, supplier_id, step_minutes, channel, idempotency_key
      ) VALUES (
        v_anchor.id, v_supplier.supplier_id, 30, v_channel, v_idem_key
      ) ON CONFLICT (idempotency_key) DO NOTHING;

      IF FOUND THEN
        INSERT INTO order_notification_outbox (
          order_id, event_type, recipient_type, recipient_id, channel, payload, idempotency_key
        ) VALUES (
          v_order_id,
          'supplier_ai_call',
          'supplier',
          v_supplier.supplier_id,
          v_channel,
          jsonb_build_object(
            'anchor_request_id', v_anchor.id,
            'step_minutes', 30,
            'channel', v_channel,
            'total_timeout_minutes', v_total_timeout,
            'elapsed_minutes', v_elapsed_min,
            'pending_count', v_pending_count,
            'pending_codes', to_jsonb(v_pending_codes),
            'urgency', 'high'
          ),
          v_supplier.supplier_id || ':supplier_ai_call:30:' || v_channel
        ) ON CONFLICT (idempotency_key) DO NOTHING;

        v_sent := v_sent + 1;
      END IF;
    END IF;

    -- Step 40 → team_task (ligar agora)
    IF v_elapsed_min >= 40 THEN
      v_channel := 'team_task';
      v_idem_key := v_supplier.supplier_id || ':ladder:40:' || v_channel;

      INSERT INTO supplier_notification_ladder (
        supplier_request_id, supplier_id, step_minutes, channel, idempotency_key
      ) VALUES (
        v_anchor.id, v_supplier.supplier_id, 40, v_channel, v_idem_key
      ) ON CONFLICT (idempotency_key) DO NOTHING;

      IF FOUND THEN
        INSERT INTO order_notification_outbox (
          order_id, event_type, recipient_type, recipient_id, channel, payload, idempotency_key
        ) VALUES (
          v_order_id,
          'ligar_agora',
          'team',
          NULL,
          v_channel,
          jsonb_build_object(
            'anchor_request_id', v_anchor.id,
            'supplier_id', v_supplier.supplier_id,
            'step_minutes', 40,
            'channel', v_channel,
            'total_timeout_minutes', v_total_timeout,
            'elapsed_minutes', v_elapsed_min,
            'pending_count', v_pending_count,
            'pending_codes', to_jsonb(v_pending_codes),
            'urgency', 'critical',
            'action', 'Ligar para o fornecedor agora'
          ),
          v_supplier.supplier_id || ':ligar_agora:40:' || v_channel
        ) ON CONFLICT (idempotency_key) DO NOTHING;

        v_sent := v_sent + 1;
      END IF;
    END IF;

    -- Step T-1 → app (final warning, NOT handoff)
    IF v_elapsed_min >= (v_total_timeout - 1) THEN
      v_channel := 'app';
      v_idem_key := v_supplier.supplier_id || ':ladder:T:' || v_channel;

      INSERT INTO supplier_notification_ladder (
        supplier_request_id, supplier_id, step_minutes, channel, idempotency_key
      ) VALUES (
        v_anchor.id, v_supplier.supplier_id, v_total_timeout, v_channel, v_idem_key
      ) ON CONFLICT (idempotency_key) DO NOTHING;

      IF FOUND THEN
        INSERT INTO order_notification_outbox (
          order_id, event_type, recipient_type, recipient_id, channel, payload, idempotency_key
        ) VALUES (
          v_order_id,
          'supplier_final_warning',
          'supplier',
          v_supplier.supplier_id,
          v_channel,
          jsonb_build_object(
            'anchor_request_id', v_anchor.id,
            'step_minutes', v_total_timeout,
            'channel', v_channel,
            'total_timeout_minutes', v_total_timeout,
            'pending_count', v_pending_count,
            'pending_codes', to_jsonb(v_pending_codes),
            'urgency', 'final'
          ),
          v_supplier.supplier_id || ':supplier_final_warning:T:' || v_channel
        ) ON CONFLICT (idempotency_key) DO NOTHING;

        v_sent := v_sent + 1;
      END IF;
    END IF;

  END LOOP;

  RETURN jsonb_build_object('ok', true, 'notifications_sent', v_sent);
END;
$$;

REVOKE ALL ON FUNCTION public.check_notification_ladder() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_notification_ladder() FROM anon;
REVOKE ALL ON FUNCTION public.check_notification_ladder() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_notification_ladder() TO service_role;

REVOKE ALL ON FUNCTION public.is_within_supplier_business_hours(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_within_supplier_business_hours(text) FROM anon;
REVOKE ALL ON FUNCTION public.is_within_supplier_business_hours(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_within_supplier_business_hours(text) TO service_role;
