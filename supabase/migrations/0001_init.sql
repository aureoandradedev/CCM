-- =============================================================================
-- Multigiro Central de Compras (CCM) — schema (Supabase / Postgres)
-- Rode no SQL Editor do projeto (ou `supabase db push`), depois `supabase/seed.sql`.
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "unaccent";

-- unaccent() e array_to_string() não são IMMUTABLE; coluna gerada exige função imutável.
create or replace function public.immutable_unaccent(text)
returns text language sql immutable strict parallel safe
set search_path = public, extensions as $$
  select unaccent('unaccent', $1);
$$;

create or replace function public.product_search_text(name text, brand text, sku text, tags text[])
returns text language sql immutable parallel safe
set search_path = public, extensions as $$
  select unaccent('unaccent', coalesce(name,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(sku,'') || ' ' || coalesce(array_to_string(tags, ' '), ''));
$$;

-- ----------------------------------------------------------------------------
-- utilitários
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- perfis (ligados ao auth.users) — role decide o acesso ao admin
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  document    text,            -- CPF ou CNPJ (só dígitos)
  person_type text not null default 'pf' check (person_type in ('pf','pj')),
  phone       text,
  email       text,
  role        text not null default 'customer' check (role in ('customer','admin')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create index if not exists profiles_document_idx on public.profiles(document);

-- é admin? (usada nas policies; security definer para não recursar na própria RLS)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

-- perfil criado automaticamente no cadastro (metadata vem do signUp)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, document, phone, person_type)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'document',''), '\D', '', 'g'), ''),
    nullif(new.raw_user_meta_data->>'phone', ''),
    case when coalesce(new.raw_user_meta_data->>'person_type','pf') = 'pj' then 'pj' else 'pf' end
  )
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- fornecedores (o CCM não tem estoque: cada produto pertence a um)
-- ----------------------------------------------------------------------------
create table if not exists public.suppliers (
  id              text primary key,
  name            text not null,
  lead_time_days  int  not null default 3,
  city            text,
  cnpj            text,
  contact_name    text,
  contact_email   text,
  contact_phone   text,
  integration     jsonb not null default '{}'::jsonb,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger suppliers_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- categorias, subcategorias, marcas
-- ----------------------------------------------------------------------------
create table if not exists public.categories (
  slug        text primary key,
  name        text not null,
  icon        text not null default 'Package',
  description text not null default '',
  image       text,
  tone        text check (tone in ('yellow','orange','navy','green','blue','red','slate')),
  sort        int  not null default 0,
  active      boolean not null default true
);

create table if not exists public.subcategories (
  slug          text primary key,
  category_slug text not null references public.categories(slug) on delete cascade,
  name          text not null,
  sort          int  not null default 0
);
create index if not exists subcategories_category_idx on public.subcategories(category_slug);

create table if not exists public.brands (
  slug text primary key,
  name text not null,
  logo text
);

-- ----------------------------------------------------------------------------
-- produtos
-- ----------------------------------------------------------------------------
create table if not exists public.products (
  id                   text primary key,
  slug                 text not null unique,
  sku                  text not null,
  ean                  text,
  name                 text not null,
  brand_slug           text references public.brands(slug),
  brand_name           text not null,
  category_slug        text not null references public.categories(slug),
  subcategory_slug     text references public.subcategories(slug),
  supplier_id          text references public.suppliers(id),
  unit                 text not null default 'un',
  pack_info            text,
  retail_price         numeric(12,2) not null check (retail_price >= 0),
  wholesale_price      numeric(12,2) check (wholesale_price is null or wholesale_price >= 0),
  wholesale_min_qty    int check (wholesale_min_qty is null or wholesale_min_qty > 1),
  list_price           numeric(12,2),
  pix_discount_pct     numeric(5,2),
  images               text[] not null default '{}',
  image_source         text,              -- 'admin' | 'qrofertas' | 'placeholder'
  image_manual         boolean not null default false,
  image_pending        boolean not null default false,
  image_pending_reason text,
  image_fetched_at     timestamptz,
  image_retry_at       timestamptz,
  rating               numeric(3,2),
  review_count         int not null default 0,
  badges               text[] not null default '{}',
  short_description    text not null default '',
  description          text,
  specs                jsonb not null default '[]'::jsonb,
  stock                int,               -- null = sem controle; 0 = esgotado
  max_per_order        int,
  max_per_order_enabled boolean not null default false,
  stock_status         text not null default 'supplier' check (stock_status in ('in_stock','supplier','out')),
  tags                 text[] not null default '{}',
  yield_hint           text,
  sort                 int not null default 0,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  search               tsvector generated always as (
    to_tsvector('simple', public.product_search_text(name, brand_name, sku, tags))
  ) stored
);
create index if not exists products_category_idx on public.products(category_slug, active);
create index if not exists products_subcategory_idx on public.products(subcategory_slug);
create index if not exists products_brand_idx on public.products(brand_slug);
create index if not exists products_supplier_idx on public.products(supplier_id);
create index if not exists products_search_idx on public.products using gin(search);
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- banners da home e campanhas de ofertas programadas
-- ----------------------------------------------------------------------------
create table if not exists public.banners (
  id        text primary key,
  eyebrow   text,
  title     text not null,
  subtitle  text,
  cta       text not null,
  href      text not null,
  image     text not null,
  theme     text not null default 'navy' check (theme in ('navy','yellow','orange','dark')),
  variant   text not null default 'photo' check (variant in ('photo','mascot')),
  sort      int  not null default 0,
  active    boolean not null default true,
  campaign_id uuid,
  starts_at timestamptz,
  ends_at   timestamptz
);

create table if not exists public.campaigns (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  starts_at    timestamptz not null,
  status       text not null default 'agendada' check (status in ('agendada','ativa','pulada','cancelada','encerrada')),
  -- [{ product_id, name, price }] preços promocionais; ao ativar viram list_price/retail_price
  products     jsonb not null default '[]'::jsonb,
  -- [{ image, sort }] banners que substituem o carrossel enquanto ativa
  banners      jsonb not null default '[]'::jsonb,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  activated_at timestamptz,
  ended_at     timestamptz
);

-- ----------------------------------------------------------------------------
-- configurações do site (frete, bloqueio de entrega, descontos, mais vendidos...)
-- ----------------------------------------------------------------------------
create table if not exists public.site_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.site_settings (key, value) values
  ('frete', '{"freeShippingFromCentavos": 79900, "flatCentavos": 4990, "pickupEnabled": true, "regions": {}}'),
  ('entrega_bloqueio', '{"ativo": false, "data": null}'),
  ('descontos', '{"pixPct": 5, "primeiraCompra": {"ativo": false, "percentual": 0}}'),
  ('best_sellers', '{"ids": []}'),
  ('avisos', '{"topo": ""}')
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- endereços do cliente
-- ----------------------------------------------------------------------------
create table if not exists public.addresses (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  label       text not null default 'Obra',
  cep         text not null,
  street      text not null,
  number      text not null,
  complement  text,
  district    text not null,
  city        text not null,
  state       text not null,
  reference   text,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists addresses_profile_idx on public.addresses(profile_id);

-- ----------------------------------------------------------------------------
-- pedidos (criados SÓ pelo backend com service role; cliente lê os seus)
-- ----------------------------------------------------------------------------
create table if not exists public.orders (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique,
  profile_id             uuid references public.profiles(id),
  customer               jsonb not null,   -- {name, document, phone, email}
  address                jsonb,            -- snapshot do endereço (null em retirada)
  delivery_method        text not null default 'delivery' check (delivery_method in ('delivery','pickup')),
  delivery_cep           text,
  delivery_date          date,
  delivery_window        text,
  notes                  text,
  origin                 text not null default 'site',

  -- pagamento
  payment_method         text not null,    -- pix | cartao-credito | cartao-debito | cartao-pendente | na-entrega | boleto | faturado
  payment_status         text not null default 'pendente' check (payment_status in ('pendente','pago','negado','estornado')),
  payment_provider       text,             -- cielo | cielo2 | mock
  paid_at                timestamptz,
  cielo_payment_id       text,
  txid                   text,
  pix_qr_code            jsonb,            -- {copiaECola, base64}
  pix_expires_at         timestamptz,
  pix_amount_centavos    int,
  card_amount_centavos   int,
  card_return_code       text,
  card_return_message    text,
  payment_lock           jsonb,            -- ver backend/lib/payment-lock.mjs
  needs_payment_review   boolean not null default false,
  refund_status          text check (refund_status in ('processando','estornado','falhou','incerto')),
  refund_request_id      text,
  refund_confirmed_at    timestamptz,

  -- fluxo operacional
  order_status           text not null default 'aguardando-pagamento'
                         check (order_status in ('aguardando-pagamento','em-separacao','separados','pagos','pagamento-pendente','arquivados','cancelado')),
  archived_at            timestamptz,
  revenue_excluded       boolean not null default false,
  revenue_excluded_reason text,
  revenue_excluded_at    timestamptz,
  cash_pending           boolean not null default false,
  cash_confirmed_at      timestamptz,

  -- valores (centavos inteiros = fonte oficial)
  retail_subtotal_centavos   int not null default 0,   -- tudo a preço de varejo
  subtotal_centavos          int not null default 0,   -- com atacado aplicado
  wholesale_savings_centavos int not null default 0,
  discount_centavos          int not null default 0,   -- desconto Pix / primeira compra
  discount_detail            jsonb,
  freight_centavos           int not null default 0,
  freight_rule               text,
  total_centavos             int not null default 0,
  pricing_version            int not null default 1,
  items_count                int not null default 0,
  supplier_ids               text[] not null default '{}',

  -- idempotência de criação
  creation_key           text unique,
  customer_hash          text,
  client_request_id      text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists orders_profile_idx on public.orders(profile_id, created_at desc);
create index if not exists orders_status_idx on public.orders(order_status, created_at desc);
create index if not exists orders_created_idx on public.orders(created_at desc);
create index if not exists orders_cielo_idx on public.orders(cielo_payment_id);
create index if not exists orders_customer_doc_idx on public.orders((customer->>'document'));
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

create table if not exists public.order_items (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders(id) on delete cascade,
  product_id          text references public.products(id),
  supplier_id         text references public.suppliers(id),
  name                text not null,
  sku                 text,
  image               text,
  unit                text not null,
  qty                 int  not null check (qty > 0),
  price_tier          text not null default 'retail' check (price_tier in ('retail','wholesale')),
  unit_price_centavos int not null,
  retail_price_centavos int not null,
  line_centavos       int not null
);
create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists order_items_product_idx on public.order_items(product_id);

-- histórico/auditoria do pedido (mudança de status, pagamento, estorno, peso...)
create table if not exists public.order_events (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  type       text not null,
  data       jsonb not null default '{}'::jsonb,
  actor_id   uuid,
  actor_kind text not null default 'system',  -- system | admin | customer | webhook
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events(order_id, created_at);

-- ----------------------------------------------------------------------------
-- leads (WhatsApp/newsletter)
-- ----------------------------------------------------------------------------
create table if not exists public.leads (
  id         uuid primary key default gen_random_uuid(),
  phone      text,
  email      text,
  name       text,
  source     text not null default 'newsletter',
  created_at timestamptz not null default now()
);
create unique index if not exists leads_phone_source_idx on public.leads(phone, source) where phone is not null;

-- ----------------------------------------------------------------------------
-- código de pedido único: 2 letras + 4 dígitos (ex.: MG4821)
-- ----------------------------------------------------------------------------
create or replace function public.next_order_code()
returns text language plpgsql as $$
declare
  letters text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  novo text;
  tries int := 0;
begin
  loop
    novo := substr(letters, 1 + floor(random()*length(letters))::int, 1)
         || substr(letters, 1 + floor(random()*length(letters))::int, 1)
         || lpad(floor(random()*10000)::int::text, 4, '0');
    exit when not exists (select 1 from public.orders o where o.code = novo);
    tries := tries + 1;
    if tries > 50 then raise exception 'não foi possível gerar código de pedido único'; end if;
  end loop;
  return novo;
end $$;

-- ----------------------------------------------------------------------------
-- busca full-text (usada quando o catálogo crescer)
-- ----------------------------------------------------------------------------
create or replace function public.search_products(term text, max_results int default 40)
returns setof public.products language sql stable as $$
  select *
  from public.products
  where active
    and search @@ plainto_tsquery('simple', public.immutable_unaccent(term))
  order by ts_rank(search, plainto_tsquery('simple', public.immutable_unaccent(term))) desc, review_count desc
  limit max_results;
$$;

-- ----------------------------------------------------------------------------
-- BI: faturamento diário (pago e não desconsiderado), lido pelo admin
-- ----------------------------------------------------------------------------
create or replace view public.v_faturamento_diario as
  select
    (created_at at time zone 'America/Sao_Paulo')::date as dia,
    count(*) filter (where payment_status = 'pago' and not revenue_excluded) as pedidos_pagos,
    count(*) as pedidos,
    coalesce(sum(total_centavos) filter (where payment_status = 'pago' and not revenue_excluded), 0) as faturamento_centavos,
    coalesce(sum(total_centavos), 0) as vendido_centavos
  from public.orders
  where order_status <> 'cancelado'
  group by 1;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.suppliers     enable row level security;
alter table public.categories    enable row level security;
alter table public.subcategories enable row level security;
alter table public.brands        enable row level security;
alter table public.products      enable row level security;
alter table public.banners       enable row level security;
alter table public.campaigns     enable row level security;
alter table public.site_settings enable row level security;
alter table public.addresses     enable row level security;
alter table public.orders        enable row level security;
alter table public.order_items   enable row level security;
alter table public.order_events  enable row level security;
alter table public.leads         enable row level security;

-- catálogo: leitura pública do ativo; admin faz tudo
create policy "public read suppliers"     on public.suppliers     for select using (active or public.is_admin());
create policy "public read categories"    on public.categories    for select using (active or public.is_admin());
create policy "public read subcategories" on public.subcategories for select using (true);
create policy "public read brands"        on public.brands        for select using (true);
create policy "public read products"      on public.products      for select using (active or public.is_admin());
create policy "public read banners"       on public.banners       for select using (active or public.is_admin());
create policy "public read settings"      on public.site_settings for select using (true);

create policy "admin all suppliers"     on public.suppliers     for all using (public.is_admin()) with check (public.is_admin());
create policy "admin all categories"    on public.categories    for all using (public.is_admin()) with check (public.is_admin());
create policy "admin all subcategories" on public.subcategories for all using (public.is_admin()) with check (public.is_admin());
create policy "admin all brands"        on public.brands        for all using (public.is_admin()) with check (public.is_admin());
create policy "admin all products"      on public.products      for all using (public.is_admin()) with check (public.is_admin());
create policy "admin all banners"       on public.banners       for all using (public.is_admin()) with check (public.is_admin());
create policy "admin all campaigns"     on public.campaigns     for all using (public.is_admin()) with check (public.is_admin());
create policy "admin all settings"      on public.site_settings for all using (public.is_admin()) with check (public.is_admin());
create policy "admin all leads"         on public.leads         for all using (public.is_admin()) with check (public.is_admin());
create policy "public insert leads"     on public.leads         for insert with check (true);

-- perfis: o dono edita o seu (menos role); admin vê e edita todos
create policy "own profile read"   on public.profiles for select using (auth.uid() = id or public.is_admin());
create policy "own profile update" on public.profiles for update using (auth.uid() = id or public.is_admin())
  with check ((auth.uid() = id and role = (select role from public.profiles p where p.id = auth.uid())) or public.is_admin());

create policy "own addresses" on public.addresses for all using (auth.uid() = profile_id or public.is_admin()) with check (auth.uid() = profile_id or public.is_admin());

-- pedidos: cliente lê os seus; admin lê/edita todos; criação só via service role (backend)
create policy "own orders read"   on public.orders for select using (auth.uid() = profile_id or public.is_admin());
create policy "admin orders write" on public.orders for update using (public.is_admin()) with check (public.is_admin());
create policy "own order items"   on public.order_items for select
  using (exists (select 1 from public.orders o where o.id = order_id and (o.profile_id = auth.uid() or public.is_admin())));
create policy "admin order events" on public.order_events for select using (public.is_admin());
create policy "admin order events insert" on public.order_events for insert with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- Storage: fotos de produto e banners (leitura pública, escrita de admin)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('produtos', 'produtos', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('banners', 'banners', true) on conflict (id) do nothing;

create policy "public read product images" on storage.objects for select using (bucket_id in ('produtos','banners'));
create policy "admin write product images" on storage.objects for insert with check (bucket_id in ('produtos','banners') and public.is_admin());
create policy "admin update product images" on storage.objects for update using (bucket_id in ('produtos','banners') and public.is_admin());
create policy "admin delete product images" on storage.objects for delete using (bucket_id in ('produtos','banners') and public.is_admin());
