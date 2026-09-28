@AGENTS.md

# CCM · Central de Compras Multigiro

E-commerce de material de construção da Multigiro. Diferencial do negócio: **não tem estoque próprio**, cada produto pertence a um fornecedor parceiro que fatura e entrega (integração com fornecedores é fase futura). Preço **varejo x atacado** por quantidade (modelo Obramax), desconto no Pix, entrega direto do fornecedor.

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
```

## Estrutura

- `src/app` rotas: `/`, `/categoria/[slug]`, `/produto/[slug]`, `/busca`, `/ofertas`, `/atacado`, `/departamentos`, `/carrinho`, `/checkout`, `/conta`, `/orcamento`, `/marcas`, institucionais
- `src/lib/data/catalog.ts` **única** camada de dados (Supabase ou mock). Páginas nunca acessam o banco direto.
- `src/lib/pricing.ts` regras de preço (varejo/atacado/Pix/parcelas). Usar sempre, nunca recalcular na UI.
- `src/lib/cart/store.ts` carrinho (snapshot do produto por linha; servidor revalida no pedido)
- `src/lib/utils/{format,masks,search}.ts` moeda, CPF/CNPJ/CEP/telefone, busca sem acento com ranking (portados do Multigiro)
- `src/components/{layout,home,product,catalog,cart,checkout,account,motion,ui}`
- `supabase/migrations/0001_init.sql` schema + RLS; `supabase/seed.sql` gerado

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
