-- ============================================================================
-- CCM · Fase 8 — Fundação de Integrações ERP/API/Feed
-- ----------------------------------------------------------------------------
-- Evolui supplier_integrations e integration_import_batches (0002) para
-- suportar qualquer connector futuro: ERP, API REST, feed, arquivo, local.
--
-- Fluxo obrigatório:
--   Sistema externo → Connector → supplier_catalog_items → normalização
--     → matching → supplier_offers → ranking → sourcing humano → publicação
--
-- Integração NUNCA escreve diretamente em products.
-- Integração NUNCA altera sourcing_selections ou publicação.
-- products.stock só muda via publicação CCM ou checkout atômico.
-- ============================================================================

-- ============================================================================
-- 1. ESTADOS EXPANDIDOS DA INTEGRAÇÃO
-- ============================================================================
-- Antes: connected, syncing, error, paused (0002)
-- Agora: + disconnected, configured, testing

ALTER TABLE public.supplier_integrations
  DROP CONSTRAINT IF EXISTS supplier_integrations_status_check;

ALTER TABLE public.supplier_integrations
  ADD CONSTRAINT supplier_integrations_status_check
  CHECK (status IN (
    'disconnected',   -- sem configuração
    'configured',     -- configurado, nunca testou
    'testing',        -- testando conexão
    'connected',      -- pronto para sincronizar
    'syncing',        -- sincronização em andamento
    'error',          -- última operação falhou
    'paused'          -- pausado manualmente
  ));

-- ============================================================================
-- 2. NOVOS CAMPOS EM supplier_integrations
-- ============================================================================

ALTER TABLE public.supplier_integrations
  ADD COLUMN IF NOT EXISTS sync_mode text NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_cursor text,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS sync_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS test_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sync_count int NOT NULL DEFAULT 0;

ALTER TABLE public.supplier_integrations
  DROP CONSTRAINT IF EXISTS supplier_integrations_sync_mode_check;
ALTER TABLE public.supplier_integrations
  ADD CONSTRAINT supplier_integrations_sync_mode_check
  CHECK (sync_mode IN ('full', 'delta'));

-- trigger updated_at (ausente em 0002)
DROP TRIGGER IF EXISTS supplier_integrations_updated_at ON public.supplier_integrations;
CREATE TRIGGER supplier_integrations_updated_at
  BEFORE UPDATE ON public.supplier_integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 3. CAMPOS EXPANDIDOS EM integration_import_batches
-- ============================================================================
-- Campos existentes: id, supplier_id, integration_id, method, source_name,
--                    total, valid, invalid, warnings, created_at
-- Novos: finished_at, status, sync_type, contadores granulares, cursores

ALTER TABLE public.integration_import_batches
  ADD COLUMN IF NOT EXISTS finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS sync_type text NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS items_created int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS items_updated int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS items_ignored int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_summary text,
  ADD COLUMN IF NOT EXISTS cursor_before text,
  ADD COLUMN IF NOT EXISTS cursor_after text;

ALTER TABLE public.integration_import_batches
  DROP CONSTRAINT IF EXISTS import_batches_status_check;
ALTER TABLE public.integration_import_batches
  ADD CONSTRAINT import_batches_status_check
  CHECK (status IN ('running', 'completed', 'partial', 'failed'));

ALTER TABLE public.integration_import_batches
  DROP CONSTRAINT IF EXISTS import_batches_sync_type_check;
ALTER TABLE public.integration_import_batches
  ADD CONSTRAINT import_batches_sync_type_check
  CHECK (sync_type IN ('full', 'delta'));

-- ============================================================================
-- 4. IDENTIDADE EXTERNA / IDEMPOTÊNCIA
-- ============================================================================
-- external_id = identificador estável do sistema de origem.
-- (integration_id, external_id) = chave de deduplicação.
-- Re-importar o mesmo item atualiza em vez de duplicar.

ALTER TABLE public.supplier_catalog_items
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS integration_id text
    REFERENCES public.supplier_integrations(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS catalog_items_idempotent_idx
  ON public.supplier_catalog_items (integration_id, external_id)
  WHERE integration_id IS NOT NULL AND external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS catalog_items_integration_idx
  ON public.supplier_catalog_items (integration_id)
  WHERE integration_id IS NOT NULL;

-- ============================================================================
-- 5. CONCORRÊNCIA: LOCK DE SINCRONIZAÇÃO
-- ============================================================================
-- Impede dois full syncs simultâneos na mesma integração.
-- Transição atômica: connected/error → syncing. Retorna false se já syncing.
-- SECURITY DEFINER para bypass de RLS, mas verifica owns_supplier() internamente.

CREATE OR REPLACE FUNCTION public.acquire_sync_lock(p_integration_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier_id text;
  v_rows int;
BEGIN
  SELECT supplier_id INTO v_supplier_id
  FROM supplier_integrations
  WHERE id = p_integration_id;

  IF v_supplier_id IS NULL THEN RETURN false; END IF;
  IF NOT public.owns_supplier(v_supplier_id) THEN RETURN false; END IF;

  UPDATE supplier_integrations
  SET status = 'syncing',
      sync_started_at = now(),
      sync_count = sync_count + 1
  WHERE id = p_integration_id
    AND status IN ('connected', 'error');

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_sync_lock(
  p_integration_id text,
  p_new_status text DEFAULT 'connected',
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier_id text;
BEGIN
  SELECT supplier_id INTO v_supplier_id
  FROM supplier_integrations
  WHERE id = p_integration_id;

  IF v_supplier_id IS NULL OR NOT public.owns_supplier(v_supplier_id) THEN
    RETURN;
  END IF;

  UPDATE supplier_integrations
  SET status = p_new_status,
      last_sync_at = now(),
      last_error = p_error,
      sync_started_at = NULL
  WHERE id = p_integration_id
    AND status = 'syncing';
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_sync_lock(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acquire_sync_lock(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.acquire_sync_lock(text) TO authenticated;

REVOKE ALL ON FUNCTION public.release_sync_lock(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_sync_lock(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.release_sync_lock(text, text, text) TO authenticated;

-- ============================================================================
-- 6. UPSERT IDEMPOTENTE DE ITEM DE CATÁLOGO
-- ============================================================================
-- (integration_id, external_id) como chave de deduplicação.
-- SECURITY INVOKER: RLS se aplica (owns_supplier).
-- Retorna 'created', 'updated' ou 'ignored'.

CREATE OR REPLACE FUNCTION public.upsert_catalog_item(
  p_catalog_id uuid,
  p_supplier_id text,
  p_integration_id text,
  p_external_id text,
  p_data jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
BEGIN
  SELECT id INTO v_existing_id
  FROM supplier_catalog_items
  WHERE integration_id = p_integration_id
    AND external_id = p_external_id;

  IF v_existing_id IS NULL THEN
    INSERT INTO supplier_catalog_items (
      catalog_id, supplier_id, integration_id, external_id,
      supplier_sku, ean, name, description, brand, model,
      category_original, subcategory_original, unit, pack_info,
      cost_centavos, stock, lead_time_days, image_url, attributes,
      match_status
    ) VALUES (
      p_catalog_id, p_supplier_id, p_integration_id, p_external_id,
      p_data ->> 'supplier_sku',
      p_data ->> 'ean',
      COALESCE(p_data ->> 'name', ''),
      p_data ->> 'description',
      p_data ->> 'brand',
      p_data ->> 'model',
      p_data ->> 'category',
      p_data ->> 'subcategory',
      p_data ->> 'unit',
      p_data ->> 'pack_info',
      (p_data ->> 'cost_centavos')::int,
      (p_data ->> 'stock')::int,
      (p_data ->> 'lead_time_days')::int,
      p_data ->> 'image_url',
      COALESCE(p_data -> 'attributes', '{}'::jsonb),
      'pendente'
    );
    RETURN 'created';
  END IF;

  UPDATE supplier_catalog_items SET
    catalog_id = p_catalog_id,
    supplier_sku = COALESCE(p_data ->> 'supplier_sku', supplier_sku),
    ean = COALESCE(p_data ->> 'ean', ean),
    name = COALESCE(p_data ->> 'name', name),
    description = p_data ->> 'description',
    brand = p_data ->> 'brand',
    model = p_data ->> 'model',
    category_original = p_data ->> 'category',
    subcategory_original = p_data ->> 'subcategory',
    unit = p_data ->> 'unit',
    pack_info = p_data ->> 'pack_info',
    cost_centavos = (p_data ->> 'cost_centavos')::int,
    stock = (p_data ->> 'stock')::int,
    lead_time_days = (p_data ->> 'lead_time_days')::int,
    image_url = p_data ->> 'image_url',
    attributes = COALESCE(p_data -> 'attributes', attributes)
  WHERE id = v_existing_id
    AND (
      supplier_sku IS DISTINCT FROM (p_data ->> 'supplier_sku')
      OR ean IS DISTINCT FROM (p_data ->> 'ean')
      OR name IS DISTINCT FROM (p_data ->> 'name')
      OR cost_centavos IS DISTINCT FROM (p_data ->> 'cost_centavos')::int
      OR stock IS DISTINCT FROM (p_data ->> 'stock')::int
      OR lead_time_days IS DISTINCT FROM (p_data ->> 'lead_time_days')::int
    );

  IF FOUND THEN RETURN 'updated'; END IF;
  RETURN 'ignored';
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_catalog_item(uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_catalog_item(uuid, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_catalog_item(uuid, text, text, text, jsonb) TO authenticated;

-- ============================================================================
-- 7. DOCUMENTAÇÃO
-- ============================================================================

COMMENT ON COLUMN public.supplier_integrations.config IS
  'Configuração NÃO-sensível: mapeamento de colunas, URL do feed, formato, flags. NUNCA armazenar tokens/senhas/API keys aqui. Segredos → credential_ref.';

COMMENT ON COLUMN public.supplier_integrations.credential_ref IS
  'Ponteiro para segredo externo (Supabase Vault, env do backend, server-side store). O segredo real NUNCA aparece nesta tabela nem em resposta ao cliente.';

COMMENT ON COLUMN public.supplier_integrations.credential_last4 IS
  'Últimos 4 caracteres do segredo, para exibição ao fornecedor. Nunca o valor completo.';

COMMENT ON COLUMN public.supplier_integrations.sync_mode IS
  'full = connector retorna catálogo completo a cada sync. delta = apenas alterações desde o último cursor.';

COMMENT ON COLUMN public.supplier_integrations.capabilities IS
  'Array JSON de capabilities: full_catalog, incremental_sync, stock, cost, images, lead_time.';

COMMENT ON COLUMN public.supplier_integrations.last_cursor IS
  'Cursor opaco para delta sync. Retornado pelo connector, passado de volta no próximo fetchChanges().';

COMMENT ON COLUMN public.supplier_integrations.last_error IS
  'Resumo seguro do último erro (sem tokens/senhas/headers). Detalhes técnicos ficam server-side.';

COMMENT ON COLUMN public.supplier_integrations.sync_started_at IS
  'Timestamp do início da sincronização atual. NULL quando não está sincronizando. Usado para detectar syncs travadas.';

COMMENT ON COLUMN public.supplier_catalog_items.external_id IS
  'Identificador estável do sistema externo. Com integration_id, garante import idempotente (mesmo item re-importado = update, não duplicação).';

COMMENT ON COLUMN public.supplier_catalog_items.integration_id IS
  'Integração que produziu este item. NULL para itens manuais ou imports legados.';

COMMENT ON COLUMN public.integration_import_batches.status IS
  'running = em andamento; completed = sucesso; partial = importação parcial com erros; failed = falha total.';

COMMENT ON COLUMN public.integration_import_batches.sync_type IS
  'full = catálogo completo; delta = apenas alterações desde cursor anterior.';

COMMENT ON COLUMN public.integration_import_batches.error_summary IS
  'Resumo seguro dos erros (sem tokens/senhas). Até 10 primeiros erros, um por linha.';

COMMENT ON FUNCTION public.acquire_sync_lock(text) IS
  'Transiciona integração para syncing atomicamente. Retorna false se já syncing (impede syncs concorrentes). Verifica owns_supplier().';

COMMENT ON FUNCTION public.release_sync_lock(text, text, text) IS
  'Libera lock de sync. Define status final e mensagem de erro opcional. Verifica owns_supplier().';

COMMENT ON FUNCTION public.upsert_catalog_item(uuid, text, text, text, jsonb) IS
  'DEPRECATED — substituída pela versão com 6 parâmetros (inclui p_batch_id). Mantida para rollback.';

-- ============================================================================
-- 8. RASTREABILIDADE DE ITENS POR BATCH (Revisão Fase 8)
-- ============================================================================
-- last_seen_batch_id/last_seen_at: rastreia quando cada item foi visto pela
-- última vez. Essencial para detectar itens que desapareceram em full sync.
-- source_active: distingue item fornecido ativamente de item que deixou de
-- ser enviado. became_unavailable_at: quando ficou inativo.

ALTER TABLE public.supplier_catalog_items
  ADD COLUMN IF NOT EXISTS last_seen_batch_id text,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS became_unavailable_at timestamptz;

CREATE INDEX IF NOT EXISTS catalog_items_active_idx
  ON public.supplier_catalog_items (integration_id, source_active)
  WHERE integration_id IS NOT NULL;

-- ============================================================================
-- 9. STALE LOCK RECOVERY em acquire_sync_lock
-- ============================================================================
-- Se sync_started_at > 60 minutos, o processo provavelmente morreu.
-- Transiciona para error antes de tentar adquirir normalmente.
-- Não usa Redis nem job queue: apenas timestamp + timeout no PG.

CREATE OR REPLACE FUNCTION public.acquire_sync_lock(p_integration_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier_id text;
  v_rows int;
BEGIN
  SELECT supplier_id INTO v_supplier_id
  FROM supplier_integrations
  WHERE id = p_integration_id;

  IF v_supplier_id IS NULL THEN RETURN false; END IF;
  IF NOT public.owns_supplier(v_supplier_id) THEN RETURN false; END IF;

  -- Recover stale lock (sync > 60 min = assumed dead process)
  UPDATE supplier_integrations
  SET status = 'error',
      last_error = 'Sync travada por mais de 60 minutos. Lock liberado automaticamente.',
      sync_started_at = NULL
  WHERE id = p_integration_id
    AND status = 'syncing'
    AND sync_started_at < now() - interval '60 minutes';

  -- Normal acquisition: connected/error → syncing
  UPDATE supplier_integrations
  SET status = 'syncing',
      sync_started_at = now(),
      sync_count = sync_count + 1
  WHERE id = p_integration_id
    AND status IN ('connected', 'error');

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- ============================================================================
-- 10. UPSERT COM BATCH TRACKING (substitui versão de 5 params)
-- ============================================================================
-- Adiciona p_batch_id para rastrear last_seen_batch_id / last_seen_at.
-- Respeita available=false para delta sync (source_active = false).
-- Sempre atualiza metadados de rastreabilidade, mesmo em 'ignored'.

DROP FUNCTION IF EXISTS public.upsert_catalog_item(uuid, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.upsert_catalog_item(
  p_catalog_id uuid,
  p_supplier_id text,
  p_integration_id text,
  p_external_id text,
  p_batch_id text,
  p_data jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_source_active boolean;
BEGIN
  v_source_active := COALESCE((p_data->>'available')::boolean, true);

  SELECT id INTO v_existing_id
  FROM supplier_catalog_items
  WHERE integration_id = p_integration_id
    AND external_id = p_external_id;

  IF v_existing_id IS NULL THEN
    INSERT INTO supplier_catalog_items (
      catalog_id, supplier_id, integration_id, external_id,
      supplier_sku, ean, name, description, brand, model,
      category_original, subcategory_original, unit, pack_info,
      cost_centavos, stock, lead_time_days, image_url, attributes,
      match_status, last_seen_batch_id, last_seen_at,
      source_active, became_unavailable_at
    ) VALUES (
      p_catalog_id, p_supplier_id, p_integration_id, p_external_id,
      p_data ->> 'supplier_sku',
      p_data ->> 'ean',
      COALESCE(p_data ->> 'name', ''),
      p_data ->> 'description',
      p_data ->> 'brand',
      p_data ->> 'model',
      p_data ->> 'category',
      p_data ->> 'subcategory',
      p_data ->> 'unit',
      p_data ->> 'pack_info',
      (p_data ->> 'cost_centavos')::int,
      (p_data ->> 'stock')::int,
      (p_data ->> 'lead_time_days')::int,
      p_data ->> 'image_url',
      COALESCE(p_data -> 'attributes', '{}'::jsonb),
      'pendente',
      p_batch_id,
      now(),
      v_source_active,
      CASE WHEN v_source_active THEN NULL ELSE now() END
    );
    RETURN 'created';
  END IF;

  -- Always update tracking metadata
  UPDATE supplier_catalog_items SET
    last_seen_batch_id = p_batch_id,
    last_seen_at = now(),
    source_active = v_source_active,
    became_unavailable_at = CASE
      WHEN v_source_active THEN NULL
      WHEN NOT v_source_active AND source_active THEN now()
      ELSE became_unavailable_at
    END
  WHERE id = v_existing_id;

  -- Conditionally update data fields
  UPDATE supplier_catalog_items SET
    catalog_id = p_catalog_id,
    supplier_sku = COALESCE(p_data ->> 'supplier_sku', supplier_sku),
    ean = COALESCE(p_data ->> 'ean', ean),
    name = COALESCE(p_data ->> 'name', name),
    description = p_data ->> 'description',
    brand = p_data ->> 'brand',
    model = p_data ->> 'model',
    category_original = p_data ->> 'category',
    subcategory_original = p_data ->> 'subcategory',
    unit = p_data ->> 'unit',
    pack_info = p_data ->> 'pack_info',
    cost_centavos = (p_data ->> 'cost_centavos')::int,
    stock = (p_data ->> 'stock')::int,
    lead_time_days = (p_data ->> 'lead_time_days')::int,
    image_url = p_data ->> 'image_url',
    attributes = COALESCE(p_data -> 'attributes', attributes)
  WHERE id = v_existing_id
    AND (
      supplier_sku IS DISTINCT FROM (p_data ->> 'supplier_sku')
      OR ean IS DISTINCT FROM (p_data ->> 'ean')
      OR name IS DISTINCT FROM (p_data ->> 'name')
      OR cost_centavos IS DISTINCT FROM (p_data ->> 'cost_centavos')::int
      OR stock IS DISTINCT FROM (p_data ->> 'stock')::int
      OR lead_time_days IS DISTINCT FROM (p_data ->> 'lead_time_days')::int
    );

  IF FOUND THEN RETURN 'updated'; END IF;
  RETURN 'ignored';
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_catalog_item(uuid, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_catalog_item(uuid, text, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_catalog_item(uuid, text, text, text, text, jsonb) TO authenticated;

-- ============================================================================
-- 11. DESATIVAÇÃO DE ITENS AUSENTES EM FULL SYNC
-- ============================================================================
-- Após full sync CONCLUÍDO COM SUCESSO (status=completed), itens da mesma
-- integração que NÃO apareceram no batch atual são marcados inativos.
--
-- REGRAS DE SEGURANÇA:
-- - Só executa se chamado explicitamente pelo pipeline APÓS full sync completed.
-- - Full sync partial/failed NÃO chama esta função (itens não desativados).
-- - Delta sync NUNCA chama esta função.
-- - SECURITY INVOKER: RLS se aplica (owns_supplier protege).
-- - Retorna quantidade de itens desativados para auditoria no batch.

CREATE OR REPLACE FUNCTION public.deactivate_unseen_items(
  p_integration_id text,
  p_batch_id text
)
RETURNS int
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE supplier_catalog_items
  SET source_active = false,
      became_unavailable_at = COALESCE(became_unavailable_at, now())
  WHERE integration_id = p_integration_id
    AND source_active = true
    AND (last_seen_batch_id IS NULL OR last_seen_batch_id IS DISTINCT FROM p_batch_id);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.deactivate_unseen_items(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deactivate_unseen_items(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.deactivate_unseen_items(text, text) TO authenticated;

-- ============================================================================
-- 12. DOCUMENTAÇÃO ADICIONAL (Revisão)
-- ============================================================================

COMMENT ON COLUMN public.supplier_catalog_items.last_seen_batch_id IS
  'ID do último batch que viu este item. Usado para detectar itens ausentes em full sync.';

COMMENT ON COLUMN public.supplier_catalog_items.last_seen_at IS
  'Timestamp da última vez que este item apareceu em um sync.';

COMMENT ON COLUMN public.supplier_catalog_items.source_active IS
  'true = item fornecido ativamente pelo fornecedor. false = item que desapareceu de full sync ou foi marcado available=false em delta sync.';

COMMENT ON COLUMN public.supplier_catalog_items.became_unavailable_at IS
  'Quando o item foi marcado inativo pela primeira vez. NULL se ativo.';

COMMENT ON FUNCTION public.acquire_sync_lock(text) IS
  'Transiciona integração para syncing atomicamente. Recupera locks travados (>60min). Retorna false se já syncing. Verifica owns_supplier().';

COMMENT ON FUNCTION public.upsert_catalog_item(uuid, text, text, text, text, jsonb) IS
  'Insert/update idempotente com batch tracking. Rastreia last_seen_batch_id, last_seen_at, source_active. Respeita available=false. SECURITY INVOKER = RLS se aplica.';

COMMENT ON FUNCTION public.deactivate_unseen_items(text, text) IS
  'Marca inativos os itens de uma integração que não apareceram no batch informado. Só chamar após full sync completed (NUNCA após partial/failed/delta).';
