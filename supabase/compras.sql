-- =====================================================================
--  Compras · Solicitações de compra (Almoxarifado → Compras)
--  Cole TODO este arquivo no SQL Editor do Supabase e clique em "Run".
--  Pode rodar mais de uma vez. Não mexe em nenhuma tabela que já existe.
-- =====================================================================

create table if not exists public.purchase_requests (
  id            uuid primary key default gen_random_uuid(),
  number        bigint generated always as identity unique,   -- nº da solicitação (#0001)
  from_sector   text not null default 'almoxarifado',          -- quem pediu
  status        text not null default 'nova',
  priority      text not null default 'normal',
  reason        text,                                          -- justificativa
  needed_by     date,                                          -- precisa até
  items         jsonb not null default '[]'::jsonb,            -- [{item_id, name, size, unit, quantity, note, stock, min}]
  requested_by  text not null,
  requested_by_id uuid,
  handled_by    text,                                          -- quem cuidou em Compras
  response      text,                                          -- resposta de Compras
  history       jsonb not null default '[]'::jsonb,            -- [{at, by, status, note}]
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'purchase_requests_status_check') then
    alter table public.purchase_requests
      add constraint purchase_requests_status_check
      check (status in ('nova', 'em_cotacao', 'comprada', 'entregue', 'recusada', 'cancelada'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'purchase_requests_priority_check') then
    alter table public.purchase_requests
      add constraint purchase_requests_priority_check check (priority in ('normal', 'urgente'));
  end if;
end $$;

create index if not exists purchase_requests_created_idx on public.purchase_requests (created_at desc);
create index if not exists purchase_requests_status_idx on public.purchase_requests (status);

-- Só o servidor (chave secreta) lê e grava: o navegador nunca acessa a tabela direto.
alter table public.purchase_requests enable row level security;
grant all on public.purchase_requests to service_role;

notify pgrst, 'reload schema';
select 'ok: solicitações de compra ativadas' as resultado;
