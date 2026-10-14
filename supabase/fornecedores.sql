-- =====================================================================
--  Max Hub · Cadastro de fornecedores (setor Compras)
--
--  Completa a tabela de fornecedores que as notas fiscais já usam: nome
--  fantasia, contato, o que fornece, cidade, observações e ativo/inativo.
--  Fornecedores que já entraram pelas notas continuam ligados a elas.
--
--  Pode rodar mais de uma vez sem problema (tudo é "se não existir").
--  Rode depois do pedidos_e_notas.sql, no SQL Editor do Supabase.
-- =====================================================================

create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  cnpj        text,
  phone       text,
  email       text,
  created_at  timestamptz not null default now()
);
create unique index if not exists suppliers_cnpj_uidx on public.suppliers (cnpj) where cnpj is not null;

alter table public.suppliers add column if not exists trade_name  text;
alter table public.suppliers add column if not exists contact     text;
alter table public.suppliers add column if not exists category    text;
alter table public.suppliers add column if not exists city        text;
alter table public.suppliers add column if not exists uf          text;
alter table public.suppliers add column if not exists address     text;
alter table public.suppliers add column if not exists notes       text;
alter table public.suppliers add column if not exists active      boolean not null default true;
alter table public.suppliers add column if not exists created_by  text;
alter table public.suppliers add column if not exists updated_at  timestamptz not null default now();

-- busca por nome sem diferenciar maiúsculas
create index if not exists suppliers_name_idx on public.suppliers (lower(name));

alter table public.suppliers enable row level security;
grant all on public.suppliers to service_role;
