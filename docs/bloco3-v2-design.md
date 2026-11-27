# BLOCO 3 V2 — DESIGN FINAL

## PRINCÍPIOS ARQUITETURAIS

1. **Tudo em centavos inteiros** — zero float, zero rounding issues
2. **Append-only ledger** — crédito NUNCA é editado, só compensado por nova entrada
3. **FOR UPDATE + idempotency_key** — atomicidade em todas operações de crédito
4. **Fail-closed** — flag OFF = tudo bypass, nenhum gate bloqueia
5. **Cliente NUNCA vê** — gordura, crédito, custo, resultado, frete fornecedor
6. **Decisões comerciais abertas** — NÃO inventar (prazo, inadimplência, frete "conforme chega", prazo final)

---

## 1. SCHEMA: credit_ledger

```sql
CREATE TABLE public.credit_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  entry_type      text NOT NULL CHECK (entry_type IN (
    'credit_generated',    -- gordura: assumed > confirmed
    'credit_reserved',     -- reserva atômica para desconto
    'credit_used',         -- confirmação de uso (pós-pagamento)
    'credit_released',     -- liberação de reserva não usada
    'credit_adjusted',     -- ajuste administrativo
    'credit_reversed'      -- reversão de crédito gerado (ex: cancelamento)
  )),
  amount_centavos int NOT NULL,  -- positivo = entrada, negativo = saída
  balance_after   int NOT NULL,  -- saldo global APÓS esta entrada
  source_type     text,          -- 'supplier_confirmation', 'backup_cost_diff', 'admin_adjustment'
  source_id       uuid,          -- supplier_request_id, supplier_request_line_id, etc.
  target_type     text,          -- 'order_discount' quando usado
  target_id       uuid,          -- order_id beneficiado
  idempotency_key text NOT NULL,
  actor_id        uuid,
  actor_kind      text NOT NULL DEFAULT 'system',
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cl_idempotency UNIQUE (idempotency_key),
  CONSTRAINT cl_amount_nonzero CHECK (amount_centavos != 0)
);

CREATE INDEX idx_cl_order ON public.credit_ledger(order_id);
CREATE INDEX idx_cl_type ON public.credit_ledger(entry_type);
CREATE INDEX idx_cl_created ON public.credit_ledger(created_at DESC);
```

**Invariante**: `balance_after` de cada entrada = `balance_after` da entrada anterior + `amount_centavos` desta.
Calculado via `SELECT balance_after FROM credit_ledger ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`.

## 2. SCHEMA: order_result_locks

```sql
CREATE TABLE public.order_result_locks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  
  -- Receita
  revenue_centavos      int NOT NULL,       -- total_centavos do pedido (o que o cliente paga)
  
  -- Custos
  cost_centavos         int NOT NULL,       -- soma dos custos confirmados dos itens
  freight_allocated_centavos int NOT NULL,  -- frete PO rateado para este pedido
  
  -- Descontos
  discount_commercial_centavos int NOT NULL, -- Pix, primeira compra, seção
  discount_credit_centavos     int NOT NULL, -- desconto financiado por crédito
  
  -- Resultado
  result_centavos       int NOT NULL,       -- receita - custos - frete_rateado - descontos
  minimum_result_centavos int NOT NULL,     -- threshold vigente no momento
  result_approved       boolean NOT NULL,   -- resultado >= mínimo
  
  -- Crédito
  credit_reserved_centavos int NOT NULL DEFAULT 0,  -- crédito reservado (ledger entry id)
  credit_ledger_entry_id   uuid REFERENCES public.credit_ledger(id),
  
  -- Auditoria
  approved_by           uuid,               -- NULL = auto-approved, NOT NULL = manual
  approved_at           timestamptz NOT NULL DEFAULT now(),
  
  -- Snapshot completo para auditoria
  snapshot              jsonb NOT NULL,      -- {items, costs, freight_detail, discounts_detail, ...}
  
  created_at            timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT orl_one_per_order UNIQUE (order_id)
);
```

## 3. SCHEMA: order_freight_allocations

```sql
CREATE TABLE public.order_freight_allocations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  purchase_order_id     uuid NOT NULL REFERENCES public.supplier_purchase_orders(id),
  supplier_id           text NOT NULL REFERENCES public.suppliers(id),
  
  -- Rateio
  po_freight_centavos   int NOT NULL,       -- frete total do PO
  order_cost_centavos   int NOT NULL,       -- custo dos itens deste pedido neste PO
  po_total_cost_centavos int NOT NULL,      -- custo total de todos os itens do PO
  allocated_centavos    int NOT NULL,       -- frete rateado para este pedido
  
  -- Fechamento
  is_remainder          boolean NOT NULL DEFAULT false,  -- último pedido recebe o "troco"
  
  idempotency_key       text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT ofa_idempotency UNIQUE (idempotency_key),
  CONSTRAINT ofa_one_per_order_po UNIQUE (order_id, purchase_order_id)
);
```

**Rateio proporcional com fechamento exato**:
- Para cada PO, somar custo de cada pedido naquele PO
- `allocated = FLOOR(po_freight * order_cost / po_total_cost)`
- Último pedido (is_remainder=true): `allocated = po_freight - SUM(demais)`
- Garante: `SUM(allocated) = po_freight` (centavo exato)

## 4. COLUNAS ADICIONAIS

```sql
-- orders: rastreabilidade de descontos separados
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS discount_commercial_centavos int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_credit_centavos     int NOT NULL DEFAULT 0;

-- orders: resultado protegido
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS result_locked_at   timestamptz,
  ADD COLUMN IF NOT EXISTS result_lock_id     uuid REFERENCES public.order_result_locks(id);
```

## 5. ccm_configs

```sql
INSERT INTO public.ccm_configs (key, scope, value)
VALUES
  ('ccm_result_protection_enabled', 'global', 'false'::jsonb),
  ('minimum_order_result_centavos', 'global', '0'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;
```

Helper:
```sql
CREATE OR REPLACE FUNCTION public.is_ccm_result_protection_enabled()
RETURNS boolean ...
```

## 6. RPCs ECONÔMICAS

### 6.1 generate_credit_from_confirmation(p_supplier_request_id uuid)

Chamada por `confirm_supplier_request_v2` APÓS confirmação.

```
Para cada linha confirmada:
  gordura = (unit_cost_centavos - cost_confirmed_centavos) * quantity_confirmed
  Se gordura > 0:
    INSERT INTO credit_ledger (credit_generated, +gordura, source=supplier_request_line)
  Se gordura < 0:
    -- Custo subiu: registrar como informação (NÃO gera crédito negativo)
    -- O overrun é absorvido pelo resultado do pedido
```

Idempotency key: `credit:gen:{supplier_request_line_id}`

### 6.2 reserve_credit(p_order_id uuid, p_amount int)

Reserva atômica de crédito para desconto.

```
BEGIN;
  SELECT balance_after FROM credit_ledger ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE;
  IF saldo < p_amount → RETURN error 'saldo insuficiente'
  INSERT INTO credit_ledger (credit_reserved, -p_amount, balance_after = saldo - p_amount)
  RETURN ok + ledger_entry_id
COMMIT;
```

Idempotency key: `credit:reserve:{order_id}:{amount}`

### 6.3 use_credit(p_ledger_entry_id uuid)

Confirma uso do crédito reservado (pós-pagamento).

```
Verifica que entry_type = 'credit_reserved'
INSERT INTO credit_ledger (credit_used, source_id = p_ledger_entry_id, amount = 0)
-- Não muda saldo (já foi subtraído na reserva)
```

### 6.4 release_credit(p_ledger_entry_id uuid)

Libera reserva não usada (cancelamento, timeout).

```
Busca a reserva
INSERT INTO credit_ledger (credit_released, +amount_original, balance_after = saldo + amount)
```

### 6.5 compute_order_result(p_order_id uuid)

Calcula resultado econômico do pedido.

```
receita = orders.total_centavos
custos = SUM(supplier_request_lines.cost_confirmed_centavos * qty_confirmed)
         para linhas com status confirmado/confirmado_parcial
frete_rateado = SUM(order_freight_allocations.allocated_centavos)
desconto_comercial = orders.discount_centavos (Pix, primeira compra, seção)
desconto_credito = orders.discount_credit_centavos

resultado = receita - custos - frete_rateado - desconto_comercial - desconto_credito
```

RETURN: `{receita, custos, frete_rateado, desconto_comercial, desconto_credito, resultado, minimo, aprovado}`

### 6.6 lock_order_result(p_order_id uuid, p_approved_by uuid DEFAULT NULL)

Congela resultado econômico.

```
1. Chama compute_order_result
2. Se resultado < minimum → result_approved = false
3. INSERT INTO order_result_locks (snapshot completo)
4. UPDATE orders SET result_locked_at, result_lock_id
5. INSERT INTO order_events (type = 'result_locked')
6. RETURN {lock_id, result, approved}
```

### 6.7 allocate_freight_for_order(p_order_id uuid)

Aloca frete dos POs ao pedido.

```
Para cada supplier do pedido:
  Encontrar PO ativo (via supplier_requests → supplier_purchase_orders)
  Calcular custo dos itens deste pedido neste PO
  Calcular custo total do PO
  allocated = FLOOR(po_freight * order_cost / po_total_cost)
  INSERT INTO order_freight_allocations
  
Ajuste de fechamento:
  Último pedido do PO recebe o resto: po_freight - SUM(alocados_anteriores)
```

### 6.8 check_economic_gate(p_order_id uuid)

Gate econômico integrado ao fluxo de confirmação → pagamento.

```
IF NOT is_ccm_result_protection_enabled() → RETURN {ok: true, bypassed: true}

1. allocate_freight_for_order (se não alocado)
2. compute_order_result
3. Se resultado < minimum_order_result_centavos:
   - INSERT INTO order_events (type = 'result_below_minimum')
   - INSERT INTO order_notification_outbox (team escalation)
   - RETURN {ok: false, reason: 'result_below_minimum', resultado, minimo}
4. lock_order_result
5. RETURN {ok: true, lock_id, resultado}
```

## 7. INTEGRAÇÃO NO FLUXO EXISTENTE

### Ponto de integração: antes de `aguardando-pagamento`

Nos locais que avançam o status para `aguardando-pagamento`:
- `0058:577` (all resolved, no adjustments)
- `0069:636` (gate: advance after all confirmed)
- `0069:703` (gate: advance after all confirmed)
- `0069:791` (gate: advance if not blocked)
- `0057:452` (accept_order_adjustments)

**Adicionar**: antes de `UPDATE orders SET order_status = 'aguardando-pagamento'`:
```sql
IF is_ccm_result_protection_enabled() THEN
  v_gate := check_economic_gate(order_id);
  IF NOT (v_gate->>'ok')::boolean THEN
    -- NÃO avança para pagamento
    -- Escala para equipe
    RETURN jsonb_build_object('ok', false, 'reason', v_gate->>'reason');
  END IF;
END IF;
```

### Ponto de integração: confirmação de fornecedor

Em `confirm_supplier_request_v2` (`0069:262`):
- APÓS atualizar `cost_confirmed_centavos`:
```sql
IF is_ccm_result_protection_enabled() THEN
  PERFORM generate_credit_from_confirmation(p_request_id);
END IF;
```

### Ponto de integração: backup supplier

Quando backup supplier confirma com custo diferente:
- O custo maior reduz o resultado
- Se a gordura do supplier original gerou crédito, pode compensar

## 8. MOTOR DE DESCONTOS (separação)

```
orders.discount_centavos = discount_commercial + discount_credit

discount_commercial = Pix + primeira_compra + seção (já existe em calcularTotais)
discount_credit = desconto financiado por crédito (NOVO)
```

O crédito só é aplicado se:
1. Crédito disponível (saldo no ledger)
2. Resultado ficaria acima do mínimo APÓS aplicar
3. Admin habilitou (futuro: motor de regras de quando aplicar)

**POR ENQUANTO**: desconto crédito = 0. A mecânica existe mas sem regra de aplicação automática (decisão comercial aberta).

## 9. FEATURE FLAG

`ccm_result_protection_enabled = false` (default)

Quando OFF:
- Nenhum gate econômico
- Nenhum cálculo de resultado
- Nenhum lock
- `generate_credit_from_confirmation` gera entradas no ledger (para acúmulo) mas não bloqueia nada
- Fluxo original intacto

Quando ON:
- Gate econômico obrigatório antes de `aguardando-pagamento`
- Resultado calculado e congelado
- Resultado abaixo do mínimo escala para equipe
- Crédito pode ser usado para desconto (se regra configurada)

## 10. DECISÕES COMERCIAIS ABERTAS (NÃO IMPLEMENTAR)

| # | Decisão | Status |
|---|---|---|
| 1 | Cliente frequente que não paga | ABERTO — sem penalidade automática |
| 2 | Cliente pagou mas fornecedor não tem | ABERTO — sem compensação automática |
| 3 | Frete "conforme chega" | ABERTO — sem rateio dinâmico |
| 4 | Prazo final de pagamento | ABERTO — sem deadline |

---

## FASES DE IMPLEMENTAÇÃO

### Fase B: Schema + migrations + flags
- Migration 0076: credit_ledger, order_result_locks, order_freight_allocations
- Novas colunas em orders
- ccm_configs + helper function
- RLS + indexes

### Fase C: RPCs econômicas
- generate_credit_from_confirmation
- reserve_credit / use_credit / release_credit
- compute_order_result
- lock_order_result
- allocate_freight_for_order
- check_economic_gate

### Fase D: Backend
- Integrar gate econômico nos pontos de avanço para aguardando-pagamento
- Integrar geração de crédito na confirmação
- Separar descontos comerciais de crédito

### Fase E: Frete/rateio
- Lógica de rateio proporcional com fechamento exato
- Wire no fluxo de PO

### Fase F: Frontend
- Admin panel: resultado econômico por pedido
- Admin panel: saldo de crédito
- Admin panel: freight allocation view
- Compras: escalation quando resultado abaixo do mínimo

### Fase G: E2E + concorrência + browser
- Teste 100 reservas concorrentes
- Teste rateio com fechamento exato
- Teste gate econômico (flag ON/OFF)
- Teste crédito gerado e liberado
- Browser QA

### Fase H: Regressão + segurança + commits + push
- npm test + typecheck + build
- Flag OFF regression
- Security: RLS, REVOKE, customer isolation
- Commit + push feature/pedro
