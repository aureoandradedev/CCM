-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0042: Recebedor operational access (column-safe)
--
-- Problem: migration 0041 gave recebedor full SELECT on supplier_purchase_orders
-- which exposes subtotal_centavos, freight_centavos, total_centavos and other
-- commercial columns. RLS controls rows, not columns.
--
-- Solution:
-- 1. Drop recebedor's direct SELECT on supplier_purchase_orders (from 0041)
-- 2. Do NOT grant direct SELECT on purchase_order_items (has unit_cost_centavos)
-- 3. Create SECURITY DEFINER RPCs that return only physical/operational columns
-- 4. Grant storage bucket access for receiving photos
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Remove unsafe direct SELECT policy from 0041
-- ═══════════════════════════════════════════════════════════════════════════════

drop policy if exists "recebedor reads purchase orders"
  on public.supplier_purchase_orders;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. RPC: pending POs for recebedor (no commercial columns)
-- Returns only: id, supplier_id, supplier_name, cycle_date, status, item_count
-- Excludes: subtotal_centavos, freight_centavos, total_centavos,
--           minimum_type, minimum_value, minimum_met, decision
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.recebedor_pending_pos()
returns table (
  id uuid,
  supplier_id text,
  supplier_name text,
  cycle_date date,
  status text,
  item_count int
)
language sql stable security definer set search_path = public
as $$
  select
    po.id,
    po.supplier_id,
    s.name as supplier_name,
    po.cycle_date,
    po.status,
    po.item_count
  from supplier_purchase_orders po
  left join suppliers s on s.id = po.supplier_id
  where po.status in ('sent', 'ready')
    and has_role(array['recebedor'])
  order by po.cycle_date desc;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. RPC: PO detail for recebedor (single PO, no commercial columns)
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.recebedor_po_detail(p_po_id uuid)
returns table (
  id uuid,
  supplier_id text,
  supplier_name text,
  cycle_date date,
  status text,
  item_count int
)
language sql stable security definer set search_path = public
as $$
  select
    po.id,
    po.supplier_id,
    s.name as supplier_name,
    po.cycle_date,
    po.status,
    po.item_count
  from supplier_purchase_orders po
  left join suppliers s on s.id = po.supplier_id
  where po.id = p_po_id
    and has_role(array['recebedor']);
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. RPC: PO items for recebedor (physical data only, no costs)
-- Returns only: id, master_product_id, product_name, quantity_units,
--               pack_count, unidade_compra, qtd_por_embalagem
-- Excludes: unit_cost_centavos, pack_cost_centavos, subtotal_centavos, leftover_units
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.recebedor_po_items(p_po_id uuid)
returns table (
  id uuid,
  master_product_id uuid,
  product_name text,
  quantity_units int,
  pack_count int,
  unidade_compra text,
  qtd_por_embalagem int
)
language sql stable security definer set search_path = public
as $$
  select
    poi.id,
    poi.master_product_id,
    poi.product_name,
    poi.quantity_units,
    poi.pack_count,
    poi.unidade_compra,
    poi.qtd_por_embalagem
  from purchase_order_items poi
  where poi.purchase_order_id = p_po_id
    and has_role(array['recebedor'])
  order by poi.product_name;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. Storage bucket "recebimento" — upload + read scoped to inspector's sessions
--    Path convention: {session_id}/{item_id}/{uuid}.{ext}
--    split_part(name, '/', 1) extracts the session UUID.
--    Admin bypasses the session check (can view all photos).
-- ═══════════════════════════════════════════════════════════════════════════════

-- Admin already has full access via 0034's policies (is_admin()).
-- Recebedor policies below are session-scoped: upload only to own in_progress
-- sessions, read only own sessions (any status).

create policy "recebimento: recebedor upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'recebimento'
    and public.has_role(ARRAY['recebedor'])
    and exists (
      select 1 from public.receiving_sessions rs
      where rs.id::text = split_part(name, '/', 1)
        and rs.inspector_id = auth.uid()
        and rs.status = 'in_progress'
    )
  );

create policy "recebimento: recebedor read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'recebimento'
    and public.has_role(ARRAY['recebedor'])
    and exists (
      select 1 from public.receiving_sessions rs
      where rs.id::text = split_part(name, '/', 1)
        and rs.inspector_id = auth.uid()
    )
  );
