-- =====================================================================
--  Almoxarifado · Central de Solicitações
--  Cole TODO este arquivo no SQL Editor do Supabase e clique em "Run".
--  Pode rodar mais de uma vez sem problema (é idempotente).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Usuários do painel (Neilton e Juliana)
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,
  display_name  text not null,
  password_hash text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Senha inicial dos dois usuários: 123456  (hash bcrypt)
insert into public.admins (username, display_name, password_hash) values
  ('neilton', 'Neilton', '$2b$10$c3tnk4UPkHj9.kv9pl7KsuDlaHAWcXU2EzcaZSKcTtwSADSM2pAIW'),
  ('juliana', 'Juliana', '$2b$10$c3tnk4UPkHj9.kv9pl7KsuDlaHAWcXU2EzcaZSKcTtwSADSM2pAIW')
on conflict (username) do nothing;

-- ---------------------------------------------------------------------
-- E-mails executivos autorizados a usar o formulário
-- ---------------------------------------------------------------------
create table if not exists public.authorized_emails (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique,
  supervisor_name  text,
  posto            text,
  created_by       text,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Configuração do formulário (uma única linha, id = 1)
-- Se não existir, o sistema usa o formulário padrão.
-- ---------------------------------------------------------------------
create table if not exists public.form_config (
  id          int primary key default 1 check (id = 1),
  fields      jsonb not null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Solicitações
-- ---------------------------------------------------------------------
create table if not exists public.requests (
  id            uuid primary key default gen_random_uuid(),
  protocol      bigint generated always as identity unique,
  email         text not null,
  collaborator  text,
  posto         text,
  answers       jsonb not null default '[]'::jsonb,
  attachments   jsonb not null default '[]'::jsonb,
  status        text not null default 'nova'
                check (status in ('nova', 'pendente', 'resolvida')),
  handled_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists requests_status_idx  on public.requests (status);
create index if not exists requests_created_idx on public.requests (created_at desc);

-- ---------------------------------------------------------------------
-- Segurança: RLS ligado e SEM políticas públicas.
-- Ninguém acessa as tabelas pela chave pública; só o servidor
-- (rotas /api da Vercel, com a chave secreta) lê e grava.
-- ---------------------------------------------------------------------
alter table public.admins            enable row level security;
alter table public.authorized_emails enable row level security;
alter table public.form_config       enable row level security;
alter table public.requests          enable row level security;

-- Garante que o servidor (chave secreta / service_role) consiga usar as tabelas,
-- mesmo em projetos onde o Supabase não libera novas tabelas automaticamente.
grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------
-- Bucket privado para fotos e vídeos (o sistema também cria sozinho
-- se ele não existir, então este bloco é só uma garantia).
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public)
    values ('anexos', 'anexos', false)
    on conflict (id) do nothing;
  end if;
end $$;
