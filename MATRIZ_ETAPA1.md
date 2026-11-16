# Matriz de Conformidade — Etapa 1 CCM

**Data:** 2026-11-12
**Validação:** tsc OK | build OK | 23/23 referência | 11/11 adicionais (34 total)
**Branch:** main (working tree, sem commit)
**Migrations:** 0026_etapa1_security_bugs.sql + 0027_etapa1_r4_po_fix.sql (não aplicadas ao Supabase dev)

---

## Legenda de Status

| Sigla | Significado |
|-------|-------------|
| OK | Implementado e validado |
| CORRIGIDO | Estava errado, corrigido nesta auditoria |
| PARCIAL | Implementado parcialmente, falta completar |
| SQL-ONLY | Lógica no SQL/view, sem UI wired |
| N/A | Não se aplica ao código (doc/config) |

---

## R1 — Cadastro de Fornecedores

| Regra | Implementação real | Teste | E2E | Status |
|-------|-------------------|-------|-----|--------|
| R1.1 Fornecedor ativo = condições comerciais válidas | `is_supplier_operationally_active()` RPC verifica existência de terms ativos (0026) | Ref: 2 testes (completo/sem dias) | — | OK |
| R1.2 Campos obrigatórios (dias_pedido, prazo, mínimo, frete) | `validarFornecedor` + `SupplierCommercialTerms` type + form validation | Ref: R1.1 cobre | — | OK |
| R1.3 Supplier portal (convite + cadastro + terms) | Migration 0024 + invite flow + registration page + review page | Ref: — | Task #79 E2E | OK |

## R2 — Produtos e Custo Unitário

| Regra | Implementação real | Teste | E2E | Status |
|-------|-------------------|-------|-----|--------|
| R2.1 unidade → qtd=1, vendeAvulso=true | `normalizarProduto()` em regras.ts; tipo `UnidadeCompra` no types.ts | Ref: 1 teste | — | OK |
| R2.2 custoUnitario = custo / qtdPorEmbalagem | `custoUnitario()` em regras.ts; `unit_cost_centavos` na DB (0026 P1.5 fix: divisão inteira corrigida com cast numeric) | Ref: 1 teste | — | CORRIGIDO |
| R2.3 unit_cost_centavos no código TS | `orchestrator.ts`, `auto-sourcing.ts`, `ranking/types.ts` usam `unit_cost_centavos ?? cost_centavos` | 7 testes R6.1 adicionais | — | CORRIGIDO |

## R3 — Modos de Venda

| Regra | Implementação real | Teste | E2E | Status |
|-------|-------------------|-------|-----|--------|
| R3.1 Direção ativa unidade_e_caixa | `validarModoVenda()` verifica `permissaoDirecao`; server action valida | Ref: 1 teste | — | OK |
| R3.2 Site: preço unitário + caixa com desconto | `sale-mode-info.tsx` mostra "Caixa com N un. — R$ X (Y% off)"; `calculateBoxPrice()` com rounding fix (×100/100) | Ref: 1 teste | — | CORRIGIDO |
| R3.3 Teto de sobra bloqueia unidade_e_caixa | `validarModoVenda()` recebe sobraAtualValor e rejeita ≥ teto | Ref: 1 teste | — | OK |
| R3.4 Sobra entra no inventário CCM | `calculatePackagePurchase()` em purchase-cycle.ts; `ccm_inventory` + `inventory_movements` tables; `existingLeftover` abatido antes de comprar | Ref: 2 testes (3un→1cx, 12un→2cx) | — | OK |
| R3.5 Consumir sobra antes de comprar nova caixa | `calculatePackagePurchase()` param `existingLeftover` = estoque atual | Coberto por R3.4 | — | OK |
| R3 Multíplos (por_unidade múltiplo de 1; emb_fechada múltiplo de qtdPorEmbalagem) | `compraParaUnidades()` arredonda ⬆ para próxima embalagem | Ref: R3.4 cobre | — | OK |

## R4 — Ciclo de Compra

| Regra | Implementação real | Teste | E2E | Status |
|-------|-------------------|-------|-----|--------|
| R4.1 Horário de corte configurável | `ConfigGeral.horarioCorteCiclo`; `purchase-cycle.ts:nextOrderDay(afterCutoff)` pula dia se afterCutoff; SQL: `ccm_configs.horario_corte_ciclo` (0027) + `calculate_next_cycle_date()` com cutoff | Ref: 3 testes (antes/depois/borda) | — | OK |
| R4.2 Dias úteis, feriados não contam | `addBusinessDays()` com param `holidays: string[]`; SQL: `ccm_configs.feriados` (JSON array, 0027) + `add_business_days()` lê feriados de ccm_configs | Ref: 2 testes (normal + feriado) | — | CORRIGIDO |
| R4.2 expected_availability_date salvo e exibido no site | `sale-mode-info.tsx` exibe data formatada pt-BR; campo `expectedAvailabilityDate` no Product type | Visual confirm | — | OK |
| R4.3 Pedido mínimo: 3 decisões persistidas | `avaliarPedidoMinimo()` retorna completar/enviar_pagando/esperar; `decide_minimum_shortfall` RPC (0026 P1.7) move para próximo ciclo no wait | Ref: 2 testes | — | CORRIGIDO |
| R4.3 Mínimo volume vs valor | DB: `minimum_type` + `minimum_value` (corrigido de `minimum_centavos`); `generate_purchase_order` RPC valida qty E value | TS types corrigidos | — | CORRIGIDO |

## R5 — Preço de Venda

| Regra | Implementação real | Teste | E2E | Status |
|-------|-------------------|-------|-----|--------|
| R5.1 preço = custoUnitário + regra da seção | `calculatePrice(unit_cost, resolvedMargin)` em pricing.ts; `resolveMargin()` resolve produto→categoria→global | Ref: — ; Extra: 2 testes R5.1 | — | OK |
| R5.2 Regra por seção (margin_rules scope hierarchy) | `margin_rules` table com scope product/category/global + priority | — | — | OK |
| R5.3 Aumento ≤ limite → auto-aplica | `simulatePricingImpact()`: changePct ≤ limitPct → safe:true; RPC aplica | Ref: 2 testes (+6.4%, borda 8%) | — | OK |
| R5.4 Aumento > limite → bloqueia e notifica | `simulatePricingImpact()`: changePct > limitPct → safe:false; `price_change_log.blocked=true` | Ref: 1 teste (+13.8%); Extra: 1 teste (8.01%) | — | OK |
| R5.5 Redução SEMPRE auto-aplica | `simulatePricingImpact()` line 182: changePct ≤ 0 → safe:true; RPC: v_change_pct > 0 guard | Ref: 1 teste; Extra: 1 teste (zero) | — | OK |
| R5 NÃO depender de flag | `auto_price_enabled` REMOVIDO do fluxo de pricing (TS e SQL). Regra da seção sempre aplica. | Verificado por grep: src/ sem uso; RPC sem guard | — | CORRIGIDO |
| R5 retail_price em REAIS (não centavos) | `ccm-actions.ts:53` corrigido: `retail_price: log.new_price_centavos / 100` | — | — | CORRIGIDO |

## R6 — Fornecimento Automático

| Regra | Implementação real | Teste | E2E | Status |
|-------|-------------------|-------|-----|--------|
| R6.1 Menor custo unitário com estoque > 0 | `engine.ts`: recomendação por `unit_cost_centavos ?? cost_centavos` ASC entre offers com stock > 0. Score ponderado é apenas BI. | Extra: 7 testes R6.1 | — | CORRIGIDO |
| R6.1 auto-sourcing sem hysteresis block | `auto-sourcing.ts`: removido `economy_sem_hysteresis` check. Se o mais barato é diferente, troca. | Extra: R6.1 testes cobrem | — | CORRIGIDO |
| R6.2 Registro só interno | `supplier_replacement_log` table; `sourcing_selections` table. Fornecedor nunca visível ao cliente. | P3: grep confirma | — | OK |
| R6.3 Troca mesmo com aumento; preço NÃO muda; cria bloqueio | `auto-sourcing.ts`: priceBlocked + RPC executa switch mas não atualiza retail_price; `price_change_log.blocked=true` | Lógica auditada | — | CORRIGIDO |
| R6.4 Relatório diário em America/Sao_Paulo | `v_daily_operations` view usa `AT TIME ZONE 'America/Sao_Paulo'`; `security_invoker=true`; revoked from anon | Ref: 1 teste (trocarFornecedor + linhasRelatorioDiario) | — | SQL-ONLY |

## Configurações

| Config | Implementação | Teste | E2E | Status |
|--------|---------------|-------|-----|--------|
| Regra de preço (por seção) | `margin_rules` table com scope hierarchy + `section_configs.auto_price_increase_limit_pct` | Via R5 testes | — | OK |
| Limite aumento (por seção) | `section_configs.auto_price_increase_limit_pct` (coluna direta, NÃO key-value) | Corrigido P1.2 | — | CORRIGIDO |
| Desconto caixa (por seção) | `section_configs.package_discount_pct` (coluna direta) | Via R3.2 teste | — | OK |
| Teto sobra (geral) | `ccm_configs key=leftover_ceiling_centavos` | Via R3.3 teste | — | OK |
| Horário corte (geral, 17h30 default) | `ccm_configs key=cutoff_time` ou `ConfigGeral.horarioCorteCiclo` | Via R4.1 testes | — | OK |
| Feriados | `addBusinessDays()` aceita `holidays: string[]`; SQL: `ccm_configs key=feriados` (JSON array, migration 0027) + `add_business_days()` lê do DB; falta: UI para gerenciar feriados | Via R4.2 teste feriado | — | OK |
| Audit trail | `ccm_config_history` table; `registrarAlteracao()` grava quem/quando/anterior/novo; `save_ccm_config` RPC usa `auth.uid()` (P0.5) | Ref: 1 teste | — | CORRIGIDO |

## P0 — Segurança (Migration 0026)

| Item | Fix | Status |
|------|-----|--------|
| P0.1 Profile update bloqueia role + permissions | `own profile update` policy blocks both columns | CORRIGIDO |
| P0.2 Supplier INSERT sem auth | Dropped `supplier propose terms` INSERT policy | CORRIGIDO |
| P0.3 Fornecedores públicos visíveis | Dropped `public read suppliers` SELECT policy | CORRIGIDO |
| P0.4 Views sem security_invoker | `v_leftover_summary` e `v_daily_operations` com `security_invoker=true`, revoke anon | CORRIGIDO |
| P0.5 save_ccm_config ignora p_admin_id | Usa `auth.uid()` direto; ccm_configs → SELECT-only para admin | CORRIGIDO |

## P1 — Bugs de Lógica

| Item | Fix | Status |
|------|-----|--------|
| P1.2 section_configs key-value → coluna direta | `simulatePricingImpact` e RPC: `.eq("section_slug", ...)` + `.select("auto_price_increase_limit_pct")` | CORRIGIDO |
| P1.5 Divisão inteira custo/qtd | RPC `ensure_offer_for_approved_item`: `round(p_cost_centavos::numeric / GREATEST(v_qtd_emb, 1))` | CORRIGIDO |
| P1.7 wait_next_cycle move requirements | `decide_minimum_shortfall` RPC moves to next cycle_date | CORRIGIDO |
| P1.8 Volume minimum checks | `generate_purchase_order` verifica quantity (não só value) para minimum_type=volume | CORRIGIDO |

## P2 — Bugs Menores

| Item | Fix | Status |
|------|-----|--------|
| P2 calculateBoxPrice rounding | `Math.round(... * 100) / 100` para 2 decimais (era Math.round → inteiro) | CORRIGIDO |
| P2 addBusinessDays feriados | Param `holidays: string[]` adicionado, pula feriados além de sábado/domingo | CORRIGIDO |

## P3 — Textos

| Item | Verificação | Status |
|------|-------------|--------|
| "Vendido e entregue por Multigiro Central de Compras" | `buy-box.tsx:105-106` — texto correto | OK |
| Fornecedor invisível ao cliente | grep em src/components/{product,checkout,cart,catalog}: nenhuma referência a fornecedor visível | OK |
| Entrega/retirada na loja | `buy-box.tsx:107` — "Entrega na obra ou retirada na loja" | OK |

## P4 — Documentação

| Item | Status |
|------|--------|
| CLAUDE.md atualizado | OK (modelo 1P, stack, convenções, marca) |
| AGENTS.md referência Next.js | OK (auto-gerado pelo next dev) |
| docs/etapas/etapa1.md | OK (spec completa R1-R6 + configs) |
| npm test configurado | `node --experimental-strip-types --test ccm-etapa1/test/` roda 34 testes |
| README atualizado | Verificar se precisa atualização (config table de feriados) |

---

## Resumo de Alterações Nesta Auditoria

### engine.ts (ranking)
- **R6.1 CRÍTICO**: Recomendação agora usa menor `unit_cost_centavos` com stock > 0, não score ponderado
- Score ponderado (custo 60%/estoque 20%/prazo 20%) permanece apenas como BI
- Ambiguidade baseada em custos unitários iguais (não gap de score)

### auto-sourcing.ts
- **Removido** `economy_sem_hysteresis` check (bloqueava trocas a fornecedores mais baratos)
- **Removido** dependência de `auto_price_enabled` flag (R5 compliance)
- **R6.3**: Switch procede mesmo com aumento > limite; preço não muda; cria bloqueio

### 0026_etapa1_security_bugs.sql (RPC)
- **R5.5**: Reduções sempre auto-aplicam (guard `v_change_pct > 0`)
- **Removido** guard de `auto_price_enabled` do RPC
- Apenas `v_limit_pct` decide se aumento é bloqueado

### 0027_etapa1_r4_po_fix.sql (migration)
- **R4.1**: `horario_corte_ciclo` config + `calculate_next_cycle_date()` com cutoff
- **R4.2**: `feriados` config (JSON array) + `add_business_days()` lê feriados de ccm_configs
- **PO fix**: `generate_purchase_order()` usa custo da oferta ativa, não MAX(snapshots)
- **Removido**: RPC `auto_switch_sourcing_safe` duplicada (0026 é autoritativa) — tinha bugs: coluna `supplier_id` inexistente em `sourcing_selections`, não atualizava `products` table

### Novos testes (engine-r6.test.ts)
- 7 cenários R6.1 (lowest unit cost, stock=0 skip, stock/lead ignorado, fallback, ambiguidade, inativa, todos sem estoque)
- 4 cenários R5 (precoVenda seção, unidade, borda acima limite, zero change)

---

## Itens Pendentes

| Item | Detalhe | Prioridade |
|------|---------|------------|
| v_daily_operations UI | View SQL existe com timezone correto, mas nenhuma página admin consome | Baixa |
| auto_price_enabled cleanup | Flag existe no DB e UI (display-only) mas não tem efeito. Remover da UI? | Baixa |
| Migrations 0026+0027 aplicar | Migrations criadas mas não aplicadas ao Supabase dev | Alta (pré-deploy) |
| Feriados UI | Config de feriados existe no DB (ccm_configs), mas sem tela admin para gerenciar | Baixa |
| E2E browser flows | Precisa validação visual dos flows críticos com servidor rodando | Média |
