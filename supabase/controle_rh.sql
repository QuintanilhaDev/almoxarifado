-- =====================================================================
--  Max Hub · Controle de ASO, cursos e documentos (RH)
--
--  Cole TODO este arquivo no SQL Editor do Supabase e clique em "Run".
--  Rode DEPOIS de: pedidos_e_notas.sql e desligamento.sql.
--
--  Cria:
--   1) exigências (ASO, cursos, reciclagens, documentos): nome, a quem se
--      aplica (funções, clientes, empresas), validade e antecedência do
--      alerta. Nova exigência = novo cadastro, sem mexer no sistema;
--   2) registros de cada colaborador: um por realização (data em que fez,
--      validade e observação). O histórico fica guardado; vale o mais recente.
--
--  O prazo de troca de cada peça do fardamento fica no próprio kit da
--  função (campo do item), sem tabela nova. Cada peça entregue já tem a
--  própria data na tabela de entregas.
--
--  NÃO apaga nada. Pode rodar mais de uma vez (é idempotente).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Exigências
-- ---------------------------------------------------------------------
create table if not exists public.requirements (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null default 'curso' check (kind in ('aso','curso','documento')),
  name             text not null check (length(btrim(name)) > 0),
  -- a quem se aplica: listas vazias = todos
  roles            text[] not null default '{}',
  clients          text[] not null default '{}',
  companies        text[] not null default '{}',
  validity_months  integer not null default 12 check (validity_months between 1 and 120),
  alert_days       integer not null default 60 check (alert_days between 0 and 365),
  notes            text,
  active           boolean not null default true,
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_by       text,
  updated_at       timestamptz not null default now()
);
create unique index if not exists requirements_name_uidx on public.requirements (lower(btrim(name)));

-- ---------------------------------------------------------------------
-- 2) Registros por colaborador (histórico: uma linha por realização)
-- ---------------------------------------------------------------------
create table if not exists public.collaborator_records (
  id               uuid primary key default gen_random_uuid(),
  collaborator_id  uuid not null references public.collaborators (id) on delete cascade,
  requirement_id   uuid not null references public.requirements (id) on delete cascade,
  done_at          date not null,
  -- vazio = data de realização + validade da exigência
  expires_at       date,
  notes            text,
  created_by       text,
  created_at       timestamptz not null default now()
);
create index if not exists collaborator_records_collab_idx on public.collaborator_records (collaborator_id);
create index if not exists collaborator_records_req_idx on public.collaborator_records (requirement_id, done_at desc);

-- ---------------------------------------------------------------------
-- 3) Exigências iniciais (podem ser alteradas ou desativadas na tela)
-- ---------------------------------------------------------------------
insert into public.requirements (kind, name, roles, validity_months, alert_days, notes, created_by)
values
  ('aso', 'ASO periódico', '{}', 12, 60, 'Periodicidade conforme o PCMSO de cada função; ajuste a validade se for diferente.', 'sistema'),
  ('curso', 'Reciclagem de vigilante', '{VIGILANTE}', 24, 60, 'Curso de reciclagem do vigilante (a cada 2 anos).', 'sistema')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 4) Segurança: só o servidor (chave secreta) lê e grava
-- ---------------------------------------------------------------------
alter table public.requirements enable row level security;
alter table public.collaborator_records enable row level security;
grant all on public.requirements to service_role;
grant all on public.collaborator_records to service_role;

notify pgrst, 'reload schema';
select 'ok: controle de ASO, cursos e documentos ativado' as resultado;
