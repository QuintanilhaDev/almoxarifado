-- =====================================================================
--  Almoxarifado · Estoque e Postos
--  Cole TODO este arquivo no SQL Editor do Supabase e clique em "Run".
--  Pode rodar mais de uma vez sem problema (é idempotente).
--  Rode ANTES do arquivo seed_estoque.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Postos da empresa
-- ---------------------------------------------------------------------
create table if not exists public.postos (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  name_key    text generated always as (lower(btrim(name))) stored,
  code        text,
  city        text,
  address     text,
  supervisor  text,
  notes       text,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists postos_name_key_uidx on public.postos (name_key);

-- ---------------------------------------------------------------------
-- Itens do estoque. "quantity" é o saldo que está NO ALMOXARIFADO.
-- O que foi enviado aos postos fica em posto_stock.
-- ---------------------------------------------------------------------
create table if not exists public.stock_items (
  id            uuid primary key default gen_random_uuid(),
  ref           bigint generated always as identity,
  name          text not null check (length(btrim(name)) > 0),
  size          text,
  unit          text not null default 'Cada',
  quantity      integer not null default 0 check (quantity >= 0),
  min_quantity  integer not null default 0 check (min_quantity >= 0),
  cost          numeric(12,2) check (cost is null or cost >= 0),
  name_key      text generated always as (lower(btrim(name))) stored,
  size_key      text generated always as (lower(btrim(coalesce(size, '')))) stored,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists stock_items_key_uidx on public.stock_items (name_key, size_key);
create index if not exists stock_items_name_idx on public.stock_items (name_key);

-- ---------------------------------------------------------------------
-- Quanto de cada item está em cada posto
-- ---------------------------------------------------------------------
create table if not exists public.posto_stock (
  posto_id    uuid not null references public.postos (id) on delete cascade,
  item_id     uuid not null references public.stock_items (id) on delete cascade,
  quantity    integer not null check (quantity > 0),
  updated_at  timestamptz not null default now(),
  primary key (posto_id, item_id)
);
create index if not exists posto_stock_item_idx on public.posto_stock (item_id);

-- ---------------------------------------------------------------------
-- Histórico de movimentações (guarda os nomes, então continua legível
-- mesmo se o item ou o posto forem apagados depois)
-- ---------------------------------------------------------------------
create table if not exists public.stock_movements (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid references public.stock_items (id) on delete set null,
  item_name   text not null,
  posto_id    uuid references public.postos (id) on delete set null,
  posto_name  text,
  kind        text not null check (kind in
                ('entrada','saida','ajuste','transferencia','devolucao','baixa_posto','criacao','exclusao')),
  quantity    integer not null default 0,
  before_qty  integer,
  after_qty   integer,
  note        text,
  by_name     text,
  created_at  timestamptz not null default clock_timestamp()
);
create index if not exists stock_movements_created_idx on public.stock_movements (created_at desc);
create index if not exists stock_movements_item_idx    on public.stock_movements (item_id, created_at desc);
create index if not exists stock_movements_posto_idx   on public.stock_movements (posto_id, created_at desc);

-- ---------------------------------------------------------------------
-- Segurança: RLS ligado e SEM políticas públicas (igual às outras tabelas)
-- ---------------------------------------------------------------------
alter table public.postos           enable row level security;
alter table public.stock_items      enable row level security;
alter table public.posto_stock      enable row level security;
alter table public.stock_movements  enable row level security;

-- ---------------------------------------------------------------------
-- Movimentação atômica (trava a linha, valida o saldo e registra o histórico
-- na mesma transação, então dois cliques ao mesmo tempo nunca estouram o saldo).
--   entrada        → soma no almoxarifado
--   saida          → tira do almoxarifado (uso/baixa)
--   ajuste         → define o saldo do almoxarifado (p_qty = novo saldo)
--   transferencia  → almoxarifado → posto
--   devolucao      → posto → almoxarifado
--   baixa_posto    → o posto consumiu o item (sai do posto)
-- ---------------------------------------------------------------------
create or replace function public.stock_move(
  p_item  uuid,
  p_kind  text,
  p_qty   integer,
  p_posto uuid,
  p_note  text,
  p_by    text
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_item     public.stock_items%rowtype;
  v_posto    public.postos%rowtype;
  v_have     integer;
  v_before   integer;
  v_after    integer;
  v_label    text;
  v_posto_q  integer := null;
  v_moved    integer;
begin
  if p_kind not in ('entrada','saida','ajuste','transferencia','devolucao','baixa_posto') then
    raise exception 'Tipo de movimentação inválido.';
  end if;
  if p_qty is null or p_qty < 0 or (p_qty = 0 and p_kind <> 'ajuste') then
    raise exception 'Informe uma quantidade maior que zero.';
  end if;
  if p_qty > 1000000 then
    raise exception 'Quantidade grande demais.';
  end if;

  select * into v_item from public.stock_items where id = p_item for update;
  if not found then
    raise exception 'Item não encontrado.';
  end if;
  v_label := v_item.name || coalesce(' · ' || nullif(btrim(v_item.size), ''), '');
  v_before := v_item.quantity;
  v_after := v_before;
  v_moved := p_qty;

  if p_kind in ('transferencia','devolucao','baixa_posto') then
    select * into v_posto from public.postos where id = p_posto for update;
    if not found then
      raise exception 'Posto não encontrado.';
    end if;
  end if;

  if p_kind = 'entrada' then
    v_after := v_before + p_qty;

  elsif p_kind = 'saida' then
    if v_before < p_qty then
      raise exception 'Saldo insuficiente de "%": há apenas % no almoxarifado.', v_label, v_before;
    end if;
    v_after := v_before - p_qty;

  elsif p_kind = 'ajuste' then
    v_after := p_qty;
    v_moved := abs(v_after - v_before);

  elsif p_kind = 'transferencia' then
    if v_before < p_qty then
      raise exception 'Saldo insuficiente de "%": há apenas % no almoxarifado.', v_label, v_before;
    end if;
    v_after := v_before - p_qty;
    insert into public.posto_stock (posto_id, item_id, quantity)
      values (p_posto, p_item, p_qty)
      on conflict (posto_id, item_id)
      do update set quantity = public.posto_stock.quantity + excluded.quantity, updated_at = now()
      returning quantity into v_posto_q;

  else -- devolucao | baixa_posto
    select quantity into v_have from public.posto_stock
      where posto_id = p_posto and item_id = p_item for update;
    v_have := coalesce(v_have, 0);
    if v_have < p_qty then
      raise exception 'O posto % tem apenas % de "%".', v_posto.name, v_have, v_label;
    end if;
    v_posto_q := v_have - p_qty;
    if v_posto_q = 0 then
      delete from public.posto_stock where posto_id = p_posto and item_id = p_item;
    else
      update public.posto_stock set quantity = v_posto_q, updated_at = now()
        where posto_id = p_posto and item_id = p_item;
    end if;
    if p_kind = 'devolucao' then
      v_after := v_before + p_qty;
    end if;
  end if;

  if v_after <> v_before then
    update public.stock_items set quantity = v_after, updated_at = now() where id = p_item;
  end if;

  insert into public.stock_movements
    (item_id, item_name, posto_id, posto_name, kind, quantity, before_qty, after_qty, note, by_name)
  values
    (p_item, v_label, case when v_posto.id is null then null else v_posto.id end, v_posto.name,
     p_kind, v_moved, v_before, v_after, nullif(btrim(coalesce(p_note, '')), ''), p_by);

  return jsonb_build_object('quantity', v_after, 'posto_quantity', v_posto_q);
end;
$$;

-- ---------------------------------------------------------------------
-- Vários itens de uma vez (tudo ou nada): se um item não tiver saldo,
-- nada é enviado. p_lines = [{"item_id": "...", "quantity": 3}, ...]
-- ---------------------------------------------------------------------
create or replace function public.stock_move_many(
  p_kind  text,
  p_posto uuid,
  p_lines jsonb,
  p_note  text,
  p_by    text
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r      record;
  v_n    integer := 0;
  v_u    integer := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Escolha pelo menos um item.';
  end if;
  if jsonb_array_length(p_lines) > 300 then
    raise exception 'Envie no máximo 300 itens por vez.';
  end if;
  -- ordem fixa evita travas cruzadas quando duas pessoas enviam ao mesmo tempo
  for r in
    select (e->>'item_id')::uuid as item_id, sum((e->>'quantity')::integer)::integer as qty
      from jsonb_array_elements(p_lines) e
     group by 1
     order by 1
  loop
    perform public.stock_move(r.item_id, p_kind, r.qty, p_posto, p_note, p_by);
    v_n := v_n + 1;
    v_u := v_u + r.qty;
  end loop;
  return jsonb_build_object('items', v_n, 'units', v_u);
end;
$$;

-- ---------------------------------------------------------------------
-- Remover posto: tudo que estava nele volta para o almoxarifado
-- (com histórico) e só então o posto é apagado.
-- ---------------------------------------------------------------------
create or replace function public.remove_posto(p_posto uuid, p_by text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_posto    public.postos%rowtype;
  r          record;
  v_before   integer;
  v_returned integer := 0;
begin
  select * into v_posto from public.postos where id = p_posto for update;
  if not found then
    raise exception 'Posto não encontrado.';
  end if;

  for r in
    select ps.item_id, ps.quantity, si.name, si.size
      from public.posto_stock ps
      join public.stock_items si on si.id = ps.item_id
     where ps.posto_id = p_posto
     order by ps.item_id
  loop
    select quantity into v_before from public.stock_items where id = r.item_id for update;
    update public.stock_items set quantity = quantity + r.quantity, updated_at = now() where id = r.item_id;
    insert into public.stock_movements
      (item_id, item_name, posto_id, posto_name, kind, quantity, before_qty, after_qty, note, by_name)
    values
      (r.item_id, r.name || coalesce(' · ' || nullif(btrim(r.size), ''), ''), p_posto, v_posto.name,
       'devolucao', r.quantity, v_before, v_before + r.quantity, 'Posto removido', p_by);
    v_returned := v_returned + r.quantity;
  end loop;

  delete from public.postos where id = p_posto;
  return jsonb_build_object('returned', v_returned, 'name', v_posto.name);
end;
$$;

-- ---------------------------------------------------------------------
-- Permissões: só o servidor (service_role) usa as tabelas e as funções.
-- ---------------------------------------------------------------------
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

revoke all on function public.stock_move(uuid, text, integer, uuid, text, text) from public, anon, authenticated;
revoke all on function public.stock_move_many(text, uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.remove_posto(uuid, text) from public, anon, authenticated;
grant execute on function public.stock_move(uuid, text, integer, uuid, text, text) to service_role;
grant execute on function public.stock_move_many(text, uuid, jsonb, text, text) to service_role;
grant execute on function public.remove_posto(uuid, text) to service_role;

-- Faz a API do Supabase enxergar as funções novas imediatamente.
notify pgrst, 'reload schema';
