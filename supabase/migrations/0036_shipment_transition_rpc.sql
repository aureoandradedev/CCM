-- 0036_shipment_transition_rpc.sql
-- Transactional RPCs for shipment lifecycle (atomicity fix from Bloco 3 audit).
-- Each RPC wraps status/tracking/occurrence update + event insert in one transaction.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. transition_shipment_status — atomic status + timestamp + event
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.transition_shipment_status(
  p_shipment_id uuid,
  p_new_status  text,
  p_expected    text,
  p_actor_kind  text default 'admin',
  p_actor_id    uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ship   record;
  v_ts     timestamptz := now();
  v_upd    int;
begin
  select id, order_id, status, shipped_at, delivered_at
    into v_ship
    from order_shipments
   where id = p_shipment_id
     for update;

  if v_ship is null then
    return jsonb_build_object('error', 'Shipment não encontrado.');
  end if;

  if v_ship.status <> p_expected then
    return jsonb_build_object(
      'error', format('Conflito: status atual é ''%s'', esperado ''%s''.', v_ship.status, p_expected),
      'current_status', v_ship.status
    );
  end if;

  -- Validate transition
  if not (
    (v_ship.status = 'aguardando_disponibilidade' and p_new_status in ('preparando','cancelado'))
    or (v_ship.status = 'preparando' and p_new_status in ('pronto_para_envio','pronto_para_retirada','cancelado'))
    or (v_ship.status = 'pronto_para_envio' and p_new_status in ('enviado','cancelado'))
    or (v_ship.status = 'pronto_para_retirada' and p_new_status in ('entregue','cancelado'))
    or (v_ship.status = 'enviado' and p_new_status = 'entregue')
  ) then
    return jsonb_build_object(
      'error', format('Transição ''%s'' → ''%s'' não permitida.', v_ship.status, p_new_status)
    );
  end if;

  -- Update status + timestamps
  update order_shipments set
    status       = p_new_status,
    shipped_at   = case when p_new_status = 'enviado'  and shipped_at   is null then v_ts else shipped_at   end,
    delivered_at = case when p_new_status = 'entregue' and delivered_at is null then v_ts else delivered_at end,
    updated_at   = v_ts
  where id = p_shipment_id and status = p_expected;

  get diagnostics v_upd = row_count;
  if v_upd = 0 then
    return jsonb_build_object('error', 'Race condition: status alterado por outro processo.');
  end if;

  -- Insert event
  insert into order_events (order_id, type, data, actor_kind, actor_id, shipment_id)
  values (
    v_ship.order_id,
    'shipment_status_changed',
    jsonb_build_object('shipment_id', p_shipment_id, 'from', v_ship.status, 'to', p_new_status),
    p_actor_kind,
    p_actor_id,
    p_shipment_id
  );

  return jsonb_build_object(
    'ok', true,
    'status', p_new_status,
    'shipped_at', case when p_new_status = 'enviado' and v_ship.shipped_at is null then v_ts else v_ship.shipped_at end,
    'delivered_at', case when p_new_status = 'entregue' and v_ship.delivered_at is null then v_ts else v_ship.delivered_at end
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. set_shipment_tracking — atomic tracking + event
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.set_shipment_tracking(
  p_shipment_id   uuid,
  p_tracking_code text default null,
  p_carrier       text default null,
  p_actor_kind    text default 'admin',
  p_actor_id      uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ship record;
begin
  select id, order_id, tracking_code, carrier
    into v_ship
    from order_shipments
   where id = p_shipment_id;

  if v_ship is null then
    return jsonb_build_object('error', 'Shipment não encontrado.');
  end if;

  update order_shipments set
    tracking_code = coalesce(nullif(trim(p_tracking_code), ''), null),
    carrier       = coalesce(nullif(trim(p_carrier), ''), null),
    updated_at    = now()
  where id = p_shipment_id;

  insert into order_events (order_id, type, data, actor_kind, actor_id, shipment_id)
  values (
    v_ship.order_id,
    'shipment_tracking_set',
    jsonb_build_object(
      'shipment_id', p_shipment_id,
      'tracking_code', coalesce(nullif(trim(p_tracking_code), ''), null),
      'carrier', coalesce(nullif(trim(p_carrier), ''), null),
      'previous_tracking', v_ship.tracking_code,
      'previous_carrier', v_ship.carrier
    ),
    p_actor_kind,
    p_actor_id,
    p_shipment_id
  );

  return jsonb_build_object('ok', true);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. log_shipment_occurrence — atomic occurrence + event
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.log_shipment_occurrence(
  p_shipment_id uuid,
  p_type        text,
  p_description text,
  p_actor_kind  text default 'admin',
  p_actor_id    uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ship record;
  v_occ_id uuid;
begin
  if p_type not in ('attempt','delay','damage','return','note') then
    return jsonb_build_object('error', format('Tipo inválido: %s', p_type));
  end if;
  if coalesce(trim(p_description), '') = '' then
    return jsonb_build_object('error', 'Descrição obrigatória.');
  end if;

  select id, order_id into v_ship
    from order_shipments
   where id = p_shipment_id;

  if v_ship is null then
    return jsonb_build_object('error', 'Shipment não encontrado.');
  end if;

  insert into shipment_occurrences (shipment_id, type, description, logged_by)
  values (p_shipment_id, p_type, trim(p_description), p_actor_id)
  returning id into v_occ_id;

  insert into order_events (order_id, type, data, actor_kind, actor_id, shipment_id)
  values (
    v_ship.order_id,
    'shipment_occurrence',
    jsonb_build_object('shipment_id', p_shipment_id, 'occurrence_id', v_occ_id, 'type', p_type, 'description', trim(p_description)),
    p_actor_kind,
    p_actor_id,
    p_shipment_id
  );

  return jsonb_build_object('ok', true, 'occurrence_id', v_occ_id);
end;
$$;
