# CCM — Estrutura de Operação da Plataforma — Etapa 1

Especificação para implementação · Etapa 1 · 06/11/2026

> Fonte oficial: documento "CCM — Estrutura de Operação da Plataforma — Etapa 1" (aprovado pelo gestor).
> Os testes em `ccm-etapa1/test/etapa1.test.ts` (23 testes) são o critério de aceite.

## Como usar este documento

- Cada regra tem um código (ex.: R3.2) e um exemplo.
- Se a descrição e o exemplo parecerem diferentes, **vale o exemplo**.
- Valores marcados [config] não ficam fixos no código: são editados no painel de configurações de venda.
- **Só está descrito o que foi aprovado. Não implementar nada além do que está aqui.**

## Contexto

A CCM compra de fornecedores e revende ao cliente. O fornecedor envia o catálogo. A CCM decide o que vende, como vende e por quanto. **O fornecedor nunca aparece para o cliente.**

## Glossário

| Termo | Significado |
|---|---|
| Fornecedor | Empresa de quem a CCM compra |
| Produto do fornecedor | Um item do catálogo de um fornecedor, com o custo e as condições dele |
| Fornecedor ativo | O fornecedor de quem a CCM está comprando aquele produto no momento |
| Seção | Departamento do site (ex.: Elétrica, Hidráulica, Ferramentas) |
| Ciclo | Dia fixo em que a CCM envia o pedido de compra a um fornecedor |
| Sobra | Unidades que a CCM comprou a mais por o fornecedor só vender caixa |

## 1. Cadastro do fornecedor

### Dados

| Campo | Tipo | Exemplo |
|---|---|---|
| nome | texto | Tambasa |
| pedido_minimo_tipo | valor \| volume | valor |
| pedido_minimo | número | 500,00 |
| dias_pedido | lista de dias da semana | [terça, sexta] |
| prazo_entrega_cd_dias | número (dias úteis após o pedido) | 2 |
| frete_tipo | gratis_acima \| fixo | gratis_acima |
| frete_gratis_acima | número | 1000,00 |
| frete_valor | número | 60,00 |

### Regras

**R1.1** Todos os campos acima são obrigatórios para o fornecedor ficar ativo.

**Exemplo:**
- Certo: Tambasa · pedido mínimo R$ 500 · pede terça e sexta · entrega no CD 2 dias úteis depois · frete grátis acima de R$ 1.000, senão R$ 60
- Errado: Ativar fornecedor sem dias de pedido cadastrados

## 2. Cadastro do produto do fornecedor

### Dados

| Campo | Tipo | Exemplo |
|---|---|---|
| fornecedor | referência ao fornecedor | Tambasa |
| descricao | texto | Tomada 2P+T 10A branca |
| custo | número (custo da unidade de compra) | 62,00 |
| unidade_compra | unidade \| caixa \| fardo \| rolo | caixa |
| qtd_por_embalagem | número inteiro (1 se unidade) | 10 |
| vende_avulso | sim \| não | não |

### Regras

**R2.1** Se unidade_compra = unidade, qtd_por_embalagem = 1 e vende_avulso = sim.

**R2.2** Custo da unidade avulsa = custo ÷ qtd_por_embalagem.

**Exemplo — custo por unidade:**
- Certo: Caixa com 10 a R$ 62,00 → custo por unidade R$ 6,20
- Errado: Tratar R$ 62,00 como custo de uma unidade

## 3. Modo de venda

Cada produto à venda tem um modo de venda.

| Modo | Quando usar | O cliente vê no site |
|---|---|---|
| por_unidade | vende_avulso = sim | Preço da unidade |
| embalagem_fechada | vende_avulso = não | Só a embalagem: "Caixa com 10 un." |
| unidade_e_caixa | vende_avulso = não e a direção aprovou vender avulso | Duas opções: unidade e caixa com desconto |
| nao_vender | Condição de compra não permite | Nada (produto fora do site) |

### Regras

**R3.1** O modo unidade_e_caixa só pode ser ativado por usuário com permissão de direção.

**R3.2** Desconto da caixa no modo unidade_e_caixa: [config] por seção, com exceção por produto.

**R3.3** Teto de valor parado em sobra: [config]. Com o teto atingido, o sistema bloqueia ativar novos produtos em unidade_e_caixa.

**R3.4** Quando o cliente compra unidades avulsas, a CCM compra caixas inteiras. A diferença entra como sobra no estoque da CCM.

**Exemplo — unidade_e_caixa:**
- Configuração: Fita isolante · caixa com 10 · preço da unidade R$ 9,90 · desconto da caixa 10%
- Site: "1 un. — R$ 9,90" e "Caixa com 10 — R$ 89,10 (10% off)"
- Sobra: Cliente compra 3 un. → CCM compra 1 caixa → 7 un. entram como sobra
- Borda: Cliente compra 12 un. → CCM compra 2 caixas → 8 un. de sobra

## 4. Compra por ciclo

### Regras

**R4.1** As vendas de cada fornecedor se acumulam e viram um pedido de compra no próximo dia de pedido (dias_pedido). Horário de corte: 17h30 [config] — venda num dia de pedido até 17h29 entra no pedido do mesmo dia; a partir de 17h30, no próximo.

**R4.2** Prazo mostrado ao cliente = próximo dia de pedido + prazo_entrega_cd_dias.

**R4.3** No dia do ciclo, se o total for menor que pedido_minimo, o pedido de compra não é enviado e a equipe recebe notificação com as opções: [Completar pedido] [Enviar pagando a diferença/frete] [Esperar próximo ciclo].

**Exemplo — prazo com ciclo:**
- Entrada: Venda na quarta · Tambasa: dias_pedido [terça, sexta] · prazo_entrega_cd_dias 2
- Certo: Próximo dia de pedido: sexta → chega no CD terça → cliente vê "disponível no CD a partir de terça"
- Errado: Mostrar "2 dias úteis" a partir da venda, ignorando o ciclo
- Borda: Venda na sexta às 17h29 → pedido de sexta. Venda na sexta às 18h00 → pedido de terça

**Exemplo — pedido mínimo não atingido:**
- Entrada: Sexta · vendas acumuladas da Tambasa: R$ 380 · pedido mínimo R$ 500
- Certo: Pedido não é enviado. Notificação: "Tambasa: R$ 380 de R$ 500. [Completar] [Enviar pagando diferença] [Esperar terça]"

## 5. Preço

### Regras

**R5.1** Preço de venda = custo do fornecedor ativo + regra de preço da seção [config].

**R5.2** Cada seção tem um limite de aumento automático em % [config].

**R5.3** Se o novo preço for até o limite da seção acima do preço atual, o preço muda sozinho.

**R5.4** Se passar do limite, o preço não muda e o responsável recebe notificação com [Aprovar] [Tirar da venda].

**R5.5** Redução de preço muda sempre sozinha.

**Exemplo — limite por seção:**
- Configuração: Seção Elétrica: limite 8%
- Caso 1: Disjuntor R$ 24,90 → R$ 26,50 (+6,4%) → muda sozinho
- Caso 2: Ventilador R$ 289,00 → R$ 329,00 (+13,8%) → continua R$ 289,00. Notificação: "Ventilador Fame 130W: preço subiria de R$ 289 para R$ 329 (+13,8%). [Aprovar] [Tirar da venda]"
- Borda: Aumento de exatamente 8,0% → muda sozinho

## 6. Troca de fornecedor

### Regras

**R6.1** Quando o fornecedor ativo não tem mais o produto, o sistema troca sozinho para o fornecedor com menor custo por unidade entre os que têm estoque do mesmo produto.

**R6.2** A troca fica registrada só internamente, na ficha do fornecedor que perdeu o produto. Nada é enviado ao fornecedor.

**R6.3** Se a troca aumentar o preço, vale a regra R5.3 / R5.4.

**R6.4** Toda troca aparece no relatório do fim do dia: produto, fornecedor anterior, fornecedor novo, motivo, data e hora.

**Exemplo — troca:**
- Certo: Tambasa fica sem o Ventilador Fame 130W → Fornecedor B assume. Ficha da Tambasa: "06/11 14:32 — perdeu Ventilador Fame 130W: sem estoque". Relatório do dia: "Ventilador Fame 130W · Tambasa → Fornecedor B · sem estoque · 14:32"
- Errado: Enviar mensagem à Tambasa avisando da troca

## Configurações desta etapa

| Configuração | Nível | Regra |
|---|---|---|
| Regra de preço | Por seção | R5.1 |
| Limite de aumento automático (%) | Por seção | R5.2 |
| Desconto da caixa (%) | Por seção, com exceção por produto | R3.2 |
| Teto de valor parado em sobra (R$) | Geral | R3.3 |
| Horário de corte do ciclo (17h30) | Geral | R4.1 |

**Toda alteração de configuração grava quem alterou, quando e o valor anterior.**
