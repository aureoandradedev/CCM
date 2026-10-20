-- ============================================================================
-- CCM · Modelo de compras centralizado — Fase 1: fundação de dados
-- ----------------------------------------------------------------------------
-- Migration ADITIVA. Não altera tabelas/colunas existentes que já rodam.
-- Cria a base para o pipeline:
--
--   fornecedor envia catálogo
--     → supplier_catalogs / supplier_catalog_items
--       → matching com master_products
--         → supplier_offers
--           → comparação + aprovação
--             → margem (margin_rules)
--               → products (publicado)
--
-- Princípios:
--   * Campos novos em products são nullable/default — dados atuais não quebram.
--   * Ofertas NÃO têm UNIQUE(master,supplier) — permite histórico natural
--     via status (apenas 1 'ativa' por par, controlada por app).
--   * RLS total: fornecedor vê só o próprio; comprador/admin vê tudo.
--   * Nenhuma alteração em orders/order_items/checkout/auth.
-- ============================================================================

-- ============================================================================
-- 1. PRODUTOS MESTRES (entidade canônica CCM)
-- ============================================================================
-- Representa O PRODUTO, independente de quem fornece.
-- Ex.: "Ventilador Mondial VTX-40 40cm 220V" existe uma vez aqui,
-- mesmo que 3 fornecedores ofereçam.

create table if not exists public.master_products (
  id                uuid primary key default gen_random_uuid(),
  ean               text,
  name              text not null,
  brand_slug        text references public.brands(slug),
  brand_name        text,
  model             text,
  category_slug     text references public.categories(slug),
  subcategory_slug  text references public.subcategories(slug),
  unit              text not null default 'un',
  pack_info         text,
  description       text,
  specs             jsonb not null default '[]'::jsonb,
  images            text[] not null default '{}',
  tags              text[] not null default '{}',
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger master_products_updated_at before update on public.master_products
  for each row execute function public.set_updated_at();

create index if not exists master_products_ean_idx
  on public.master_products (ean) where ean is not null;
create index if not exists master_products_brand_idx
  on public.master_products (brand_slug);
create index if not exists master_products_category_idx
  on public.master_products (category_slug);

-- ============================================================================
-- 2. CATÁLOGOS DE FORNECEDOR (cada envio/upload)
-- ============================================================================

create table if not exists public.supplier_catalogs (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   text not null references public.suppliers(id) on delete cascade,
  source        text not null default 'csv'
                check (source in ('csv','api','feed','manual','erp')),
  source_name   text,
  status        text not null default 'recebido'
                check (status in ('recebido','processando','analisado','com_erros','concluido')),
  total_items   int not null default 0,
  processed     int not null default 0,
  errors        int not null default 0,
  warnings      int not null default 0,
  version       int not null default 1,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger supplier_catalogs_updated_at before update on public.supplier_catalogs
  for each row execute function public.set_updated_at();

create index if not exists supplier_catalogs_supplier_idx
  on public.supplier_catalogs (supplier_id, created_at desc);

-- ============================================================================
-- 3. ITENS DO CATÁLOGO (cada linha do envio)
-- ============================================================================

create table if not exists public.supplier_catalog_items (
  id                  uuid primary key default gen_random_uuid(),
  catalog_id          uuid not null references public.supplier_catalogs(id) on delete cascade,
  supplier_id         text not null references public.suppliers(id) on delete cascade,

  -- dados brutos do fornecedor
  supplier_sku        text,
  ean                 text,
  name                text not null,
  description         text,
  brand               text,
  model               text,
  category_original   text,
  subcategory_original text,
  unit                text,
  pack_info           text,
  cost_centavos       int,
  stock               int,
  lead_time_days      int,
  image_url           text,
  attributes          jsonb not null default '{}'::jsonb,

  -- matching
  match_status        text not null default 'pendente'
                      check (match_status in (
                        'pendente','normalizado','match_sugerido',
                        'revisao_manual','aprovado','rejeitado'
                      )),
  master_product_id   uuid references public.master_products(id) on delete set null,
  match_confidence    numeric(5,2),
  match_signals       jsonb,

  created_at          timestamptz not null default now()
);

create index if not exists catalog_items_catalog_idx
  on public.supplier_catalog_items (catalog_id);
create index if not exists catalog_items_supplier_idx
  on public.supplier_catalog_items (supplier_id);
create index if not exists catalog_items_master_idx
  on public.supplier_catalog_items (master_product_id) where master_product_id is not null;
create index if not exists catalog_items_ean_idx
  on public.supplier_catalog_items (ean) where ean is not null;
create index if not exists catalog_items_match_status_idx
  on public.supplier_catalog_items (match_status);

-- ============================================================================
-- 4. OFERTAS DE FORNECEDOR
-- ============================================================================
-- Cada oferta é uma proposta comercial de um fornecedor para um produto mestre.
-- Permite histórico natural (múltiplas linhas por master+supplier).
-- Unicidade da oferta ativa garantida por índice UNIQUE parcial:
--   apenas 1 com status='ativa' por (master_product_id, supplier_id).
-- Ofertas antigas ficam como 'vencida' ou 'indisponivel' — histórico preservado.

create table if not exists public.supplier_offers (
  id                uuid primary key default gen_random_uuid(),
  master_product_id uuid not null references public.master_products(id) on delete cascade,
  supplier_id       text not null references public.suppliers(id) on delete cascade,
  catalog_item_id   uuid references public.supplier_catalog_items(id) on delete set null,

  cost_centavos     int not null,
  stock             int,
  lead_time_days    int not null default 3,

  status            text not null default 'ativa'
                    check (status in ('ativa','indisponivel','vencida','escolhida')),
  valid_until       timestamptz,
  attributes        jsonb not null default '{}'::jsonb,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger supplier_offers_updated_at before update on public.supplier_offers
  for each row execute function public.set_updated_at();

-- Garantia no banco: no máximo 1 oferta ativa por (fornecedor, produto mestre).
-- Histórico (vencida, indisponivel, escolhida) não é afetado.
create unique index if not exists offers_unique_active_idx
  on public.supplier_offers (master_product_id, supplier_id) where status = 'ativa';

-- Índice parcial: consultas frequentes buscam apenas ofertas ativas/escolhidas
create index if not exists offers_master_active_idx
  on public.supplier_offers (master_product_id, status) where status in ('ativa','escolhida');
create index if not exists offers_supplier_idx
  on public.supplier_offers (supplier_id);
create index if not exists offers_status_idx
  on public.supplier_offers (status);

-- ============================================================================
-- 5. REGRAS DE MARGEM
-- ============================================================================

create table if not exists public.margin_rules (
  id                  uuid primary key default gen_random_uuid(),
  scope               text not null check (scope in ('global','category','product')),
  scope_ref           text,
  margin_pct          numeric(6,2) not null,
  min_price_centavos  int,
  rounding            text not null default 'none'
                      check (rounding in ('none','X90','X99')),
  priority            int not null default 0,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger margin_rules_updated_at before update on public.margin_rules
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 6. NOVOS CAMPOS EM products (PublishedProduct)
-- ============================================================================
-- Todos nullable/default para não quebrar dados existentes.
-- products.supplier_id permanece: agora = fornecedor vencedor atual (denormalizado).

alter table public.products
  add column if not exists master_product_id uuid references public.master_products(id) on delete set null,
  add column if not exists winning_offer_id  uuid references public.supplier_offers(id) on delete set null,
  add column if not exists cost_centavos     int,
  add column if not exists margin_pct        numeric(6,2),
  add column if not exists publish_status    text not null default 'publicada'
                           check (publish_status in ('rascunho','aguardando_aprovacao','publicada','pausada'));

-- Auditoria da escolha: quem/quando/por quê selecionou a oferta vencedora
alter table public.products
  add column if not exists offer_approved_by   uuid references public.profiles(id),
  add column if not exists offer_approved_at   timestamptz,
  add column if not exists offer_approval_note text,
  add column if not exists offer_score         numeric(6,2);

create index if not exists products_master_idx
  on public.products (master_product_id) where master_product_id is not null;
create index if not exists products_publish_status_idx
  on public.products (publish_status);

-- ============================================================================
-- 7. RLS
-- ============================================================================

alter table public.master_products    enable row level security;
alter table public.supplier_catalogs  enable row level security;
alter table public.supplier_catalog_items enable row level security;
alter table public.supplier_offers    enable row level security;
alter table public.margin_rules       enable row level security;

-- master_products: admin lê/escreve; ninguém mais (interno)
create policy "admin all master_products"
  on public.master_products for all
  using (public.is_admin()) with check (public.is_admin());

-- supplier_catalogs: fornecedor vê os próprios; admin vê tudo
create policy "owner rw supplier_catalogs"
  on public.supplier_catalogs for all
  using (public.owns_supplier(supplier_id))
  with check (public.owns_supplier(supplier_id));

-- supplier_catalog_items: fornecedor vê os próprios; admin vê tudo
create policy "owner rw supplier_catalog_items"
  on public.supplier_catalog_items for all
  using (public.owns_supplier(supplier_id))
  with check (public.owns_supplier(supplier_id));

-- supplier_offers: fornecedor vê SOMENTE as próprias ofertas; admin vê tudo.
-- Fornecedor NUNCA vê custo/oferta de concorrente.
create policy "owner rw supplier_offers"
  on public.supplier_offers for all
  using (public.owns_supplier(supplier_id))
  with check (public.owns_supplier(supplier_id));

-- margin_rules: somente admin (estratégia interna CCM)
create policy "admin all margin_rules"
  on public.margin_rules for all
  using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- 8. COMENTÁRIO DE DOCUMENTAÇÃO
-- ============================================================================

comment on column public.products.supplier_id is
  'Fornecedor vencedor atual (denormalizado da oferta vencedora). NÃO representa "dono do produto".';

comment on column public.products.master_product_id is
  'Produto mestre CCM ao qual este produto publicado corresponde.';

comment on column public.products.winning_offer_id is
  'Oferta de fornecedor selecionada como vencedora para este produto publicado.';

comment on column public.products.cost_centavos is
  'Custo da oferta vencedora (centavos). Preço de compra do CCM.';

comment on column public.products.margin_pct is
  'Margem aplicada sobre o custo para gerar o preço de venda.';

comment on column public.products.publish_status is
  'Status de publicação: rascunho, aguardando_aprovacao, publicada, pausada. Produtos existentes migram como publicada.';

comment on column public.products.offer_approved_by is
  'Comprador/admin que aprovou a oferta vencedora.';

comment on column public.products.offer_approved_at is
  'Data/hora da aprovação da oferta vencedora.';

comment on column public.products.offer_approval_note is
  'Observação/motivo da escolha da oferta vencedora.';

comment on column public.products.offer_score is
  'Score/ranking do motor de comparação na hora da aprovação.';

comment on table public.master_products is
  'Produto canônico CCM. Representa O produto independente de fornecedor. Ex.: "Ventilador Mondial VTX-40 40cm 220V".';

comment on table public.supplier_catalogs is
  'Cada envio/upload de catálogo por um fornecedor. Rastreia origem, status e contadores.';

comment on table public.supplier_catalog_items is
  'Cada linha/item de um catálogo enviado. Dados brutos do fornecedor + status de matching.';

comment on table public.supplier_offers is
  'Oferta comercial de um fornecedor para um produto mestre. Sem UNIQUE — histórico preservado por status.';

comment on table public.margin_rules is
  'Regras de margem CCM (global, por categoria, por produto). Estratégia interna, nunca visível ao fornecedor.';
