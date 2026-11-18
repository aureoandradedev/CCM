-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0041: Operational Roles Foundation
-- Extends binary admin/customer model with operational roles.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Extend profiles.role CHECK constraint
-- Original (0001): inline CHECK (role in ('customer','admin'))
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

-- The original CHECK was inline (unnamed). Postgres auto-names it
-- "{table}_{column}_check" for inline constraints.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS "profiles_role_check1";

-- Drop any auto-generated inline constraint name
DO $$ BEGIN
  EXECUTE (
    SELECT 'ALTER TABLE public.profiles DROP CONSTRAINT ' || quote_ident(con.conname)
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attnum = ANY(con.conkey)
      AND att.attrelid = con.conrelid
    WHERE con.conrelid = 'public.profiles'::regclass
      AND att.attname = 'role'
      AND con.contype = 'c'
    LIMIT 1
  );
EXCEPTION WHEN undefined_object THEN NULL;
          WHEN others THEN NULL;
END $$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('customer','admin','compras','recebedor','operacao','entregador'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. is_active column on profiles
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Extend "own profile update" policy to prevent self-change of is_active
-- The existing policy already prevents self-change of role.
-- We need to also prevent self-change of is_active.
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "own profile update" ON public.profiles;
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE
  USING (auth.uid() = id OR public.is_admin())
  WITH CHECK (
    (
      auth.uid() = id
      AND role = (SELECT role FROM public.profiles p WHERE p.id = auth.uid())
      AND is_active = (SELECT is_active FROM public.profiles p WHERE p.id = auth.uid())
    )
    OR public.is_admin()
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. has_role(text[]) — operational role check including active status
-- Admin always passes. Operational roles require is_active = true.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.has_role(allowed_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT
        CASE
          WHEN role = 'admin' THEN true
          WHEN role = ANY(allowed_roles) AND is_active THEN true
          ELSE false
        END
      FROM public.profiles
      WHERE id = auth.uid()
    ),
    false
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. is_active_operational() — for guards that check operational access
-- Returns true if the user is admin OR (has an operational role AND is active).
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_active_operational()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT
        CASE
          WHEN role = 'admin' THEN true
          WHEN role IN ('compras','recebedor','operacao','entregador') AND is_active THEN true
          ELSE false
        END
      FROM public.profiles
      WHERE id = auth.uid()
    ),
    false
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. assigned_to on order_shipments (entregador resource-level security)
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.order_shipments
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS order_shipments_assigned_to_idx
  ON public.order_shipments(assigned_to)
  WHERE assigned_to IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. RLS: entregador sees only assigned shipments
-- Add a new policy for entregador alongside existing ones.
-- Existing: service_role full + authenticated read own orders.
-- New: entregador can read/update shipments assigned to them.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "Shipments: entregador reads assigned"
  ON public.order_shipments FOR SELECT
  TO authenticated
  USING (
    assigned_to = auth.uid()
    AND public.has_role(ARRAY['entregador'])
  );

CREATE POLICY "Shipments: entregador updates assigned"
  ON public.order_shipments FOR UPDATE
  TO authenticated
  USING (
    assigned_to = auth.uid()
    AND public.has_role(ARRAY['entregador'])
  )
  WITH CHECK (
    assigned_to = auth.uid()
    AND public.has_role(ARRAY['entregador'])
  );

-- Operational roles (admin, operacao) can read all shipments
CREATE POLICY "Shipments: operational reads all"
  ON public.order_shipments FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['admin','operacao']));

-- Admin + operacao can update any shipment
CREATE POLICY "Shipments: operational updates all"
  ON public.order_shipments FOR UPDATE
  TO authenticated
  USING (public.has_role(ARRAY['admin','operacao']))
  WITH CHECK (public.has_role(ARRAY['admin','operacao']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. RLS: entregador sees occurrence for assigned shipments only
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "Occurrences: entregador reads own"
  ON public.shipment_occurrences FOR SELECT
  TO authenticated
  USING (
    shipment_id IN (
      SELECT id FROM public.order_shipments WHERE assigned_to = auth.uid()
    )
    AND public.has_role(ARRAY['entregador'])
  );

CREATE POLICY "Occurrences: entregador inserts own"
  ON public.shipment_occurrences FOR INSERT
  TO authenticated
  WITH CHECK (
    shipment_id IN (
      SELECT id FROM public.order_shipments WHERE assigned_to = auth.uid()
    )
    AND public.has_role(ARRAY['entregador'])
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- 9. RLS: compras role gets read access to procurement tables
-- These tables currently have admin-only policies. Add compras read.
-- ═══════════════════════════════════════════════════════════════════════════════

-- supplier_catalog_items: compras can read + update (match actions)
CREATE POLICY "compras reads catalog items"
  ON public.supplier_catalog_items FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

CREATE POLICY "compras updates catalog items"
  ON public.supplier_catalog_items FOR UPDATE
  TO authenticated
  USING (public.has_role(ARRAY['compras']))
  WITH CHECK (public.has_role(ARRAY['compras']));

-- suppliers: compras can read
CREATE POLICY "compras reads suppliers"
  ON public.suppliers FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

-- supplier_purchase_orders: compras can read + update
CREATE POLICY "compras reads purchase orders"
  ON public.supplier_purchase_orders FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

CREATE POLICY "compras updates purchase orders"
  ON public.supplier_purchase_orders FOR UPDATE
  TO authenticated
  USING (public.has_role(ARRAY['compras']))
  WITH CHECK (public.has_role(ARRAY['compras']));

-- supplier_commercial_terms: compras can read
CREATE POLICY "compras reads commercial terms"
  ON public.supplier_commercial_terms FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

-- matching_bindings: compras can read
CREATE POLICY "compras reads matching bindings"
  ON public.matching_bindings FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 10. RLS: recebedor role gets access to receiving tables
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "recebedor reads receiving sessions"
  ON public.receiving_sessions FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['recebedor']));

CREATE POLICY "recebedor inserts receiving sessions"
  ON public.receiving_sessions FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(ARRAY['recebedor']));

CREATE POLICY "recebedor updates receiving sessions"
  ON public.receiving_sessions FOR UPDATE
  TO authenticated
  USING (public.has_role(ARRAY['recebedor']))
  WITH CHECK (public.has_role(ARRAY['recebedor']));

CREATE POLICY "recebedor reads receiving items"
  ON public.receiving_items FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['recebedor']));

CREATE POLICY "recebedor inserts receiving items"
  ON public.receiving_items FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(ARRAY['recebedor']));

CREATE POLICY "recebedor updates receiving items"
  ON public.receiving_items FOR UPDATE
  TO authenticated
  USING (public.has_role(ARRAY['recebedor']))
  WITH CHECK (public.has_role(ARRAY['recebedor']));

-- recebedor reads POs (to see what to receive) and suppliers (name display)
CREATE POLICY "recebedor reads purchase orders"
  ON public.supplier_purchase_orders FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['recebedor']));

CREATE POLICY "recebedor reads suppliers"
  ON public.suppliers FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['recebedor']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 11. RLS: operacao role gets access to shipment + order tables
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "operacao reads orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['operacao']));

CREATE POLICY "operacao reads order items"
  ON public.order_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND public.has_role(ARRAY['operacao']))
  );

CREATE POLICY "operacao reads occurrences"
  ON public.shipment_occurrences FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['operacao']));

CREATE POLICY "operacao inserts occurrences"
  ON public.shipment_occurrences FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(ARRAY['operacao']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 12. assign_shipment_driver RPC — admin only, validates target is active driver
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.assign_shipment_driver(
  p_shipment_id uuid,
  p_driver_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_driver record;
  v_shipment record;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem atribuir entregadores.';
  END IF;

  SELECT id, role, is_active INTO v_driver
  FROM public.profiles WHERE id = p_driver_id;

  IF v_driver IS NULL THEN
    RAISE EXCEPTION 'Colaborador não encontrado.';
  END IF;

  IF v_driver.role <> 'entregador' THEN
    RAISE EXCEPTION 'Colaborador não possui perfil de entregador (role atual: %).', v_driver.role;
  END IF;

  IF NOT v_driver.is_active THEN
    RAISE EXCEPTION 'Entregador está inativo.';
  END IF;

  SELECT id INTO v_shipment
  FROM public.order_shipments WHERE id = p_shipment_id;

  IF v_shipment IS NULL THEN
    RAISE EXCEPTION 'Shipment não encontrado.';
  END IF;

  UPDATE public.order_shipments
  SET assigned_to = p_driver_id
  WHERE id = p_shipment_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 13. Admin manages collaborators: RPC to set role + is_active
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_set_collaborator(
  p_profile_id uuid,
  p_role text,
  p_is_active boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem gerenciar colaboradores.';
  END IF;

  IF p_role NOT IN ('admin','compras','recebedor','operacao','entregador') THEN
    RAISE EXCEPTION 'Role inválida: %. Valores permitidos: admin, compras, recebedor, operacao, entregador.', p_role;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id) THEN
    RAISE EXCEPTION 'Perfil não encontrado.';
  END IF;

  UPDATE public.profiles
  SET role = p_role, is_active = p_is_active
  WHERE id = p_profile_id;
END;
$$;
