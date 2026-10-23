-- ============================================================================
-- CCM · QA Seed — Regras de margem para teste
-- ============================================================================
--
-- ATENÇÃO: Dados de QA, NÃO de produção.
-- Aplicar via Supabase Dashboard > SQL Editor (com sessão admin).
--
-- Testa: precedência (produto > categoria > global), rounding, min_price,
--        ambiguidade (tie de priority), e publicação bloqueada.
--
-- Para remover depois do QA:
--   DELETE FROM margin_rules WHERE id::text LIKE 'aaaaaaaa-%';
-- ============================================================================

-- Cleanup idempotente
DELETE FROM margin_rules WHERE id IN (
  'aaaaaaaa-0001-4000-a000-000000000001'::uuid,
  'aaaaaaaa-0002-4000-a000-000000000002'::uuid,
  'aaaaaaaa-0003-4000-a000-000000000003'::uuid,
  'aaaaaaaa-0004-4000-a000-000000000004'::uuid,
  'aaaaaaaa-0005-4000-a000-000000000005'::uuid,
  'aaaaaaaa-0006-4000-a000-000000000006'::uuid,
  'aaaaaaaa-0007-4000-a000-000000000007'::uuid
);

-- 1. Regra GLOBAL — markup 20%, sem arredondamento, prioridade 0
INSERT INTO margin_rules (id, scope, scope_ref, margin_pct, min_price_centavos, rounding, priority, active)
VALUES ('aaaaaaaa-0001-4000-a000-000000000001', 'global', NULL, 20.00, NULL, 'none', 0, true);

-- 2. Regra GLOBAL alternativa — markup 15%, arredondamento X90, prioridade -1
--    (menor prioridade que a 1ª, serve para testar que a regra de maior prioridade vence)
INSERT INTO margin_rules (id, scope, scope_ref, margin_pct, min_price_centavos, rounding, priority, active)
VALUES ('aaaaaaaa-0002-4000-a000-000000000002', 'global', NULL, 15.00, NULL, 'X90', -1, true);

-- 3. Regra de CATEGORIA (ventilação) — markup 25%, arredondamento X99, prioridade 0
--    Deve vencer a global quando o produto for da categoria 'ventilacao'
INSERT INTO margin_rules (id, scope, scope_ref, margin_pct, min_price_centavos, rounding, priority, active)
VALUES ('aaaaaaaa-0003-4000-a000-000000000003', 'category', 'ventilacao', 25.00, NULL, 'X99', 0, true);

-- 4. Regra de CATEGORIA (hidráulica) — markup 18%, min_price R$ 15,00
--    Testa min_price_centavos
INSERT INTO margin_rules (id, scope, scope_ref, margin_pct, min_price_centavos, rounding, priority, active)
VALUES ('aaaaaaaa-0004-4000-a000-000000000004', 'category', 'hidraulica', 18.00, 1500, 'none', 0, true);

-- 5. Regra de PRODUTO específico (Ventilador VTX-40) — markup 30%, prioridade 0
--    Deve vencer a categoria e a global para este produto
--    NOTA: o subselect resolve automaticamente o master_product_id do ventilador.
INSERT INTO margin_rules (id, scope, scope_ref, margin_pct, min_price_centavos, rounding, priority, active)
VALUES (
  'aaaaaaaa-0005-4000-a000-000000000005',
  'product',
  (SELECT id::text FROM master_products WHERE name ILIKE '%ventilador%' LIMIT 1),
  30.00, NULL, 'none', 0, true
);

-- 6–7. Par de regras AMBÍGUAS (mesma categoria, mesma prioridade)
--    Para testar detecção de ambiguidade e bloqueio de publicação.
INSERT INTO margin_rules (id, scope, scope_ref, margin_pct, min_price_centavos, rounding, priority, active)
VALUES ('aaaaaaaa-0006-4000-a000-000000000006', 'category', 'cimento', 22.00, NULL, 'none', 5, true);

INSERT INTO margin_rules (id, scope, scope_ref, margin_pct, min_price_centavos, rounding, priority, active)
VALUES ('aaaaaaaa-0007-4000-a000-000000000007', 'category', 'cimento', 28.00, NULL, 'X90', 5, true);

-- ============================================================================
-- Verificação
-- ============================================================================
-- SELECT id, scope, scope_ref, margin_pct, min_price_centavos, rounding, priority, active
-- FROM margin_rules
-- WHERE id::text LIKE 'aaaaaaaa-%'
-- ORDER BY scope, priority DESC;
--
-- Resultado esperado:
--   7 regras QA:
--     global    : 2 (prio 0 e -1)
--     category  : 3 (ventilacao, hidraulica, 2× cimento tie)
--     product   : 1 (ventilador)
-- ============================================================================
