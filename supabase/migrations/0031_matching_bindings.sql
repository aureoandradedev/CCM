-- matching_bindings: persistent, auditable matching decisions
-- Each row links an identifier (supplier_sku, ean, or normalized_name)
-- to a master_product, with full audit trail and soft-delete via revoked_at.

CREATE TABLE IF NOT EXISTS matching_bindings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_type    text NOT NULL,
  master_product_id uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  supplier_id     text,
  supplier_sku    text,
  ean_clean       text,
  normalized_name text,
  confidence      numeric,
  origin          text NOT NULL,
  origin_item_id  uuid,
  created_by      uuid NOT NULL DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  revoked_by      uuid,
  metadata        jsonb,

  CONSTRAINT valid_binding_type CHECK (
    binding_type IN ('supplier_sku', 'ean', 'normalized_name')
  ),
  CONSTRAINT valid_origin CHECK (
    origin IN ('admin_approve', 'admin_create', 'admin_associate', 'auto_ean', 'auto_reuse')
  ),
  CONSTRAINT binding_key_present CHECK (
    CASE binding_type
      WHEN 'supplier_sku'    THEN supplier_id IS NOT NULL AND supplier_sku IS NOT NULL
      WHEN 'ean'             THEN ean_clean IS NOT NULL
      WHEN 'normalized_name' THEN normalized_name IS NOT NULL
      ELSE false
    END
  )
);

COMMENT ON TABLE matching_bindings IS 'Persistent, auditable matching decisions between identifiers and master products';
COMMENT ON COLUMN matching_bindings.binding_type IS 'Type: supplier_sku | ean | normalized_name';
COMMENT ON COLUMN matching_bindings.revoked_at IS 'Soft-delete — binding inactive when set';
COMMENT ON COLUMN matching_bindings.origin IS 'How the binding was created';

-- ── Active-binding uniqueness (one active binding per type+key+master) ───────

CREATE UNIQUE INDEX IF NOT EXISTS idx_mb_sku_active
  ON matching_bindings (supplier_id, supplier_sku, master_product_id)
  WHERE binding_type = 'supplier_sku' AND revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mb_ean_active
  ON matching_bindings (ean_clean, master_product_id)
  WHERE binding_type = 'ean' AND revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mb_name_active
  ON matching_bindings (supplier_id, normalized_name, master_product_id)
  WHERE binding_type = 'normalized_name' AND revoked_at IS NULL;

-- ── Pipeline lookup indices ─────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_mb_lookup_sku
  ON matching_bindings (supplier_id, supplier_sku)
  WHERE binding_type = 'supplier_sku' AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mb_lookup_ean
  ON matching_bindings (ean_clean)
  WHERE binding_type = 'ean' AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mb_lookup_name
  ON matching_bindings (normalized_name)
  WHERE binding_type = 'normalized_name' AND revoked_at IS NULL;

-- ── Composite index on supplier_catalog_items for legacy fallback ───────────

CREATE INDEX IF NOT EXISTS idx_sci_supplier_sku
  ON supplier_catalog_items (supplier_id, supplier_sku)
  WHERE supplier_sku IS NOT NULL;

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE matching_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_full_access" ON matching_bindings
  FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── RPC: batch-insert bindings (idempotent, skips duplicates) ───────────────

CREATE OR REPLACE FUNCTION record_matching_bindings(p_bindings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b       jsonb;
  created int := 0;
BEGIN
  IF NOT is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado');
  END IF;

  FOR b IN SELECT * FROM jsonb_array_elements(p_bindings)
  LOOP
    BEGIN
      INSERT INTO matching_bindings (
        binding_type, master_product_id, supplier_id, supplier_sku,
        ean_clean, normalized_name, confidence, origin, origin_item_id,
        created_by, metadata
      ) VALUES (
        b->>'binding_type',
        (b->>'master_product_id')::uuid,
        b->>'supplier_id',
        b->>'supplier_sku',
        b->>'ean_clean',
        b->>'normalized_name',
        (b->>'confidence')::numeric,
        b->>'origin',
        CASE WHEN b->>'origin_item_id' IS NOT NULL
             THEN (b->>'origin_item_id')::uuid ELSE NULL END,
        auth.uid(),
        b->'metadata'
      );
      created := created + 1;
    EXCEPTION WHEN unique_violation THEN
      NULL; -- idempotent: skip duplicates
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'created', created);
END;
$$;

REVOKE EXECUTE ON FUNCTION record_matching_bindings FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_matching_bindings TO authenticated;

-- ── RPC: revoke a binding (soft-delete) ─────────────────────────────────────

CREATE OR REPLACE FUNCTION revoke_matching_binding(p_binding_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado');
  END IF;

  UPDATE matching_bindings
  SET revoked_at = now(), revoked_by = auth.uid()
  WHERE id = p_binding_id AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Binding não encontrado ou já revogado');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION revoke_matching_binding FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION revoke_matching_binding TO authenticated;
