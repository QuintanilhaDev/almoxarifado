-- =====================================================================
--  Max · Aprendizado (memória do que ela já resolveu, anotações e pedidos não atendidos)
--  Cole TODO este arquivo no SQL Editor do Supabase e clique em "Run".
--  Pode rodar mais de uma vez. Não mexe em nenhuma tabela que já existe.
--  Sem este arquivo a Max funciona normalmente, só não aprende entre uma conversa e outra.
-- =====================================================================

-- Pedidos já resolvidos: "frase" → comando da tela ou ferramenta usada.
create table if not exists public.max_learned (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,          -- tela|setor|palavras do pedido
  phrase      text not null,
  scope       text not null default 'sector',
  sector      text,
  route       text,                           -- comando pronto da tela
  tool        text,                           -- ou ferramenta de consulta usada pela IA
  args        jsonb,
  hits        integer not null default 1,     -- quantas vezes foi usado
  good        integer not null default 0,     -- 👍
  bad         integer not null default 0,     -- 👎
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists max_learned_scope_idx on public.max_learned (scope, sector, updated_at desc);

-- Anotações ensinadas à Max ("lembre que o fornecedor de botas é a X").
create table if not exists public.max_notes (
  id          uuid primary key default gen_random_uuid(),
  sector      text,                           -- null = vale para todos os setores
  text        text not null,
  created_by  text,
  created_at  timestamptz not null default now()
);

-- Pedidos que ela não soube atender (para o master ver o que falta ensinar/criar).
create table if not exists public.max_misses (
  id          uuid primary key default gen_random_uuid(),
  phrase      text not null,
  scope       text,
  sector      text,
  reason      text not null,                  -- nao_entendeu | desistiu | negativo | limite
  answer      text,
  user_name   text,
  created_at  timestamptz not null default now()
);
create index if not exists max_misses_created_idx on public.max_misses (created_at desc);

-- Só o servidor (chave secreta) lê e grava: o navegador nunca acessa estas tabelas direto.
alter table public.max_learned enable row level security;
alter table public.max_notes   enable row level security;
alter table public.max_misses  enable row level security;
grant all on public.max_learned, public.max_notes, public.max_misses to service_role;

notify pgrst, 'reload schema';
select 'ok: aprendizado da Max ativado' as resultado;
