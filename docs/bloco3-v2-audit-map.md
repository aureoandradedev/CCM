# BLOCO 3 V2 — MAPA DE AUDITORIA ECONÔMICA

## 1. PRICING (preço ao cliente)

| Estrutura | Local | Descrição |
|---|---|---|
| `pricing.ts` | `src/lib/pricing.ts` | Funções puras: `unitPriceFor()`, `lineTotal()`, `pixPrice()`, `computeCartTotals()` |
| `products.retail_price` | `0001_init.sql:141` | Preço de venda ao público (numeric 12,2) |
| `products.cost_centavos` | `0005:108` | Custo de compra do fornecedor (int, centavos) |
| `products.margin_pct` | `0005:213` | Margem aplicada (snapshot do publish) |
| `margin_rules` | `0005:186` | Regras de margem: scope (global/category/product), margin_pct, min_price_centavos |
| `publish_product()` | `0009:96` | RPC: resolve margin_rule → calcula `retail_price = cost * (1 + margin/100)` |

## 2. ORDER PRICING (snapshot no momento da venda)

| Estrutura | Local | Descrição |
|---|---|---|
| `order_items.unit_price_centavos` | `0001:338` | Preço unitário cobrado (centavos) |
| `order_items.retail_price_centavos` | `0001:339` | Preço varejo para cálculo de economia atacado |
| `order_items.line_centavos` | `0001:340` | Total da linha (unit_price * qty) |
| `order_items.supplier_cost_centavos` | `0025:26` | Custo do fornecedor NO MOMENTO DA VENDA |
| `order_items.supplier_offer_id` | `0025:27` | Oferta ativa no momento |
| `order_items.master_product_id` | `0025:28` | Produto mestre CCM |
| `orders.subtotal_centavos` | `0001:300` | Subtotal com atacado aplicado |
| `orders.discount_centavos` | `0001:302` | Desconto Pix/primeira compra |
| `orders.discount_detail` | `0001:303` | jsonb: `[{tipo, pct?, valor}]` |
| `orders.freight_centavos` | `0001:304` | Frete cobrado do CLIENTE |
| `orders.total_centavos` | `0001:306` | Total = subtotal - desconto + frete |

## 3. DESCONTOS EXISTENTES

| Tipo | Fonte | Mecânica |
|---|---|---|
| Pix | `site_settings.descontos.pixPct` (default 5%) | % sobre `base = subtotal - desconto_secao` |
| Primeira compra | `site_settings.descontos.primeiraCompra.percentual` | % sobre mesma base, NÃO acumula com Pix (maior vence) |
| Seção | `site_settings.descontos.secoes[category_slug]` | % por seção/departamento |
| **NÃO EXISTE** | — | Crédito, cupom, promo code, volume discount, credit-funded discount |

## 4. CUSTO DO FORNECEDOR (interno)

| Estrutura | Local | Descrição |
|---|---|---|
| `supplier_offers.cost_centavos` | `0005:153` | Custo por embalagem |
| `supplier_offers.unit_cost_centavos` | implícito | Custo por unidade (cost / qtd_embalagem) |
| `supplier_request_lines.unit_cost_centavos` | `0058:96` | **Custo ASSUMIDO** quando request criado |
| `supplier_request_lines.cost_confirmed_centavos` | `0058:99` | **Custo CONFIRMADO** pelo fornecedor |
| `confirm_supplier_request_v2()` | `0069:262` | Atualiza cost_confirmed_centavos por linha |

**ACHADO CHAVE**: O par `unit_cost_centavos` / `cost_confirmed_centavos` em `supplier_request_lines` JÁ É a fonte de dados da GORDURA. A diferença `assumed - confirmed` por linha gera o crédito (se positiva) ou overrun (se negativa).

## 5. FRETE DO FORNECEDOR (PO)

| Estrutura | Local | Descrição |
|---|---|---|
| `supplier_commercial_terms.frete_tipo` | `0016:67` | 'fixo' ou 'gratis_acima' |
| `supplier_commercial_terms.frete_valor` | `0016:69` | Valor do frete fixo |
| `supplier_commercial_terms.frete_gratis_acima` | `0016:68` | Threshold para frete grátis |
| `supplier_purchase_orders.freight_centavos` | `0018:142` | Frete do PO calculado |
| `generate_purchase_order()` | `0018:259` | Calcula frete do PO a partir das condições |

**NÃO EXISTE**: Rateio do frete PO → pedidos do cliente

## 6. FRETE DO CLIENTE

| Estrutura | Local | Descrição |
|---|---|---|
| `site_settings.frete` | `0001:226` | `freeShippingFromCentavos: 79900`, `flatCentavos: 4990` |
| `calcularFrete()` | `backend/lib/precos.mjs` | Frete fixo ou grátis acima do threshold, 0 para pickup |
| `orders.freight_centavos` | `0001:304` | Valor final cobrado do cliente |

## 7. RESULTADO ECONÔMICO

**NÃO EXISTE NADA:**
- Nenhum cálculo de resultado por pedido (receita - custos - frete_rateado - descontos)
- Nenhum result_lock (trava econômica)
- Nenhum minimum_order_result_centavos
- Nenhum gate econômico antes do pagamento

## 8. CRÉDITO / GORDURA / LEDGER

**NÃO EXISTE NADA:**
- Nenhuma tabela de crédito
- Nenhum ledger
- Nenhum saldo
- Nenhum voucher
- Nenhum discount pool

## 9. EVENTOS & AUDITORIA

| Estrutura | Local | Descrição |
|---|---|---|
| `order_events` | `0001:346` | type, data jsonb, actor_kind, actor_id — reutilizar |
| `order_notification_outbox` | `0057` | Despacho de notificações |
| `ccm_config_history` | `0016:259` | Trilha de auditoria de configs |
| `save_ccm_config()` | `0016:278` | RPC com audit trail — reutilizar |

## 10. ccm_configs (flags & params existentes)

| Chave | Valor | Escopo |
|---|---|---|
| `ccm_stock_enabled` | false | global |
| `ccm_supplier_backup_enabled` | false | global |
| `backup_cost_threshold_pct` | 15 | global |
| `supplier_request_timeout_minutes` | vários | global |
| **NÃO EXISTE** | — | `ccm_result_protection_enabled` |
| **NÃO EXISTE** | — | `minimum_order_result_centavos` |

## 11. FLUXO DE PAGAMENTO (gate existente)

```
aguardando-confirmacao
  → (todos fornecedores confirmam, sem ajustes)
  → aguardando-pagamento
  → (pagamento via pagamentos.mjs + payment_lock CAS)
  → em-separacao
```

Pontos de integração:
- `accept_order_adjustments()` (`0057:432`): avança para aguardando-pagamento
- Lógica em `0069:636/703/793`: avança para aguardando-pagamento após confirmações
- **Nenhum check econômico antes de avançar**

## 12. GAPS (tudo que o Bloco 3 V2 precisa construir)

| # | Gap | Tipo |
|---|---|---|
| 1 | Tabela `credit_ledger` | Schema |
| 2 | Cálculo de gordura (assumed vs confirmed cost) | RPC |
| 3 | Reserva atômica de crédito (FOR UPDATE + idempotency) | RPC |
| 4 | Resultado por pedido (receita - custos - frete_rateado - desconto) | RPC |
| 5 | `minimum_order_result_centavos` config | Config |
| 6 | Tabela `order_result_locks` (snapshot econômico congelado) | Schema |
| 7 | Integração backup: diferença de custo reduz resultado | RPC |
| 8 | Rateio de frete PO → pedidos (proporcional ao custo) | RPC |
| 9 | Motor de descontos: separar comercial de crédito-funded | Backend |
| 10 | Gate econômico antes do pagamento | RPC |
| 11 | Flag `ccm_result_protection_enabled` = false | Config |

## 13. ESTRUTURAS REUTILIZÁVEIS

| Estrutura | Reuso |
|---|---|
| `ccm_configs` + `save_ccm_config()` | Novas configs e flag |
| `ccm_config_history` | Auditoria de mudanças de config |
| `order_events` | Eventos econômicos (credit_generated, result_locked, etc.) |
| `supplier_request_lines.unit_cost_centavos / cost_confirmed_centavos` | Fonte de dados da gordura |
| `order_items.supplier_cost_centavos` | Custo snapshot já persiste |
| `supplier_purchase_orders.freight_centavos` | Frete PO já rastreado |
| Padrão `is_ccm_*_enabled()` | Padrão para nova flag |
| Padrão `payment_lock` CAS | Referência para concorrência |

## 14. RISCOS ESTRUTURAIS

**NENHUM RISCO BLOQUEANTE DETECTADO:**
- Nenhuma estrutura existente conflita com o novo ledger
- Nenhum mecanismo duplicado para merge
- O par assumed/confirmed cost está limpo e reutilizável
- O fluxo de pagamento tem ponto de integração claro
- Não há cálculo econômico existente que possa ser corrompido
