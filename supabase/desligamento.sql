-- =====================================================================
--  Max Hub · Desligamento de colaboradores e devolução de fardamento
--
--  Cole TODO este arquivo no SQL Editor do Supabase e clique em "Run".
--  Rode DEPOIS de: pedidos_e_notas.sql (que cria a tabela de colaboradores).
--
--  Cria: dados do desligamento no cadastro do colaborador, o cliente
--  (tomador do serviço) e a conferência da devolução de cada item entregue
--  (data, quantidade, situação devolvido / pendente / não devolvido, observação).
--
--  Só REGISTRA a devolução: não mexe no saldo do estoque. A avaliação do item,
--  a higienização e o reaproveitamento ficam para o controle de estoque.
--
--  NÃO apaga nada. Pode rodar mais de uma vez (é idempotente).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Colaborador: cliente e dados do desligamento
-- ---------------------------------------------------------------------
alter table public.collaborators add column if not exists client            text;
alter table public.collaborators add column if not exists dismissed_at      date;
alter table public.collaborators add column if not exists dismissal_reason  text;
alter table public.collaborators add column if not exists dismissal_notes   text;
alter table public.collaborators add column if not exists dismissed_by      text;
create index if not exists collaborators_active_idx on public.collaborators (active);

-- ---------------------------------------------------------------------
-- 2) Devolução de cada item (uma linha por item/tamanho entregue)
-- ---------------------------------------------------------------------
create table if not exists public.collaborator_returns (
  id                 uuid primary key default gen_random_uuid(),
  collaborator_id    uuid not null references public.collaborators (id) on delete cascade,
  -- de onde veio o item: entrega registrada no sistema, planilha de controle (Gestão) ou digitado
  source             text not null default 'sistema' check (source in ('sistema','planilha','manual')),
  item_name          text not null check (length(btrim(item_name)) > 0),
  size               text,
  qty_delivered      integer not null default 0 check (qty_delivered >= 0),
  last_delivered_at  date,
  qty_returned       integer not null default 0 check (qty_returned >= 0),
  status             text not null default 'pendente' check (status in ('pendente','devolvido','nao_devolvido')),
  returned_at        date,
  notes              text,
  history            jsonb not null default '[]'::jsonb,
  created_by         text,
  created_at         timestamptz not null default now(),
  updated_by         text,
  updated_at         timestamptz not null default now()
);
create index if not exists collaborator_returns_collab_idx on public.collaborator_returns (collaborator_id);
create index if not exists collaborator_returns_status_idx on public.collaborator_returns (status);

-- ---------------------------------------------------------------------
-- 3) Segurança: só o servidor (chave secreta) lê e grava
-- ---------------------------------------------------------------------
alter table public.collaborator_returns enable row level security;
grant all on public.collaborator_returns to service_role;

notify pgrst, 'reload schema';
select 'ok: desligamento e devolução ativados' as resultado;
