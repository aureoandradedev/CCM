# CCM · Central de Compras Multigiro

E-commerce de material de construção com **preço de varejo e de atacado**, entregue **direto dos fornecedores parceiros** (o CCM não mantém estoque próprio).

Referências visuais estudadas: Obramax (estrutura e varejo/atacado), Telhanorte (energia promocional, atalhos, Pix), Deca e Portobello (tipografia editorial e galeria de ambientes).

## Rodando

```bash
npm install
cp .env.example .env.local   # opcional: preencha as chaves do Supabase
npm run dev                  # http://localhost:3000
```

Sem `.env.local` o site usa o catálogo de exemplo em `src/lib/data/mock.ts` (55 produtos, 10 departamentos).

## Supabase

1. Crie o projeto e rode `supabase/migrations/0001_init.sql` no SQL Editor.
2. Rode `supabase/seed.sql` para carregar categorias, marcas, fornecedores, produtos e banners.
3. Preencha `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` em `.env.local`.

O schema já prevê `suppliers`, `orders`/`order_items` (uma remessa por fornecedor), `profiles`/`addresses` com RLS e busca full-text sem acento (`search_products`).

## Scripts

| comando             | o que faz                                   |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | servidor de desenvolvimento (Turbopack)     |
| `npm run build`     | build de produção                           |
| `npm run typecheck` | `tsc --noEmit`                              |
| `npm run lint`      | ESLint                                      |
| `npm run seed:gen`  | regenera `supabase/seed.sql` a partir do mock |

## Próximas fases

- Supabase Auth (login/cadastro, Meus pedidos reais)
- Criação de pedidos no banco + notificação ao fornecedor
- Integração de catálogo/estoque com fornecedores (API, planilha ou ERP)
- Pagamentos (Pix/cartão) e frete cotado por fornecedor
- Painel do fornecedor e painel admin

Mais detalhes de arquitetura e convenções em `CLAUDE.md`.
