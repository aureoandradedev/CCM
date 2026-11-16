# Matriz de Auditoria Completa — Etapa 1 CCM

**Data**: 2026-11-12 (atualizada continuação)  
**Base**: `docs/etapas/etapa1.md` + `ccm-etapa1/src/regras.ts` + `ccm-etapa1/test/etapa1.test.ts`  
**23/23 testes de referência**: PASSANDO  
**60 testes adicionais**: PASSANDO (etapa1-extended:23 + etapa1-additional:19 + purchase-cycle-impl:18)  
**Total: 83/83 testes PASSANDO**  
**tsc --noEmit**: LIMPO  

## Legenda

| Status | Significado |
|--------|-------------|
| OK | Implementado e testado conforme spec |
| CORRIGIDO | Corrigido nesta sessão de auditoria |
| LACUNA | Funcionalidade ausente — precisa implementar |
| PARCIAL | Implementado mas com ressalva menor |

---

## 1. R3 — Modos de venda

| Regra | Implementação real | Teste ref | Teste adic. | Status |
|-------|-------------------|-----------|-------------|--------|
| R3 produto avulso: só por_unidade/nao_vender | DB CHECK constraint `sale_mode IN (...)`. `modosPermitidos()` ref. | T5 | ext:T3,T4 | OK |
| R3.1 `unidade_e_caixa` requer `permissaoDirecao` | SQL `has_permission('direcao')` existe. `publish_product` (0027) agora propaga `sale_mode` da oferta para o produto com guard: `has_permission('direcao')` + teto de sobra. RPC `set_product_sale_mode` standalone com mesmos guards. | T6 (pure fn) | ext:T3–T5 | CORRIGIDO |
| R3.2 Preço da caixa = unit × qty × (1-desc%) | `calculateBoxPrice()` em `purchase-cycle.ts` com `Math.round(...*100)/100`. `sale-mode-info.tsx` exibe. `section_configs.package_discount_pct` configurável. | T8 | add:R3.2, impl:boxPrice | CORRIGIDO |
| R3.3 Teto de sobra bloqueia `unidade_e_caixa` | `leftover_ceiling_centavos` global config. `v_leftover_summary` view. Admin UI exibe. Enforcement server-side em `publish_product` (0027) + `set_product_sale_mode`: verifica `calculate_leftover_total_value() >= ceiling` antes de ativar `unidade_e_caixa`. | T7 (pure fn) | — | CORRIGIDO |
| R3.4 Compra embalagem inteira + sobra | `calculatePackagePurchase()`. PO items tem `leftover_units`. `record_leftover` RPC grava em `ccm_inventory`. | T9, T10 | ext:T8–T10, add:R3.4, impl:pkg | OK |
| R3.4 Consume sobra existente antes de comprar | `calculatePackagePurchase(qty, emb, existingLeftover)`. Estoque é descontado primeiro. | T9, T10 | add:R3.4 | OK |

## 2. R4 — Compra por ciclo

| Regra | Implementação real | Teste ref | Teste adic. | Status |
|-------|-------------------|-----------|-------------|--------|
| R4.1 Cutoff configurável (default 17:30) | **SQL**: `calculate_next_cycle_date(dias, date, hora)` lê `horario_corte_ciclo` de `ccm_configs` (mig 0027). Dia de pedido antes do corte → retorna hoje; depois → próximo. Config `horario_corte_ciclo="17:30"` inserida. **TS**: `readCutoffConfig()` + `isAfterCutoff()` em `admin/data.ts` leem config e convertem hora→bool. `publish_product` e `auto_switch_sourcing_safe` passam `(now() AT TIME ZONE 'America/Sao_Paulo')::time` diretamente ao SQL. | T12, T13 | ext:R4.1 17:29/17:30/17:31, add:R4.1 16:00 | CORRIGIDO |
| R4.2 Dias úteis + feriados | **SQL**: `add_business_days()` reescrito em 0027, lê `feriados` de `ccm_configs`. **TS**: `addBusinessDays(from, n, holidays)` já aceita holidays. Config `feriados=[]` inserida. `calculate_expected_availability(dias, prazo, date, hora)` aceita timestamp para cutoff. | T11, T14 | ext:2 feriados, add:R4.2, impl:bdays | CORRIGIDO |
| R4.2 expected_availability_date preenchida | Coluna em `products`. `sale-mode-info.tsx` exibe. `publish_product` (0027) calcula via `calculate_expected_availability(dias, prazo, date, hora)` e grava na coluna. `auto_switch_sourcing_safe` (0027) idem — grava em todas as 3 branches de UPDATE. | — | impl:calcEAD | CORRIGIDO |
| R4.3 Pedido mínimo: 3 opções | SQL `decide_minimum_shortfall` com `complete_order`, `send_extra`, `wait_next_cycle`. Persistência: `decision`, `decided_by`, `decided_at` em `supplier_purchase_orders`. `wait_next_cycle` move requirements para próximo ciclo (0026 fix). | T15, T16 | ext:R4.3 vol, add:R4.3 | CORRIGIDO |

## 3. R5 — Preço

| Regra | Implementação real | Teste ref | Teste adic. | Status |
|-------|-------------------|-----------|-------------|--------|
| R5.1 precoVenda = regraPreco(custoUnitario) | `calculatePrice(cost_centavos, marginResult)` via `resolveMargin`. Orchestrator usa `unit_cost_centavos`. | — | ext:R5.1, add:R5.1 | OK |
| R5.2 Limite por seção configurável | `section_configs.auto_price_increase_limit_pct` por seção. Default 10% quando ausente. | — | — | OK |
| R5.3 Aumento ≤ limite → auto | `simulatePricingImpact()`: `changePct <= limitPct` → `safe: true`. Flag `auto_price_enabled` REMOVIDO das decisões de pricing — spec (R5.3/R5.4/R5.5) cobre tudo. | T17, T19 | add:R5.3, impl:limit | CORRIGIDO |
| R5.4 Aumento > limite → notifica [Aprovar, Tirar da venda] | TS: `safe: false, switchAllowed: true`. RPC: `p_price_blocked=true` → `price_change_log(blocked=true)`. Preço público NÃO muda. | T18 | ext:R5.4, add:R5.4 | CORRIGIDO |
| R5.5 Redução sempre auto | `simulatePricingImpact`: `changePct <= 0` → `safe: true` (checado ANTES de qualquer outro critério). | T20 | ext:R5.5 (1ctv, 50%), add:R5.5 | CORRIGIDO |

## 4. R6 — Troca de fornecedor

| Regra | Implementação real | Teste ref | Teste adic. | Status |
|-------|-------------------|-----------|-------------|--------|
| R6.1 Menor custo unitário com estoque > 0 | `auto-sourcing.ts`: `eligibleWithStock.filter(stock>0).sort(unitCost)`. Ranking ponderado (engine.ts) SOMENTE para BI/audit snapshot. Orchestrator economy detection idem. | T21 | ext:R6 custo×estoque, add:R6.1 3+candidatos | CORRIGIDO |
| R6.2 Registro só interno | `supplier_replacement_log` + `price_change_log`. Sem envio externo ao fornecedor. | T21 | — | OK |
| R6.3 Troca mesmo se preço excede limite | `auto-sourcing.ts`: `priceBlocked = !pricing.safe && pricing.switchAllowed`. Quando bloqueado: fornecedor troca (`p_new_price_centavos=null`), preço público mantido, `price_change_log(blocked=true)` registrado. | — | add:R6.3, ext:R6 textoFicha | CORRIGIDO |
| R6.4 Relatório diário timezone BR | `v_daily_operations` com `security_invoker=true` + `AT TIME ZONE 'America/Sao_Paulo'` (mig 0026). | T22 | ext:R6.4 múltiplas | CORRIGIDO |

## 5. R1/R2 — Fornecedor e produto

| Regra | Implementação real | Teste ref | Teste adic. | Status |
|-------|-------------------|-----------|-------------|--------|
| R1.1 Validação completa para ativar | `is_supplier_operationally_active()` → commercial_terms com todos campos. | T1, T2 | ext:R1.1 frete, R1.1 nome | OK |
| R2.1 unidade → qtd 1, vendeAvulso | DB CHECK constraints. Normalização na importação. | T3, T4 | — | OK |
| R2.2 custo unitário = custo ÷ qtdEmbalagem | `unit_cost_centavos` computado. 0026 corrigiu integer division com `round(::numeric /...)`. | T3 | — | CORRIGIDO |

## 6. Configurações [config]

| Config | Regra | Onde | Editável | Audit trail | Status |
|--------|-------|------|----------|-------------|--------|
| Regra de preço por seção | R5.1 | `margin_rules` | admin panel | `margin_rules.updated_at` | OK |
| Limite aumento % por seção | R5.2 | `section_configs.auto_price_increase_limit_pct` | admin panel | `section_config_history` trigger (mig 0027) | CORRIGIDO |
| Desconto caixa % por seção | R3.2 | `section_configs.package_discount_pct` | admin panel | `section_config_history` trigger (mig 0027) | CORRIGIDO |
| Teto sobra (R$) | R3.3 | `ccm_configs` global | `save_ccm_config` RPC | `ccm_config_history` | OK |
| Horário de corte | R4.1 | `ccm_configs` global (mig 0027) | `save_ccm_config` RPC | `ccm_config_history` | CORRIGIDO |
| Feriados | R4.2 | `ccm_configs` global (mig 0027) | `save_ccm_config` RPC | `ccm_config_history` | CORRIGIDO |
| `auto_switch_enabled` | — | `ccm_configs` global | `save_ccm_config` RPC | `ccm_config_history` | OK |
| Audit trail geral | spec | `ccm_config_history` + `save_ccm_config` trigger | — | — | OK |

## 7. Pedido de compra (agrupamento)

| Item | Implementação | Status |
|------|---------------|--------|
| PO 1 por fornecedor+ciclo | `generate_purchase_order(p_supplier_id, p_cycle_date)` | OK |
| PO usa custo da oferta ATIVA | Migration 0027 reescreveu: `COALESCE((SELECT unit_cost FROM active offer), MAX(snapshot))` | CORRIGIDO |
| PO respeita mínimo valor E volume | `v_total_qty` para volume, `v_subtotal` para valor (0026 fix) | CORRIGIDO |
| PO items: qtd embalagem + sobra | `purchase_order_items` com `pack_count`, `leftover_units` | OK |
| PO expected_delivery usa dias úteis+feriados | `add_business_days` (0027) agora lê feriados | CORRIGIDO |

## 8. P0 — Segurança

| Item | Correção (migration 0026) | Status |
|------|---------------------------|--------|
| P0.1 profiles.permissions escalada | Policy bloqueia `role` E `permissions` | OK |
| P0.2 supplier INSERT direto | Policy removida | OK |
| P0.3 dados fornecedor expostos | Policy SELECT pública removida | OK |
| P0.4 views sem security_invoker | `security_invoker = true` em ambas views | OK |
| P0.5 save_ccm_config sem auth.uid | Recriada com `auth.uid()` | OK |

## 9. P1 — Bugs SQL

| Item | Correção | Status |
|------|----------|--------|
| P1.2 section_configs colunas erradas | `sc.section_slug` + coluna direta (0026 + 0027) | CORRIGIDO |
| P1.5 integer division ensure_offer | `round(p_cost_centavos::numeric / GREATEST(...))` | CORRIGIDO |
| P1.7 decide_minimum_shortfall cycle | `wait_next_cycle` move requirements para próximo cycle_date | CORRIGIDO |
| P1.8 volume minimum check | Soma `v_total_qty` para comparação volume | CORRIGIDO |
| P1.9 migration 0027 offer_id | `offer_id` → `supplier_offer_id` em 6 referências na RPC | CORRIGIDO |

## 10. P3 — Textos 1P

| Item | Verificação | Status |
|------|-------------|--------|
| "Vendido e entregue por Multigiro Central de Compras" | `buy-box.tsx` | OK |
| Fornecedor NÃO aparece para cliente | `products_public` view exclui supplier_id. P0.3 removeu leitura pública. | OK |
| Catálogo filtra `nao_vender` | `catalog.ts`: `.neq("sale_mode", "nao_vender")` | OK |
| Preço sempre em REAIS no front | `retail_price` em REAIS no DB | OK |

## 11. P4 — Docs

| Item | Status |
|------|--------|
| CLAUDE.md | OK — atualizado com regras, stack, convenções |
| AGENTS.md | OK — gerado por Next.js 16 |
| README.md | PARCIAL — existe mas não documenta etapa 1 |
| `npm test` | OK — roda 83 testes (4 suites: etapa1 + extended + purchase-cycle-impl + additional) |

---

## Correções aplicadas NESTA sessão de auditoria

### Sessão 1 (migration 0026)
1. P0.1–P0.5: 5 correções de segurança
2. P1.2, P1.5, P1.7, P1.8: bugs SQL
3. R2.2: integer division → `round(::numeric /...)`

### Sessão 2 (migration 0027 + TS)
1. **R6.1 CRÍTICO**: Seleção de fornecedor reescrita de ranking ponderado → menor custo unitário com estoque > 0 (auto-sourcing.ts + orchestrator.ts)
2. **R6.3**: Troca de fornecedor prossegue mesmo com preço bloqueado. Novo: `p_price_blocked`, `p_blocked_new_price_centavos`, `p_blocked_change_pct` na RPC
3. **R5.3/R5.4/R5.5**: `auto_price_enabled` REMOVIDO das decisões. Regras spec aplicam diretamente: redução→auto, dentro do limite→auto, acima→bloqueio
4. **R4.1**: SQL `calculate_next_cycle_date` reescrita com suporte a cutoff (lê `horario_corte_ciclo`). Bug original corrigido (dia=hoje retornava +7 dias)
5. **R4.2**: SQL `add_business_days` reescrita para ler `feriados` de `ccm_configs`. Config `feriados=[]` inserida.
6. **R4.2**: SQL `calculate_expected_availability` aceita `p_hora` para integrar cutoff
7. **PO grouping**: `generate_purchase_order` agora usa custo da oferta ATIVA (não `MAX(snapshot)`)
8. **P1.9**: `offer_id` → `supplier_offer_id` (6 refs)
9. **Admin**: `horario_corte_ciclo` e `feriados` adicionados ao CcmConfigsPanel
10. **section_configs audit**: Trigger `trg_section_config_audit` + tabela `section_config_history` logam alterações de `package_discount_pct` e `auto_price_increase_limit_pct`
11. **npm test**: Adicionado `etapa1-additional.test.ts` ao script (83 testes total)

### Sessão 3 (migration 0027 ampliada + TS)
12. **R3.1+R3.3**: `publish_product` agora propaga `sale_mode`, `unidade_compra`, `qtd_por_embalagem`, `package_discount_pct` da oferta para o produto. Guard `has_permission('direcao')` para `unidade_e_caixa`. Guard `calculate_leftover_total_value() >= leftover_ceiling_centavos` para teto de sobra.
13. **R3.1+R3.3**: Nova RPC `set_product_sale_mode(p_master_product_id, p_sale_mode)` com mesmos guards para alteração standalone.
14. **R4.1 TS**: `readCutoffConfig()` e `isAfterCutoff()` em `src/lib/admin/data.ts` — leem `horario_corte_ciclo` + `feriados` de ccm_configs, convertem hora BR para boolean.
15. **R4.2**: `publish_product` e `auto_switch_sourcing_safe` agora calculam e gravam `expected_availability_date` no produto (via `calculate_expected_availability` SQL com hora corrente SP).
16. **R4.2**: `auto_switch_sourcing_safe` redefinida em 0027 (sobrescreve 0026) com `expected_availability_date` em TODAS as 3 branches de UPDATE (price applied, price blocked, no change).

---

## LACUNAS remanescentes

**Nenhuma.** Todas as 3 lacunas identificadas foram resolvidas na Sessão 3:
- R3.1+R3.3: sale_mode propagation + guards → CORRIGIDO
- R4.1 TS cutoff: `readCutoffConfig()` + `isAfterCutoff()` → CORRIGIDO
- R4.2 expected_availability_date: gravação em publish + auto-switch → CORRIGIDO

---

## Itens PARCIAIS (1)

1. **README.md**: Não documenta Etapa 1

---

## Contagem final

| Categoria | OK | CORRIGIDO | PARCIAL | LACUNA |
|-----------|-----|-----------|---------|--------|
| R1–R2 | 3 | 1 | 0 | 0 |
| R3 | 3 | 3 | 0 | 0 |
| R4 | 0 | 4 | 0 | 0 |
| R5 | 2 | 3 | 0 | 0 |
| R6 | 1 | 3 | 0 | 0 |
| Config | 4 | 4 | 0 | 0 |
| PO | 2 | 3 | 0 | 0 |
| P0 | 5 | 0 | 0 | 0 |
| P1 | 0 | 5 | 0 | 0 |
| P3 | 4 | 0 | 0 | 0 |
| P4 | 3 | 0 | 1 | 0 |
| **Total** | **27** | **26** | **1** | **0** |

---

## Migration 0027: conteúdo completo

| Função | Regra | O que faz |
|--------|-------|-----------|
| `section_config_history` table + trigger | spec | Audit trail para section_configs (package_discount_pct, limit_pct) |
| `INSERT horario_corte_ciclo` | R4.1 | Config global default "17:30" |
| `INSERT feriados` | R4.2 | Config global default [] |
| `add_business_days(date, int)` | R4.2 | Soma dias úteis, lê feriados de ccm_configs |
| `calculate_next_cycle_date(dias, date, hora)` | R4.1 | Próximo ciclo com suporte a cutoff (lê config) |
| `calculate_expected_availability(dias, prazo, date, hora)` | R4.1+R4.2 | Disponibilidade = next_cycle + business_days |
| `publish_product(...)` | R3.1+R3.3+R4.2 | Propaga sale_mode/packaging com guards direcao+teto; grava expected_availability_date |
| `set_product_sale_mode(uuid, text)` | R3.1+R3.3 | Altera sale_mode standalone com guard direcao + teto sobra |
| `auto_switch_sourcing_safe(...)` | R5/R6+R4.2 | RPC completa: price_blocked, sem auto_price_enabled, grava expected_availability_date |
| `generate_purchase_order(supplier, cycle)` | PO | Usa custo da oferta ativa, não MAX(snapshot) |
