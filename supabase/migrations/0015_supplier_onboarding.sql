-- 0015_supplier_onboarding.sql
-- Self-onboarding: tabela de solicitações de acesso, constraint CNPJ,
-- colunas extras em suppliers, trigger de proteção do supplier_id,
-- RPCs atômicas para registro e aprovação.

-- ─── 1. Novas colunas em suppliers ──────────────────────────────────
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS trade_name text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);

-- ─── 2. UNIQUE index no CNPJ + CHECK de formato ────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_cnpj_unique
  ON public.suppliers (cnpj)
  WHERE cnpj IS NOT NULL AND cnpj <> '';

ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_cnpj_format
  CHECK (cnpj IS NULL OR cnpj ~ '^\d{14}$') NOT VALID;

-- ─── 3. Tabela supplier_access_requests ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.supplier_access_requests (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id text        NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  profile_id  uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status      text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'approved', 'rejected')),
  note        text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid        REFERENCES auth.users(id),
  reviewed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_access_requests_pending_unique
  ON public.supplier_access_requests (profile_id, supplier_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS supplier_access_requests_supplier_idx
  ON public.supplier_access_requests (supplier_id);

CREATE INDEX IF NOT EXISTS supplier_access_requests_status_idx
  ON public.supplier_access_requests (status, requested_at DESC);

-- ─── 4. RLS em supplier_access_requests ─────────────────────────────
ALTER TABLE public.supplier_access_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own requests read"
  ON public.supplier_access_requests FOR SELECT
  USING (auth.uid() = profile_id OR public.is_admin());

CREATE POLICY "own requests insert"
  ON public.supplier_access_requests FOR INSERT
  WITH CHECK (auth.uid() = profile_id AND status = 'pending');

CREATE POLICY "admin update requests"
  ON public.supplier_access_requests FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─── 5. Trigger: bloqueia QUALQUER alteração de supplier_id por não-admin ──
-- Inclui NULL → valor. RPCs usam set_config para bypass transacional.
CREATE OR REPLACE FUNCTION public.guard_supplier_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.supplier_id IS DISTINCT FROM NEW.supplier_id THEN
    IF NOT public.is_admin()
       AND current_setting('app.bypass_supplier_guard', true) IS DISTINCT FROM 'true'
    THEN
      RAISE EXCEPTION 'Não é permitido alterar o vínculo com fornecedor. Contate o administrador.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_supplier_id_trigger ON public.profiles;
CREATE TRIGGER guard_supplier_id_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_supplier_id();

-- ─── 6. RPC: register_supplier_and_link (atômica, SECURITY DEFINER) ─
CREATE OR REPLACE FUNCTION public.register_supplier_and_link(
  p_cnpj          text,
  p_name          text,
  p_trade_name    text,
  p_contact_phone text,
  p_contact_email text,
  p_city          text,
  p_state         text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_existing_sid text;
  v_supplier_id text;
  v_cnpj text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado.');
  END IF;

  SELECT supplier_id INTO v_existing_sid
    FROM public.profiles WHERE id = v_user_id;
  IF v_existing_sid IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Conta já vinculada a um fornecedor.');
  END IF;

  v_cnpj := regexp_replace(p_cnpj, '[^0-9]', '', 'g');
  IF length(v_cnpj) <> 14 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CNPJ inválido.');
  END IF;

  v_supplier_id := 'sup-' || to_hex(extract(epoch from clock_timestamp())::bigint)
                   || '-' || substr(gen_random_uuid()::text, 1, 4);

  BEGIN
    INSERT INTO public.suppliers (
      id, name, trade_name, cnpj, city, state,
      contact_email, contact_phone, lead_time_days, active, created_by
    ) VALUES (
      v_supplier_id, p_name, p_trade_name, v_cnpj, p_city, p_state,
      p_contact_email, p_contact_phone, 3, true, v_user_id
    );
  EXCEPTION
    WHEN unique_violation THEN
      IF SQLERRM LIKE '%cnpj%' THEN
        RETURN jsonb_build_object('ok', false, 'error',
          'CNPJ já cadastrado. Solicite acesso à empresa existente.', 'conflict', true);
      END IF;
      RETURN jsonb_build_object('ok', false, 'error', 'Erro ao cadastrar. Tente novamente.');
  END;

  PERFORM set_config('app.bypass_supplier_guard', 'true', true);
  UPDATE public.profiles SET supplier_id = v_supplier_id WHERE id = v_user_id;

  RETURN jsonb_build_object('ok', true, 'supplierId', v_supplier_id);
END;
$$;

-- ─── 7. RPC: approve_supplier_access (atômica, admin-only) ─────────
CREATE OR REPLACE FUNCTION public.approve_supplier_access(
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin_id uuid;
  v_req record;
  v_existing_sid text;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
  END IF;

  SELECT id, supplier_id, profile_id, status INTO v_req
    FROM public.supplier_access_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitação não encontrada.');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitação já processada.');
  END IF;

  SELECT supplier_id INTO v_existing_sid
    FROM public.profiles WHERE id = v_req.profile_id;
  IF v_existing_sid IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Usuário já vinculado a outro fornecedor.');
  END IF;

  PERFORM set_config('app.bypass_supplier_guard', 'true', true);

  UPDATE public.profiles SET supplier_id = v_req.supplier_id
    WHERE id = v_req.profile_id;

  UPDATE public.supplier_access_requests
    SET status = 'approved', reviewed_by = v_admin_id, reviewed_at = now()
    WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- NOTE: NÃO criamos policy de INSERT em suppliers para usuários comuns.
-- O INSERT é feito exclusivamente via RPC (SECURITY DEFINER bypassa RLS).
