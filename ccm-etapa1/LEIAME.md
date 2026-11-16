# CCM — Etapa 1: regras de negócio + testes

Código de referência das regras aprovadas na Etapa 1 ("Do catálogo do fornecedor para a venda").
Fonte oficial: documento **CCM — Estrutura de Operação da Plataforma — Etapa 1**.

## O que é
- Funções **puras** em TypeScript: sem banco, sem tela, sem framework.
- O programador encaixa no sistema: grava no banco, monta as telas e chama estas funções.
- **Os testes são o critério de aceite.** Cada teste é um exemplo do documento.

## Rodar os testes
```
node --test test/etapa1.test.ts
```
Node 22.18 ou superior (roda TypeScript direto). Resultado esperado: 23 testes passando.

## Regra → função
| Regra | Função |
|---|---|
| R1.1 cadastro do fornecedor | `validarFornecedor` |
| R2.1 / R2.2 produto e custo por unidade | `normalizarProduto`, `custoUnitario` |
| R3 modos de venda | `modosPermitidos`, `validarModoVenda`, `opcoesNoSite` |
| R3.4 sobra | `compraParaUnidades` |
| R4.1 / R4.2 ciclo e prazo no CD | `proximoDiaPedido`, `dataDisponivelCd` |
| R4.3 pedido mínimo | `avaliarPedidoMinimo` |
| R5 preço e limite por seção | `precoVenda`, `avaliarMudancaPreco` |
| R6 troca de fornecedor e relatório | `trocarFornecedor`, `linhasRelatorioDiario` |
| Histórico de configuração | `registrarAlteracao` |

## Como encaixar
1. Os tipos em `src/tipos.ts` viram as tabelas/coleções do banco (mesmos nomes de campo).
2. As configurações (`ConfigSecao`, `ConfigGeral`) vêm do painel de configurações de venda — nunca fixas no código.
3. Ao mudar o preço de custo de um produto: `precoVenda` → `avaliarMudancaPreco` → aplicar ou criar notificação.
4. Ao estoque do fornecedor ativo zerar: `trocarFornecedor` → gravar `textoFicha` na ficha interna (não enviar nada ao fornecedor) → recalcular preço (passo 3) → guardar para o relatório do dia.
5. No horário de corte de cada dia de pedido: somar as vendas do fornecedor → `avaliarPedidoMinimo` → enviar ou notificar.

## A confirmar com o Rodrigo
- **Critério da troca automática (R6):** hoje escolhe o fornecedor com **menor custo por unidade e estoque > 0**.
- **Horário de corte do ciclo (R4.1):** criado como configuração geral (`horarioCorteCiclo`).
