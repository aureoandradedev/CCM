-- ============================================================================
-- CCM · Fase 9+ — Tipo de exceção: no_master_candidate
-- ----------------------------------------------------------------------------
-- Itens normalizados sem nenhum master product candidato plausível.
-- Permite que o comprador identifique itens que precisam de master novo.
-- ============================================================================

-- Adiciona 'no_master_candidate' ao CHECK constraint de type.
-- O ALTER ... DROP CONSTRAINT + ADD CONSTRAINT é idempotente com IF NOT EXISTS
-- via verificação condicional.
DO $$
BEGIN
  ALTER TABLE public.procurement_exceptions
    DROP CONSTRAINT IF EXISTS procurement_exceptions_type_check;

  ALTER TABLE public.procurement_exceptions
    ADD CONSTRAINT procurement_exceptions_type_check
    CHECK (type IN (
      'review_match',
      'review_ranking',
      'no_offer',
      'source_changed',
      'economy_opportunity',
      'stale_sourcing',
      'stale_publication',
      'inactive_item',
      'no_master_candidate'
    ));
END $$;
