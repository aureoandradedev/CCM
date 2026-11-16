@AGENTS.md

# CCM · Central de Compras Multigiro

E-commerce da Multigiro Central de Compras. **A CCM compra dos fornecedores e revende (modelo 1P)**: o fornecedor envia catálogo e estoque; a CCM decide o que vende, o modo de venda e o preço; a CCM emite a nota fiscal e entrega (ou o cliente retira no CD da CCM). **O fornecedor nunca aparece para o cliente.** Regras de negócio aprovadas: `docs/etapas/` — os testes de cada etapa são o critério de aceite. Não implementar nada além do que está aprovado nas etapas.

## Stack

- Next.js 16 (App Router, Turbopack, `proxy.ts` no lugar de middleware, `params`/`searchParams` são Promise)
- React 19 · TypeScript estrito · Tailwind v4 · shadcn/ui v4 (**Base UI**, não Radix: use `render={<Link/>}` em vez de `asChild`)
- GSAP + `@gsap/react` (`src/lib/gsap.ts` registra plugins; `<Reveal>` para entrada em cascata)
- Zustand (carrinho persistido em `localStorage`, hidratado manualmente em `Providers`)
- Sonner (toasts), lucide-react (ícones; marcas sociais em `ui/social-icons.tsx`), embla (carrosséis)
- Supabase (`@supabase/ssr`): opcional. Sem `.env.local` o site roda com `src/lib/data/mock.ts`

## Comandos

```bash
npm run dev        # http://localhost:3000
npm run build
npm run typecheck  # tsc --noEmit
npm run lint
npm run seed:gen   # regenera supabase/seed.sql a partir do mock

cd backend && npm run dev                  # backend Express em :4000 (pedidos, Cielo, fotos)
cd backend && npm run importar -- --imagens # mock → Supabase + fotos reais do QRofertas
cd backend && npm run admin -- --email x    # torna a conta admin
```

## Estrutura

- `src/app` rotas: `/`, `/categoria/[slug]`, `/produto/[slug]`, `/busca`, `/ofertas`, `/atacado`, `/departamentos`, `/carrinho`, `/checkout`, `/conta`, `/orcamento`, `/marcas`, institucionais
- `src/lib/data/catalog.ts` **única** camada de dados (Supabase ou mock). Páginas nunca acessam o banco direto.
- `src/lib/pricing.ts` regras de preço (varejo/atacado/Pix/parcelas). Usar sempre, nunca recalcular na UI.
- `src/lib/cart/store.ts` carrinho (snapshot do produto por linha; servidor revalida no pedido)
- `src/lib/utils/{format,masks,search}.ts` moeda, CPF/CNPJ/CEP/telefone, busca sem acento com ranking (portados do Multigiro)
- `src/components/{layout,home,product,catalog,cart,checkout,account,motion,ui}`
- `src/app/conta/*` conta do cliente (login/cadastro/recuperação via Supabase Auth em `conta/actions.ts`, pedidos, dados, senha). `src/proxy.ts` renova a sessão e redireciona não logados de `/admin` e `/conta/(pedidos/|dados|senha)`.
- `src/app/admin/*` painel admin (layout exige `role = admin` via `src/lib/admin/guard.ts`). Leituras em `src/lib/admin/data.ts` (sessão do admin + RLS), mutações em `src/app/admin/actions.ts` (server actions). Componentes em `src/components/admin`. A moldura da loja some no admin via `[data-site-chrome]` + `.admin-root` (globals.css).
- `src/lib/api.ts` cliente do backend (`NEXT_PUBLIC_API_BASE`, Bearer da sessão Supabase). `src/lib/payments/card-core.ts` tokenização Cielo (SOP + 3DS) no navegador. `src/components/checkout/{payment-step,pix-panel,card-panel}.tsx` etapa de pagamento.
- `src/lib/orders.ts` rótulos/tipos de pedido compartilhados (conta + admin).
- `backend/` Express separado: `lib/pedido.mjs` (criação, totais, descontos, bloqueio de entrega), `lib/pagamentos.mjs` + `lib/cielo.mjs` + `lib/payment-lock.mjs` (porte fiel do mercado), `lib/imagens.mjs` + `lib/qrofertas/` (fotos), `routes/*`, `scripts/*`. Config em `backend/.env` (nunca versionar; chaves ficam só lá).
- `supabase/migrations/0001_init.sql` schema + RLS + buckets; `supabase/seed.sql` gerado

## Marca

- Nome ao cliente: **Multigiro Central de Compras** ("CCM" só como apelido interno e prefixo de pedido).
- Assets em `public/brand/`: `logo-multigiro.webp` (wordmark), `mascote-capacete-alpha.png` (mascote com prancheta), `mascote-bone-alpha.png` (braços abertos), `mascote-head.png` (favicon/ícone).
- Cores tiradas da identidade: amarelo `#f9c400`, azul `#0060c8`, azul escuro `#0a3f94` (tokens em `globals.css`).

## Abertura (intro)

- `src/components/intro/intro-loader.tsx`: mascote dá duas marteladas, vira, apresenta e o "CCM" surge. 8 quadros em `public/brand/intro/frame-N.webp` (fatiados da sprite sheet de 8 poses com Pillow, pés alinhados, 341x520). A versão de 16 quadros foi testada e descartada pelo Pedro: não reintroduzir.
- Roda uma vez por sessão (`sessionStorage.ccm_intro_seen`); um `next/script beforeInteractive` no layout esconde a overlay para quem já viu. Para rever: `sessionStorage.removeItem("ccm_intro_seen")` e recarregar.
- Clique/toque/Esc pula; `prefers-reduced-motion` mostra só o quadro final + nome.

## Convenções

- Texto da interface em pt-BR, sem emoji como ícone.
- Tokens de cor só via classes `brand-*`/variáveis (`globals.css`). Nunca hex solto em componente.
- Animação: só `transform`/`opacity`, curvas `--ease-out`/`--ease-in-out`, < 300 ms em UI, respeitar `prefers-reduced-motion`, hover só com `@media (hover: hover)`.
- Filtros de listagem são LINKS (URL é o estado). Ver `src/lib/catalog-params.ts`.
- Antes de entregar: `npm run typecheck` e testar 375 px / 768 px / 1440 px.
- Pedidos e pagamentos nunca são criados pelo site direto no banco: sempre pelo backend (service role). O site só lê (RLS).
- Chaves (Supabase service role, Cielo, QRofertas) só em `backend/.env`; o Pedro preenche à mão, nunca copiar de outro projeto.
- Git: trabalhar só em `feature/pedro` (conferir `git branch --show-current`); nunca mexer em `main`/`feature/aureo` nem fazer merge sem pedido.
