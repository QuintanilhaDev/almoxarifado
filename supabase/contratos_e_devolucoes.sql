-- =====================================================================
--  Max Hub · Contratos (RH), postos no RH e estoque de devolução Fard/EPI
--
--  Cole TODO este arquivo no SQL Editor do Supabase e clique em "Run".
--  Rode DEPOIS de: estoque.sql, pedidos_e_notas.sql, desligamento.sql e
--  controle_rh.sql.
--
--  Cria:
--   1) contratos (clientes): CNPJ, empresa, vigência, se a portaria é social
--      (kit social) e se a importação de colaboradores deve ignorar o contrato;
--      cada posto pode ficar ligado a um contrato;
--   2) estoque de devolução: cada peça devolvida por um colaborador entra num
--      estoque transitório até ser avaliada (higienização e entrada no estoque,
--      ou descarte).
--
--  NÃO apaga nada. Pode rodar mais de uma vez (é idempotente).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Contratos
-- ---------------------------------------------------------------------
create table if not exists public.contracts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(btrim(name)) > 0),
  name_key        text generated always as (lower(btrim(name))) stored,
  -- outros nomes do mesmo cliente na planilha de colaboradores (coluna "cliente")
  aliases         text[] not null default '{}',
  cnpj            text,
  company         text,
  start_date      date,
  end_date        date,
  active          boolean not null default true,
  -- portaria social: o AGENTE DE PORTARIA deste contrato recebe o kit "AGENTE DE PORTARIA SOCIAL"
  portaria_social boolean not null default false,
  -- a importação da planilha de colaboradores ignora quem é deste contrato
  block_import    boolean not null default false,
  notes           text,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_by      text,
  updated_at      timestamptz not null default now()
);
create unique index if not exists contracts_name_key_uidx on public.contracts (name_key);

alter table public.postos add column if not exists contract_id uuid references public.contracts (id) on delete set null;
create index if not exists postos_contract_idx on public.postos (contract_id);

-- um contrato para cada cliente que já está no cadastro de colaboradores
insert into public.contracts (name, company, created_by)
select c.client, (array_agg(c.company order by c.company))[1], 'sistema'
from public.collaborators c
where nullif(btrim(c.client), '') is not null
group by c.client
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2) Estoque de devolução Fard/EPI (transitório)
-- ---------------------------------------------------------------------
create table if not exists public.return_stock (
  id               uuid primary key default gen_random_uuid(),
  return_id        uuid references public.collaborator_returns (id) on delete set null,
  collaborator_id  uuid references public.collaborators (id) on delete set null,
  collaborator_name text,
  item_name        text not null,
  size             text,
  qty              integer not null check (qty > 0),
  received_at      date not null default current_date,
  -- aguardando avaliação → higienização → reaproveitado (entrada no estoque) | descartado
  status           text not null default 'aguardando' check (status in ('aguardando','higienizacao','reaproveitado','descartado')),
  stock_item_id    uuid references public.stock_items (id) on delete set null,
  decided_by       text,
  decided_at       timestamptz,
  notes            text,
  history          jsonb not null default '[]'::jsonb,
  created_by       text,
  created_at       timestamptz not null default now()
);
create index if not exists return_stock_status_idx on public.return_stock (status, received_at);
-- um item da devolução pode virar mais de um lote (parte reaproveitada, parte descartada)
create index if not exists return_stock_return_idx on public.return_stock (return_id);

-- ---------------------------------------------------------------------
-- 3) Segurança: só o servidor (chave secreta) lê e grava
-- ---------------------------------------------------------------------
alter table public.contracts enable row level security;
alter table public.return_stock enable row level security;
grant all on public.contracts to service_role;
grant all on public.return_stock to service_role;

notify pgrst, 'reload schema';
select 'ok: contratos e estoque de devolução ativados' as resultado;
