-- ============================================================================
-- CCM · Central de Integração do Fornecedor — fundação de banco
-- ----------------------------------------------------------------------------
-- Migration ADITIVA e opcional: prepara a sincronização ERP⇄CCM e o isolamento
-- por fornecedor. Não altera nada do que já roda hoje. Aplique no Supabase
-- quando o portal autenticado do fornecedor for ligado.
--
-- Princípios:
--  * Modelo canônico já existe em products/suppliers (migration 0001). Aqui só
--    acrescentamos o rastreio das CONEXÕES e das IMPORTAÇÕES.
--  * Isolamento: cada fornecedor só enxerga/gerencia a PRÓPRIA integração.
--  * Segredos (token/senha de ERP) NUNCA em texto puro: guardamos só um ponteiro
--    para o cofre (Supabase Vault / env do backend) e os 4 últimos dígitos.
-- ============================================================================

-- 1) Liga um usuário (profile) a uma empresa fornecedora. É o que habilita o
--    login do fornecedor e o isolamento multi-tenant. NULL = não é fornecedor.
alter table public.profiles
  add column if not exists supplier_id text references public.suppliers(id) on delete set null;

create index if not exists profiles_supplier_idx on public.profiles (supplier_id);

-- 2) Helper de propriedade: admin vê tudo; fornecedor vê só a sua empresa.
create or replace function public.owns_supplier(sid text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.is_admin()
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.supplier_id = sid
      );
$$;

-- 3) Conexões de integração por fornecedor.
create table if not exists public.supplier_integrations (
  id            text primary key,
  supplier_id   text not null references public.suppliers(id) on delete cascade,
  method        text not null check (method in ('erp','csv','api','feed','manual')),
  connector_id  text,                              -- ex.: 'bling' (quando method='erp')
  status        text not null default 'connected'  -- connected | syncing | error | paused
                  check (status in ('connected','syncing','error','paused')),
  auto_sync     boolean not null default false,
  -- config NÃO-sensível (mapeamento de colunas, url do feed, flags). Sem segredos.
  config        jsonb not null default '{}'::jsonb,
  -- ponteiro para o segredo no cofre + últimos 4 dígitos (exibição). Nunca o token.
  credential_ref   text,
  credential_last4 text,
  product_count int not null default 0,
  valid_count   int not null default 0,
  error_count   int not null default 0,
  last_sync_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists supplier_integrations_supplier_idx
  on public.supplier_integrations (supplier_id);

-- 4) Histórico de importações/sincronizações (etapas 3 e 4 do wizard).
create table if not exists public.integration_import_batches (
  id             text primary key,
  supplier_id    text not null references public.suppliers(id) on delete cascade,
  integration_id text references public.supplier_integrations(id) on delete set null,
  method         text not null,
  source_name    text,            -- nome do arquivo / url do feed
  total          int not null default 0,
  valid          int not null default 0,
  invalid        int not null default 0,
  warnings       int not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists import_batches_supplier_idx
  on public.integration_import_batches (supplier_id, created_at desc);

-- 5) RLS — isolamento por fornecedor. Um fornecedor jamais lê/escreve a
--    integração de outro; admin tem acesso total.
alter table public.supplier_integrations enable row level security;
alter table public.integration_import_batches enable row level security;

drop policy if exists "owner rw integrations" on public.supplier_integrations;
create policy "owner rw integrations" on public.supplier_integrations
  for all using (public.owns_supplier(supplier_id))
  with check (public.owns_supplier(supplier_id));

drop policy if exists "owner rw batches" on public.integration_import_batches;
create policy "owner rw batches" on public.integration_import_batches
  for all using (public.owns_supplier(supplier_id))
  with check (public.owns_supplier(supplier_id));

-- OBS: produtos (public.products) já possuem products_supplier_idx e são escritos
-- pelo backend (service role). Quando o portal do fornecedor entrar, basta
-- acrescentar uma policy de escrita em products condicionada a
-- public.owns_supplier(supplier_id) para o fornecedor manter o próprio catálogo.
