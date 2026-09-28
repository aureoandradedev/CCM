-- =============================================================================
-- CCM · Central de Compras Multigiro — schema inicial (Supabase / Postgres)
-- Rode no SQL Editor do projeto ou via `supabase db push`.
-- Depois carregue os dados de exemplo com `supabase/seed.sql`.
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "unaccent";

-- ----------------------------------------------------------------------------
-- utilitário: updated_at automático
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- fornecedores (o CCM não tem estoque próprio: cada produto pertence a um)
-- ----------------------------------------------------------------------------
create table if not exists public.suppliers (
  id              text primary key,
  name            text not null,
  lead_time_days  int  not null default 3,
  city            text,
  cnpj            text,
  contact_email   text,
  contact_phone   text,
  -- futuro: como integrar (api, planilha, e-mail, erp)
  integration     jsonb not null default '{}'::jsonb,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger suppliers_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- categorias e subcategorias
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

-- ----------------------------------------------------------------------------
-- marcas
-- ----------------------------------------------------------------------------
create table if not exists public.brands (
  slug text primary key,
  name text not null,
  logo text
);

-- ----------------------------------------------------------------------------
-- produtos
-- ----------------------------------------------------------------------------
create table if not exists public.products (
  id                 text primary key,
  slug               text not null unique,
  sku                text not null,
  name               text not null,
  brand_slug         text references public.brands(slug),
  brand_name         text not null,
  category_slug      text not null references public.categories(slug),
  subcategory_slug   text references public.subcategories(slug),
  supplier_id        text references public.suppliers(id),
  unit               text not null default 'un',
  pack_info          text,
  retail_price       numeric(12,2) not null check (retail_price >= 0),
  wholesale_price    numeric(12,2) check (wholesale_price is null or wholesale_price >= 0),
  wholesale_min_qty  int check (wholesale_min_qty is null or wholesale_min_qty > 1),
  list_price         numeric(12,2),
  pix_discount_pct   numeric(5,2),
  images             text[] not null default '{}',
  rating             numeric(3,2),
  review_count       int not null default 0,
  badges             text[] not null default '{}',
  short_description  text not null default '',
  description        text,
  specs              jsonb not null default '[]'::jsonb,
  stock_status       text not null default 'supplier' check (stock_status in ('in_stock','supplier','out')),
  tags               text[] not null default '{}',
  yield_hint         text,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- busca full-text sem acento (nome + marca + tags)
  search             tsvector generated always as (
    to_tsvector('simple', unaccent(coalesce(name,'') || ' ' || coalesce(brand_name,'') || ' ' || array_to_string(tags, ' ')))
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
-- banners da home
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
  starts_at timestamptz,
  ends_at   timestamptz
);

-- ----------------------------------------------------------------------------
-- clientes (perfil ligado ao auth.users) e endereços
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  document    text,            -- CPF ou CNPJ (só dígitos)
  person_type text not null default 'pf' check (person_type in ('pf','pj')),
  phone       text,
  email       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

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
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists addresses_profile_idx on public.addresses(profile_id);

-- ----------------------------------------------------------------------------
-- pedidos (um pedido do cliente pode virar N remessas, uma por fornecedor)
-- ----------------------------------------------------------------------------
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  profile_id      uuid references public.profiles(id),
  status          text not null default 'pending'
                  check (status in ('pending','paid','processing','shipped','delivered','cancelled','refunded')),
  customer        jsonb not null,   -- snapshot nome/documento/telefone/e-mail
  address         jsonb not null,   -- snapshot do endereço de entrega
  subtotal        numeric(12,2) not null,
  discount        numeric(12,2) not null default 0,
  shipping        numeric(12,2) not null default 0,
  total           numeric(12,2) not null,
  payment_method  text,
  payment_status  text not null default 'pending',
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

create table if not exists public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  product_id    text references public.products(id),
  supplier_id   text references public.suppliers(id),
  name          text not null,
  sku           text,
  unit          text not null,
  qty           int  not null check (qty > 0),
  unit_price    numeric(12,2) not null,   -- preço que valeu (varejo ou atacado)
  price_tier    text not null default 'retail' check (price_tier in ('retail','wholesale')),
  line_total    numeric(12,2) not null
);
create index if not exists order_items_order_idx on public.order_items(order_id);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.suppliers     enable row level security;
alter table public.categories    enable row level security;
alter table public.subcategories enable row level security;
alter table public.brands        enable row level security;
alter table public.products      enable row level security;
alter table public.banners       enable row level security;
alter table public.profiles      enable row level security;
alter table public.addresses     enable row level security;
alter table public.orders        enable row level security;
alter table public.order_items   enable row level security;

-- catálogo: leitura pública do que está ativo
create policy "public read suppliers"     on public.suppliers     for select using (active);
create policy "public read categories"    on public.categories    for select using (active);
create policy "public read subcategories" on public.subcategories for select using (true);
create policy "public read brands"        on public.brands        for select using (true);
create policy "public read products"      on public.products      for select using (active);
create policy "public read banners"       on public.banners       for select using (active);

-- dados do cliente: só o dono
create policy "own profile"   on public.profiles  for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "own addresses" on public.addresses for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
create policy "own orders"    on public.orders    for select using (auth.uid() = profile_id);
create policy "own order items" on public.order_items for select
  using (exists (select 1 from public.orders o where o.id = order_id and o.profile_id = auth.uid()));

-- perfil criado automaticamente no cadastro
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- busca: função usada pelo front quando o catálogo crescer
-- ----------------------------------------------------------------------------
create or replace function public.search_products(term text, max_results int default 40)
returns setof public.products language sql stable as $$
  select *
  from public.products
  where active
    and search @@ plainto_tsquery('simple', unaccent(term))
  order by ts_rank(search, plainto_tsquery('simple', unaccent(term))) desc, review_count desc
  limit max_results;
$$;
