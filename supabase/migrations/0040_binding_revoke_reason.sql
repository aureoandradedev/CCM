-- 0040: binding revoke reason + ignorado status + undo approval RPC

-- 1. Add revoked_reason column for audit trail on binding revocations
ALTER TABLE matching_bindings ADD COLUMN IF NOT EXISTS revoked_reason text;

COMMENT ON COLUMN matching_bindings.revoked_reason IS 'Admin-provided reason for revoking this binding';

-- 2. Recreate revoke_matching_binding to accept optional reason parameter
DROP FUNCTION IF EXISTS revoke_matching_binding(uuid);

CREATE OR REPLACE FUNCTION revoke_matching_binding(p_binding_id uuid, p_reason text DEFAULT NULL)
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
  SET revoked_at = now(), revoked_by = auth.uid(), revoked_reason = p_reason
  WHERE id = p_binding_id AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Vínculo não encontrado ou já revogado');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION revoke_matching_binding FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION revoke_matching_binding TO authenticated;

-- 3. Add 'ignorado' to match_status CHECK constraint
ALTER TABLE supplier_catalog_items DROP CONSTRAINT IF EXISTS supplier_catalog_items_match_status_check;
ALTER TABLE supplier_catalog_items ADD CONSTRAINT supplier_catalog_items_match_status_check
  CHECK (match_status IN (
    'pendente','normalizado','match_sugerido',
    'revisao_manual','aprovado','rejeitado','ignorado'
  ));

-- 4. RPC to undo an approved item (revoke bindings + reset status)
CREATE OR REPLACE FUNCTION undo_item_approval(
  p_item_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_revoked_count int := 0;
BEGIN
  IF NOT is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado');
  END IF;

  SELECT id, supplier_id, supplier_sku, ean, master_product_id, match_status
  INTO v_item
  FROM supplier_catalog_items
  WHERE id = p_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado');
  END IF;

  IF v_item.match_status != 'aprovado' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não está aprovado');
  END IF;

  -- Revoke all active bindings pointing to this item's master from this supplier
  UPDATE matching_bindings
  SET revoked_at = now(),
      revoked_by = auth.uid(),
      revoked_reason = COALESCE(p_reason, 'Desfazer aprovação do item ' || p_item_id::text)
  WHERE master_product_id = v_item.master_product_id
    AND revoked_at IS NULL
    AND (
      (binding_type = 'supplier_sku' AND supplier_id = v_item.supplier_id AND supplier_sku = v_item.supplier_sku)
      OR (binding_type = 'ean' AND ean_clean = regexp_replace(COALESCE(v_item.ean, ''), '[\s\-./]', '', 'g'))
      OR (binding_type = 'normalized_name' AND supplier_id = v_item.supplier_id)
    );

  GET DIAGNOSTICS v_revoked_count = ROW_COUNT;

  -- Reset item to revisao_manual so it returns to Pendências
  UPDATE supplier_catalog_items
  SET match_status = 'revisao_manual',
      master_product_id = NULL,
      match_confidence = NULL,
      match_signals = NULL
  WHERE id = p_item_id;

  RETURN jsonb_build_object(
    'ok', true,
    'revoked_bindings', v_revoked_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION undo_item_approval FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION undo_item_approval TO authenticated;

-- 5. RPC to restore an ignored item back to revisão
CREATE OR REPLACE FUNCTION restore_ignored_item(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado');
  END IF;

  UPDATE supplier_catalog_items
  SET match_status = 'revisao_manual'
  WHERE id = p_item_id
    AND match_status = 'ignorado';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado ou não está ignorado');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION restore_ignored_item FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION restore_ignored_item TO authenticated;
