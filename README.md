# CCM · Central de Compras Multigiro

E-commerce da Multigiro Central de Compras. **A CCM compra dos fornecedores e revende (modelo 1P)**: o fornecedor envia catálogo e estoque; a CCM decide o que vende, o modo de venda e o preço; a CCM emite a nota fiscal e entrega (ou o cliente retira no CD da CCM). O fornecedor nunca aparece para o cliente.

Referências visuais estudadas: Obramax (estrutura e varejo/atacado), Telhanorte (energia promocional, atalhos, Pix), Deca e Portobello (tipografia editorial e galeria de ambientes).

## Rodando

```bash
npm install
cp .env.example .env.local   # opcional: preencha as chaves do Supabase
npm run dev                  # http://localhost:3000
```

Sem `.env.local` o site usa o catálogo de exemplo em `src/lib/data/mock.ts` (55 produtos, 10 departamentos).

## Supabase (banco, login, pedidos)

1. Crie o projeto e rode `supabase/migrations/0001_init.sql` no SQL Editor (schema completo: perfis com papel `admin`, fornecedores, catálogo, banners, campanhas, configurações, pedidos, eventos, leads, RLS e buckets `produtos`/`banners`).
2. Preencha `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `NEXT_PUBLIC_API_BASE` em `.env.local` (modelo em `.env.example`).
3. Importe o catálogo de teste e as fotos reais (QRofertas) pelo backend: `cd backend && npm run importar -- --imagens`.
4. Cadastre-se na loja (`/conta`) e torne a conta administradora: `cd backend && npm run admin -- --email seu@email`.

Sem `.env.local` o site continua funcionando com o mock (sem login, sem pedidos reais).

## Backend (`backend/`)

Servidor Express separado do site (roda na VPS ou local em `http://localhost:4000`). Faz o que não pode ficar no navegador:

- **Pedidos**: `POST /api/pagamentos/criar-pedido` recalcula preços, descontos (Pix, primeira compra, por seção) e frete no servidor e grava com service role. Consulta sem login em `POST /api/pagamentos/consultar-pedido` (CPF/CNPJ + código).
- **Pagamentos Cielo** (porte fiel do e-commerce do mercado): Pix com QR + webhook + polling, cartão de crédito/débito com Silent Order Post e 3DS 2.2, lock idempotente, estorno. `PAGAMENTO_MOCK=true` simula tudo em desenvolvimento.
- **Fotos de produto**: busca no QRofertas (módulos do motor de encartes), valida os bytes e sobe no Storage. Botões no admin e lote em segundo plano.
- **Scripts**: `npm run importar` (catálogo mock → banco, `--imagens` busca fotos), `npm run admin -- --email x [--revogar]`.

```bash
cd backend
npm install
cp .env.example .env     # chaves Supabase (service role), Cielo e QRofertas
npm run dev              # http://localhost:4000/api/status
```

## Painel admin (`/admin`)

Só para contas com `profiles.role = 'admin'`. Mesmas funções do painel do mercado: painel com KPIs do dia e do mês, pedidos por status (fluxo aguardando pagamento → em separação → separado → finalizado/pagamento pendente → arquivado) com filtros, detalhe, confirmar pagamento, arquivar/reabrir, desconsiderar, cancelar, imprimir/recibo, WhatsApp, estorno e limpeza de expirados; fechamento de caixa (vendido/recebido/falta, por forma de pagamento, duplicados, CSV, copiar resumo); BI de faturamento por ano/mês/dia com auditoria; produtos (CRUD, upload WebP no Storage, foto do QRofertas, duplicar, tirar de oferta, estoque e limite por pedido); ofertas colando lista; campanhas programadas com banners; conteúdo do site (carrossel, bloqueio de entregas, aviso do topo, mais vendidos); descontos; clientes e leads; categorias; fornecedores; configurações (frete, administradores).

## Scripts

| comando             | o que faz                                   |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | servidor de desenvolvimento (Turbopack)     |
| `npm run build`     | build de produção                           |
| `npm run typecheck` | `tsc --noEmit`                              |
| `npm run lint`      | ESLint                                      |
| `npm run seed:gen`  | regenera `supabase/seed.sql` a partir do mock |

## Próximas fases

- Ativação automática de campanhas por horário (hoje: botão "Ativar agora" no admin)

Mais detalhes de arquitetura e convenções em `CLAUDE.md`.
