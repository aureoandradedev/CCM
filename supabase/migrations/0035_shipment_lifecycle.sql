-- 0035_shipment_lifecycle.sql
-- Bloco 3: Tracking / Status / Eventos por Shipment
-- Extends order_shipments with new statuses, adds shipment_occurrences, indexes events.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Extend order_shipments status CHECK to include new states
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.order_shipments drop constraint if exists order_shipments_status_check;

alter table public.order_shipments add constraint order_shipments_status_check
  check (status in (
    'aguardando_disponibilidade',
    'preparando',
    'pronto_para_envio',
    'pronto_para_retirada',
    'enviado',
    'entregue',
    'cancelado'
  ));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. shipment_occurrences — registro de ocorrências em trânsito
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.shipment_occurrences (
  id            uuid primary key default gen_random_uuid(),
  shipment_id   uuid not null references public.order_shipments(id) on delete cascade,
  type          text not null
                check (type in ('attempt', 'delay', 'damage', 'return', 'note')),
  description   text not null,
  occurred_at   timestamptz not null default now(),
  logged_by     uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);

create index if not exists shipment_occurrences_shipment_idx
  on public.shipment_occurrences(shipment_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. RLS — admin-only para occurrences
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.shipment_occurrences enable row level security;

create policy "shipment_occurrences: service_role full"
  on public.shipment_occurrences for all
  to service_role using (true) with check (true);

create policy "shipment_occurrences: admin full"
  on public.shipment_occurrences for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Index on order_events.shipment_id (column already exists from 0032)
-- ═══════════════════════════════════════════════════════════════════════════

create index if not exists order_events_shipment_idx
  on public.order_events(shipment_id)
  where shipment_id is not null;
