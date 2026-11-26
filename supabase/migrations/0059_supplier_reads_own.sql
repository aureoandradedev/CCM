-- Allow a supplier user (role=customer with supplier_id) to read their own row
-- from the suppliers table. Without this, getSupplierSession() returns null
-- because migration 0026 dropped "public read suppliers" and no replacement
-- policy was added for supplier users.
--
-- Pattern matches owns_supplier() used in other tables.

DROP POLICY IF EXISTS "supplier reads own row" ON public.suppliers;

CREATE POLICY "supplier reads own row"
  ON public.suppliers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.supplier_id = suppliers.id
        AND profiles.is_active = true
    )
  );
