-- Migration 0078: Repair approve_result_override
--
-- Bug: approve_result_override in 0077 sets `decision` but NOT `status`.
-- The result_protection_status on the order stays unchanged.
-- Payment gate checks result_protection_status = 'pending' → still blocked.
-- Fix: set status = 'approved', update order result_protection_status,
--       and use resolve_result_lock's pattern for consistency.

CREATE OR REPLACE FUNCTION public.approve_result_override(
  p_order_id uuid,
  p_admin_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock result_locks%ROWTYPE;
BEGIN
  SELECT * INTO v_lock FROM result_locks
  WHERE order_id = p_order_id AND status = 'pending'
  ORDER BY created_at DESC LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_pending_result_lock');
  END IF;

  UPDATE result_locks
  SET status = 'approved',
      decision = 'approve',
      decided_by = p_admin_id,
      decided_at = now(),
      decision_notes = 'Admin override'
  WHERE id = v_lock.id;

  UPDATE orders
  SET result_protection_status = 'approved',
      result_locked_at = now(),
      result_lock_id = v_lock.id,
      needs_team_intervention = false
  WHERE id = p_order_id;

  INSERT INTO order_events (order_id, type, data, actor_kind, actor_id)
  VALUES (p_order_id, 'result_override_approved',
    jsonb_build_object(
      'lock_id', v_lock.id,
      'projected_result_centavos', v_lock.projected_result_centavos,
      'min_result_centavos', v_lock.min_result_centavos
    ),
    'admin', p_admin_id);

  RETURN jsonb_build_object('ok', true, 'lock_id', v_lock.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_result_override(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_result_override(uuid, uuid) TO service_role;
