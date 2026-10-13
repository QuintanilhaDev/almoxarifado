-- =====================================================================
--  Max Hub · Projeto 3 — Estoque e Almoxarifado (especificação v2.0)
--  Cole TODO este arquivo no SQL Editor do Supabase e clique em "Run".
--  Rode DEPOIS de: estoque.sql, baixa_e_usuarios.sql, maxhub.sql, categorias.sql e compras.sql.
--
--  Cria: catálogo com código CC-GG-NNNN, fornecedores, notas fiscais (entradas),
--  colaboradores, kits por função, pedidos de material (Operação / RH-DP),
--  reservas, entregas com termo, inventário e baixas por perda.
--
--  NÃO apaga nem altera saldos, custos ou histórico que já existem.
--  Pode rodar mais de uma vez (é idempotente).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Catálogo: categorias/grupos e código automático CC-GG-NNNN
-- ---------------------------------------------------------------------
create table if not exists public.catalog_groups (
  cat         text not null check (cat ~ '^[0-9]{2}$'),
  grp         text not null check (grp ~ '^[0-9]{2}$'),
  name        text not null check (length(btrim(name)) > 0),
  created_at  timestamptz not null default now(),
  primary key (cat, grp)
);

-- último número usado em cada grupo (nunca volta: código apagado não é reutilizado)
create table if not exists public.catalog_seq (
  cat   text not null,
  grp   text not null,
  last  integer not null default 0,
  primary key (cat, grp)
);

insert into public.catalog_groups (cat, grp, name) values
  ('01','01','Camisas'), ('01','02','Calças'), ('01','03','Calçados'), ('01','04','Jaquetas e agasalhos'),
  ('01','05','Bonés e coberturas'), ('01','06','Cintos e acessórios do fardamento'),
  ('02','01','Proteção das mãos'), ('02','02','Proteção da cabeça'), ('02','03','Proteção dos olhos'),
  ('02','04','Proteção auditiva'), ('02','05','Proteção respiratória'), ('02','06','Coletes e sinalização'),
  ('03','01','Comunicação'), ('03','02','Acessórios operacionais'), ('03','03','Iluminação'),
  ('04','01','Armamento'), ('04','02','Munições'),
  ('05','01','Câmeras'), ('05','02','Alarmes'),
  ('06','01','Computadores'), ('06','02','Celulares'),
  ('07','01','Limpeza'), ('07','02','Escritório'),
  ('08','01','Ferramentas'), ('08','02','Peças'),
  ('09','01','Mobiliário'), ('09','02','Utensílios'),
  ('10','01','Diversos')
on conflict (cat, grp) do nothing;

alter table public.stock_items add column if not exists code          text;
alter table public.stock_items add column if not exists cat_code      text;
alter table public.stock_items add column if not exists grp_code      text;
alter table public.stock_items add column if not exists brand         text;
alter table public.stock_items add column if not exists ca_number     text;
alter table public.stock_items add column if not exists location      text;
alter table public.stock_items add column if not exists max_quantity  integer;
alter table public.stock_items add column if not exists lead_days     integer;
alter table public.stock_items add column if not exists safety_qty    integer;
alter table public.stock_items add column if not exists reserved      integer not null default 0;
alter table public.stock_items add column if not exists active        boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_items_reserved_check') then
    alter table public.stock_items add constraint stock_items_reserved_check check (reserved >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_items_params_check') then
    alter table public.stock_items add constraint stock_items_params_check check (
      (max_quantity is null or max_quantity >= 0) and (lead_days is null or lead_days between 0 and 365) and (safety_qty is null or safety_qty >= 0)
    );
  end if;
end $$;
create unique index if not exists stock_items_code_uidx on public.stock_items (code) where code is not null;

-- O código, depois de dado, não muda; e o saldo físico nunca fica menor do que o reservado.
create or replace function public.stock_items_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.code is not null and (new.code is distinct from old.code or new.cat_code is distinct from old.cat_code or new.grp_code is distinct from old.grp_code) then
    raise exception 'O código do item (%) não pode ser alterado.', old.code;
  end if;
  if new.quantity < new.reserved then
    raise exception 'Há % unidade(s) de "%" reservada(s) para pedidos. Entregue pelo pedido ou libere a reserva antes de tirar do estoque.',
      new.reserved, new.name || coalesce(' · ' || nullif(btrim(new.size), ''), '');
  end if;
  return new;
end $$;
drop trigger if exists stock_items_guard on public.stock_items;
create trigger stock_items_guard before update on public.stock_items for each row execute function public.stock_items_guard();

create or replace function public.assign_item_code(p_item uuid, p_cat text, p_grp text)
returns text language plpgsql set search_path = public as $$
declare
  v_item public.stock_items%rowtype;
  v_n integer;
  v_code text;
begin
  if not exists (select 1 from public.catalog_groups where cat = p_cat and grp = p_grp) then
    raise exception 'Grupo %-% não existe no catálogo.', p_cat, p_grp;
  end if;
  select * into v_item from public.stock_items where id = p_item for update;
  if not found then raise exception 'Item não encontrado.'; end if;
  if v_item.code is not null then
    raise exception 'O item já tem o código % (o código não muda).', v_item.code;
  end if;
  insert into public.catalog_seq (cat, grp, last) values (p_cat, p_grp, 0) on conflict (cat, grp) do nothing;
  update public.catalog_seq set last = last + 1 where cat = p_cat and grp = p_grp returning last into v_n;
  if v_n > 9999 then raise exception 'O grupo %-% chegou ao limite de 9999 itens.', p_cat, p_grp; end if;
  v_code := p_cat || '-' || p_grp || '-' || lpad(v_n::text, 4, '0');
  update public.stock_items set code = v_code, cat_code = p_cat, grp_code = p_grp, updated_at = now() where id = p_item;
  return v_code;
end $$;

-- ---------------------------------------------------------------------
-- 2) Histórico: novos tipos de movimentação e vínculos
-- ---------------------------------------------------------------------
alter table public.stock_movements add column if not exists fiscal_note_id uuid;
alter table public.stock_movements add column if not exists order_id       uuid;
alter table public.stock_movements add column if not exists collaborator   text;
alter table public.stock_movements drop constraint if exists stock_movements_kind_check;
alter table public.stock_movements add constraint stock_movements_kind_check check (kind in (
  'entrada','saida','ajuste','transferencia','devolucao','baixa_posto','criacao','exclusao',
  'entrega','estorno','perda','devolucao_fornecedor','inventario','devolucao_colaborador'
));
create index if not exists stock_movements_order_idx on public.stock_movements (order_id) where order_id is not null;
create index if not exists stock_movements_note_idx  on public.stock_movements (fiscal_note_id) where fiscal_note_id is not null;

-- ---------------------------------------------------------------------
-- 3) Fornecedores e notas fiscais (entradas)
-- ---------------------------------------------------------------------
create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  cnpj        text,
  phone       text,
  email       text,
  created_at  timestamptz not null default now()
);
create unique index if not exists suppliers_cnpj_uidx on public.suppliers (cnpj) where cnpj is not null;

-- o que cada fornecedor chama de quê (aprende ao lançar as notas: próxima nota já vem ligada)
create table if not exists public.supplier_items (
  supplier_id    uuid not null references public.suppliers (id) on delete cascade,
  supplier_code  text not null,
  item_id        uuid not null references public.stock_items (id) on delete cascade,
  updated_at     timestamptz not null default now(),
  primary key (supplier_id, supplier_code)
);

create table if not exists public.fiscal_notes (
  id                  uuid primary key default gen_random_uuid(),
  number              text not null,
  series              text,
  access_key          text,
  supplier_id         uuid references public.suppliers (id) on delete set null,
  supplier_name       text not null,
  cnpj                text,
  company             text,
  company_cnpj        text,
  issue_date          date,
  received_date       date,
  status              text not null default 'aberta' check (status in ('aberta','parcial','lancada','estornada')),
  items               jsonb not null default '[]'::jsonb,
  totals              jsonb not null default '{}'::jsonb,
  installments        jsonb not null default '[]'::jsonb,
  payment             text,
  purchase_request_id uuid references public.purchase_requests (id) on delete set null,
  xml                 text,
  note                text,
  created_by          text,
  posted_at           timestamptz,
  history             jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists fiscal_notes_key_uidx on public.fiscal_notes (access_key) where access_key is not null and status <> 'estornada';
create unique index if not exists fiscal_notes_num_uidx on public.fiscal_notes (coalesce(cnpj, ''), number, coalesce(series, '')) where status <> 'estornada';
create index if not exists fiscal_notes_created_idx on public.fiscal_notes (created_at desc);

-- Dar entrada (total ou parcial) do que foi conferido fisicamente.
-- p_lines = [{"i": 0, "item_id": "...", "qty": 10}]  (i = linha da nota)
create or replace function public.post_fiscal_note(p_note uuid, p_lines jsonb, p_by text)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_note   public.fiscal_notes%rowtype;
  v_items  jsonb;
  v_line   jsonb;
  r        record;
  v_item   public.stock_items%rowtype;
  v_i      integer;
  v_qty    integer;
  v_rem    numeric;
  v_unit   numeric;
  v_cost   numeric;
  v_label  text;
  v_units  integer := 0;
  v_done   boolean := true;
  v_status text;
  v_target uuid;
begin
  select * into v_note from public.fiscal_notes where id = p_note for update;
  if not found then raise exception 'Nota fiscal não encontrada.'; end if;
  if v_note.status in ('lancada','estornada') then
    raise exception 'Esta nota já foi % e não recebe mais entradas.', case when v_note.status = 'lancada' then 'lançada por completo' else 'estornada' end;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Informe o que foi recebido.';
  end if;
  v_items := v_note.items;
  for r in
    select (e->>'i')::int as i, (e->>'item_id')::uuid as item_id, (e->>'qty')::numeric as qty
      from jsonb_array_elements(p_lines) e order by (e->>'item_id')
  loop
    v_i := r.i;
    if v_i is null or v_i < 0 or v_i >= jsonb_array_length(v_items) then raise exception 'Linha da nota inválida.'; end if;
    v_line := v_items -> v_i;
    if r.qty is null or r.qty <= 0 then continue; end if;
    if r.qty <> trunc(r.qty) then raise exception 'Linha %: a quantidade recebida precisa ser inteira.', v_i + 1; end if;
    v_qty := r.qty::int;
    v_rem := coalesce((v_line->>'qty')::numeric, 0) - coalesce((v_line->>'received')::numeric, 0);
    if v_qty > v_rem then
      raise exception 'Linha % (%): faltam receber só %.', v_i + 1, v_line->>'description', v_rem;
    end if;
    v_target := coalesce(r.item_id, nullif(v_line->>'item_id', '')::uuid);
    if v_target is null then raise exception 'Linha % (%): escolha o item do estoque.', v_i + 1, v_line->>'description'; end if;
    if coalesce((v_line->>'received')::numeric, 0) > 0 and nullif(v_line->>'item_id', '')::uuid is distinct from v_target then
      raise exception 'Linha % (%): parte já entrou em outro item; não dá para trocar o item agora.', v_i + 1, v_line->>'description';
    end if;
    select * into v_item from public.stock_items where id = v_target for update;
    if not found then raise exception 'Linha %: item do estoque não encontrado.', v_i + 1; end if;
    v_unit := coalesce((v_line->>'unit_cost')::numeric, 0);
    v_cost := case when v_item.quantity + v_qty > 0
                   then round(((v_item.quantity * coalesce(v_item.cost, v_unit)) + v_qty * v_unit) / (v_item.quantity + v_qty), 2)
                   else v_unit end;
    v_label := v_item.name || coalesce(' · ' || nullif(btrim(v_item.size), ''), '');
    update public.stock_items set quantity = quantity + v_qty, cost = v_cost, active = true, updated_at = now() where id = v_target;
    insert into public.stock_movements (item_id, item_name, kind, quantity, before_qty, after_qty, note, by_name, fiscal_note_id)
      values (v_target, v_label, 'entrada', v_qty, v_item.quantity, v_item.quantity + v_qty,
              'NF ' || v_note.number || coalesce('/' || v_note.series, '') || ' — ' || v_note.supplier_name, p_by, p_note);
    v_items := jsonb_set(v_items, array[v_i::text], v_line || jsonb_build_object(
      'item_id', v_target,
      'received', coalesce((v_line->>'received')::numeric, 0) + v_qty));
    if v_note.supplier_id is not null and coalesce(v_line->>'code', '') <> '' then
      insert into public.supplier_items (supplier_id, supplier_code, item_id) values (v_note.supplier_id, v_line->>'code', v_target)
        on conflict (supplier_id, supplier_code) do update set item_id = excluded.item_id, updated_at = now();
    end if;
    v_units := v_units + v_qty;
  end loop;
  if v_units = 0 then raise exception 'Nada a lançar: informe quantidades recebidas maiores que zero.'; end if;
  for v_i in 0 .. jsonb_array_length(v_items) - 1 loop
    if coalesce((v_items->v_i->>'received')::numeric, 0) < coalesce((v_items->v_i->>'qty')::numeric, 0) then v_done := false; end if;
  end loop;
  v_status := case when v_done then 'lancada' else 'parcial' end;
  update public.fiscal_notes
     set items = v_items, status = v_status, posted_at = coalesce(posted_at, now()), updated_at = now(),
         received_date = coalesce(received_date, (now() at time zone 'America/Bahia')::date),
         history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', p_by, 'what',
                   case when v_done then 'Entrada lançada' else 'Entrada parcial lançada' end || ' (' || v_units || ' unidades)'))
   where id = p_note;
  return jsonb_build_object('status', v_status, 'units', v_units);
end $$;

-- Estorno: desfaz as entradas da nota com movimentos novos (a entrada original fica no histórico).
create or replace function public.reverse_fiscal_note(p_note uuid, p_reason text, p_by text)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_note  public.fiscal_notes%rowtype;
  v_line  jsonb;
  v_item  public.stock_items%rowtype;
  v_qty   integer;
  v_unit  numeric;
  v_cost  numeric;
  v_label text;
  v_units integer := 0;
  r       record;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Diga o motivo do estorno.'; end if;
  select * into v_note from public.fiscal_notes where id = p_note for update;
  if not found then raise exception 'Nota fiscal não encontrada.'; end if;
  if v_note.status = 'estornada' then raise exception 'Esta nota já foi estornada.'; end if;
  for r in
    select e as line from jsonb_array_elements(v_note.items) e
     where coalesce((e->>'received')::numeric, 0) > 0 order by (e->>'item_id')
  loop
    v_line := r.line;
    v_qty := (v_line->>'received')::numeric::int;
    select * into v_item from public.stock_items where id = (v_line->>'item_id')::uuid for update;
    if not found then continue; end if;
    v_label := v_item.name || coalesce(' · ' || nullif(btrim(v_item.size), ''), '');
    if v_item.quantity - v_item.reserved < v_qty then
      raise exception 'Não dá para estornar: de "%" entraram % pela nota, mas só % estão livres no estoque (o resto já saiu ou está reservado).',
        v_label, v_qty, v_item.quantity - v_item.reserved;
    end if;
    v_unit := coalesce((v_line->>'unit_cost')::numeric, 0);
    v_cost := case when v_item.quantity - v_qty > 0 and v_item.cost is not null
                   then greatest(0, round((v_item.quantity * v_item.cost - v_qty * v_unit) / (v_item.quantity - v_qty), 2))
                   else v_item.cost end;
    update public.stock_items set quantity = quantity - v_qty, cost = v_cost, updated_at = now() where id = v_item.id;
    insert into public.stock_movements (item_id, item_name, kind, quantity, before_qty, after_qty, note, by_name, fiscal_note_id)
      values (v_item.id, v_label, 'estorno', v_qty, v_item.quantity, v_item.quantity - v_qty,
              'Estorno da NF ' || v_note.number || ' — ' || btrim(p_reason), p_by, p_note);
    v_units := v_units + v_qty;
  end loop;
  update public.fiscal_notes
     set status = 'estornada', updated_at = now(),
         history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', p_by, 'what', 'Nota estornada: ' || btrim(p_reason)))
   where id = p_note;
  return jsonb_build_object('units', v_units);
end $$;

-- ---------------------------------------------------------------------
-- 4) Colaboradores e kits por função
-- ---------------------------------------------------------------------
create table if not exists public.collaborators (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) > 0),
  name_key     text generated always as (lower(btrim(name))) stored,
  matricula    text,
  role         text,
  posto_id     uuid references public.postos (id) on delete set null,
  posto_name   text,
  company      text,
  admitted_at  date,
  active       boolean not null default true,
  sizes        jsonb not null default '{}'::jsonb,
  phone        text,
  notes        text,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists collaborators_matricula_uidx on public.collaborators (matricula) where matricula is not null;
create index if not exists collaborators_name_idx on public.collaborators (name_key);

create table if not exists public.role_kits (
  role           text primary key,
  items          jsonb not null default '[]'::jsonb,   -- [{name, size_from, qty, item_id}]
  period_months  integer not null default 12 check (period_months between 1 and 60),
  updated_by     text,
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5) Pedidos de material (Operação via Uesley, RH/DP direto) e entregas
-- ---------------------------------------------------------------------
create table if not exists public.material_orders (
  id                 uuid primary key default gen_random_uuid(),
  number             bigint generated always as identity unique,
  origin             text not null check (origin in ('operacao','rh_admissao','rh_troca','rh_extra','almoxarifado')),
  stage              text not null default 'encaminhado' check (stage in ('solicitado','validacao','encaminhado','concluido','cancelado')),
  priority           text not null default 'normal' check (priority in ('normal','urgente')),
  needed_by          date,
  company            text,
  posto_id           uuid references public.postos (id) on delete set null,
  posto_name         text,
  collaborator_id    uuid references public.collaborators (id) on delete set null,
  collaborator_name  text,
  matricula          text,
  role               text,
  start_date         date,
  reason             text,
  requester          text not null,
  requester_id       uuid,
  supervisor         text,
  source_request_id  uuid references public.requests (id) on delete set null,
  items              jsonb not null default '[]'::jsonb,  -- [{item_id, name, size, unit, qty, reserved, delivered, purchase_id, purchase_number, note}]
  flags              jsonb not null default '[]'::jsonb,
  history            jsonb not null default '[]'::jsonb,
  forwarded_by       text,
  forwarded_at       timestamptz,
  validated_by       text,
  validated_at       timestamptz,
  closed_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists material_orders_created_idx on public.material_orders (created_at desc);
create index if not exists material_orders_stage_idx on public.material_orders (stage);
create index if not exists material_orders_collab_idx on public.material_orders (collaborator_id);

alter table public.requests add column if not exists order_id uuid;

create table if not exists public.deliveries (
  id                 uuid primary key default gen_random_uuid(),
  group_id           uuid not null,                       -- uma entrega = um termo
  order_id           uuid references public.material_orders (id) on delete set null,
  order_number       bigint,
  origin             text,
  kind               text not null default 'regular' check (kind in ('regular','extra')),
  collaborator_id    uuid references public.collaborators (id) on delete set null,
  collaborator_name  text,
  matricula          text,
  role               text,
  posto_name         text,
  item_id            uuid references public.stock_items (id) on delete set null,
  item_name          text not null,
  size               text,
  item_code          text,
  cat_code           text,
  grp_code           text,
  ca_number          text,
  qty                integer not null check (qty > 0),
  returned_qty       integer not null default 0 check (returned_qty >= 0),
  receiver           text,
  by_name            text,
  delivered_at       timestamptz not null default now()
);
create index if not exists deliveries_collab_idx on public.deliveries (collaborator_id, delivered_at desc);
create index if not exists deliveries_group_idx on public.deliveries (group_id);
create index if not exists deliveries_date_idx on public.deliveries (delivered_at desc);

-- Reservar (não mexe no saldo físico; reduz o disponível). p_lines = [{"i": 0, "qty": 2}]
-- Se a reserva deixar o item abaixo do mínimo, só passa com p_force (liberação excepcional).
create or replace function public.order_reserve(p_order uuid, p_lines jsonb, p_force boolean, p_by text)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_o     public.material_orders%rowtype;
  v_items jsonb;
  v_line  jsonb;
  v_item  public.stock_items%rowtype;
  v_free  integer;
  v_need  integer;
  v_label text;
  v_units integer := 0;
  v_below text := null;
  r       record;
begin
  select * into v_o from public.material_orders where id = p_order for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_o.stage <> 'encaminhado' then raise exception 'Só dá para reservar pedidos que estão com o Almoxarifado.'; end if;
  v_items := v_o.items;
  for r in
    select (e->>'i')::int as i, (e->>'qty')::int as qty from jsonb_array_elements(p_lines) e
     order by (v_items -> (e->>'i')::int ->> 'item_id')
  loop
    if r.i is null or r.i < 0 or r.i >= jsonb_array_length(v_items) then raise exception 'Linha do pedido inválida.'; end if;
    if r.qty is null or r.qty <= 0 then continue; end if;
    v_line := v_items -> r.i;
    if coalesce(v_line->>'item_id', '') = '' then
      raise exception 'O item "%" ainda não está ligado a um item do estoque.', v_line->>'name';
    end if;
    v_need := (v_line->>'qty')::int - coalesce((v_line->>'reserved')::int, 0) - coalesce((v_line->>'delivered')::int, 0);
    if r.qty > v_need then raise exception '"%": faltam reservar só %.', v_line->>'name', greatest(v_need, 0); end if;
    select * into v_item from public.stock_items where id = (v_line->>'item_id')::uuid for update;
    if not found then raise exception 'Item "%" não existe mais no estoque.', v_line->>'name'; end if;
    v_label := v_item.name || coalesce(' · ' || nullif(btrim(v_item.size), ''), '');
    v_free := v_item.quantity - v_item.reserved;
    if r.qty > v_free then raise exception 'Só há % disponíveis de "%" (o resto está reservado para outros pedidos).', greatest(v_free, 0), v_label; end if;
    if v_item.min_quantity > 0 and v_free - r.qty < v_item.min_quantity and not coalesce(p_force, false) then
      v_below := coalesce(v_below || ', ', '') || v_label;
    end if;
    update public.stock_items set reserved = reserved + r.qty, updated_at = now() where id = v_item.id;
    v_items := jsonb_set(v_items, array[r.i::text], v_line || jsonb_build_object('reserved', coalesce((v_line->>'reserved')::int, 0) + r.qty));
    v_units := v_units + r.qty;
  end loop;
  if v_below is not null then
    raise exception 'MINIMO|A reserva deixa abaixo do estoque mínimo: %. Para seguir, confirme a liberação excepcional.', v_below;
  end if;
  if v_units = 0 then raise exception 'Nada a reservar.'; end if;
  update public.material_orders
     set items = v_items, updated_at = now(),
         history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', p_by, 'what',
                   'Reservou ' || v_units || ' unidade(s)' || case when coalesce(p_force, false) then ' (liberação excepcional abaixo do mínimo)' else '' end))
   where id = p_order;
  return jsonb_build_object('units', v_units);
end $$;

-- Liberar reservas (todas ou só as linhas informadas)
create or replace function public.order_release(p_order uuid, p_lines jsonb, p_by text)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_o     public.material_orders%rowtype;
  v_items jsonb;
  v_line  jsonb;
  v_q     integer;
  v_units integer := 0;
  i       integer;
begin
  select * into v_o from public.material_orders where id = p_order for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  v_items := v_o.items;
  for i in 0 .. jsonb_array_length(v_items) - 1 loop
    if p_lines is not null and not exists (select 1 from jsonb_array_elements(p_lines) e where (e->>'i')::int = i) then continue; end if;
    v_line := v_items -> i;
    v_q := coalesce((v_line->>'reserved')::int, 0);
    if v_q > 0 and coalesce(v_line->>'item_id', '') <> '' then
      update public.stock_items set reserved = greatest(0, reserved - v_q), updated_at = now() where id = (v_line->>'item_id')::uuid;
      v_items := jsonb_set(v_items, array[i::text], v_line || jsonb_build_object('reserved', 0));
      v_units := v_units + v_q;
    end if;
  end loop;
  if v_units > 0 then
    update public.material_orders set items = v_items, updated_at = now(),
      history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', p_by, 'what', 'Liberou ' || v_units || ' unidade(s) reservada(s)'))
     where id = p_order;
  end if;
  return jsonb_build_object('units', v_units);
end $$;

-- Entregar: baixa o saldo físico (primeiro o que estava reservado), registra a entrega e o termo.
-- p_lines = [{"i": 0, "qty": 2}]; devolve o id do termo (group_id).
create or replace function public.order_deliver(p_order uuid, p_lines jsonb, p_receiver text, p_force boolean, p_by text)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_o      public.material_orders%rowtype;
  v_items  jsonb;
  v_line   jsonb;
  v_item   public.stock_items%rowtype;
  v_group  uuid := gen_random_uuid();
  v_res    integer;
  v_from   integer;
  v_extra  integer;
  v_left   integer;
  v_label  text;
  v_units  integer := 0;
  v_done   boolean := true;
  v_below  text := null;
  i        integer;
  r        record;
begin
  select * into v_o from public.material_orders where id = p_order for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_o.stage <> 'encaminhado' then raise exception 'Só dá para entregar pedidos que estão com o Almoxarifado.'; end if;
  v_items := v_o.items;
  for r in
    select (e->>'i')::int as i, (e->>'qty')::int as qty from jsonb_array_elements(p_lines) e
     order by (v_items -> (e->>'i')::int ->> 'item_id')
  loop
    if r.i is null or r.i < 0 or r.i >= jsonb_array_length(v_items) then raise exception 'Linha do pedido inválida.'; end if;
    if r.qty is null or r.qty <= 0 then continue; end if;
    v_line := v_items -> r.i;
    if coalesce(v_line->>'item_id', '') = '' then raise exception 'O item "%" ainda não está ligado a um item do estoque.', v_line->>'name'; end if;
    v_left := (v_line->>'qty')::int - coalesce((v_line->>'delivered')::int, 0);
    if r.qty > v_left then raise exception '"%": faltam entregar só %.', v_line->>'name', greatest(v_left, 0); end if;
    select * into v_item from public.stock_items where id = (v_line->>'item_id')::uuid for update;
    if not found then raise exception 'Item "%" não existe mais no estoque.', v_line->>'name'; end if;
    v_label := v_item.name || coalesce(' · ' || nullif(btrim(v_item.size), ''), '');
    v_res := coalesce((v_line->>'reserved')::int, 0);
    v_from := least(v_res, r.qty);
    v_extra := r.qty - v_from;
    if v_extra > v_item.quantity - v_item.reserved then
      raise exception 'Só há % disponíveis de "%" para entregar além do que estava reservado.', greatest(v_item.quantity - v_item.reserved, 0), v_label;
    end if;
    if v_extra > 0 and v_item.min_quantity > 0 and (v_item.quantity - v_item.reserved - v_extra) < v_item.min_quantity and not coalesce(p_force, false) then
      v_below := coalesce(v_below || ', ', '') || v_label;
    end if;
    update public.stock_items set quantity = quantity - r.qty, reserved = reserved - v_from, updated_at = now() where id = v_item.id;
    insert into public.stock_movements (item_id, item_name, posto_id, posto_name, kind, quantity, before_qty, after_qty, note, by_name, order_id, collaborator)
      values (v_item.id, v_label, v_o.posto_id, v_o.posto_name, 'entrega', r.qty, v_item.quantity, v_item.quantity - r.qty,
              'Pedido #' || lpad(v_o.number::text, 4, '0') || coalesce(' — ' || v_o.collaborator_name, ''), p_by, v_o.id, v_o.collaborator_name);
    insert into public.deliveries (group_id, order_id, order_number, origin, kind, collaborator_id, collaborator_name, matricula, role, posto_name,
                                   item_id, item_name, size, item_code, cat_code, grp_code, ca_number, qty, receiver, by_name)
      values (v_group, v_o.id, v_o.number, v_o.origin, case when v_o.origin = 'rh_extra' then 'extra' else 'regular' end,
              v_o.collaborator_id, v_o.collaborator_name, v_o.matricula, v_o.role, v_o.posto_name,
              v_item.id, v_item.name, v_item.size, v_item.code, v_item.cat_code, v_item.grp_code, v_item.ca_number, r.qty,
              nullif(btrim(coalesce(p_receiver, '')), ''), p_by);
    v_items := jsonb_set(v_items, array[r.i::text], v_line || jsonb_build_object(
      'reserved', v_res - v_from,
      'delivered', coalesce((v_line->>'delivered')::int, 0) + r.qty));
    v_units := v_units + r.qty;
  end loop;
  if v_below is not null then
    raise exception 'MINIMO|A entrega deixa abaixo do estoque mínimo: %. Para seguir, confirme a liberação excepcional.', v_below;
  end if;
  if v_units = 0 then raise exception 'Nada a entregar.'; end if;
  for i in 0 .. jsonb_array_length(v_items) - 1 loop
    if coalesce((v_items->i->>'delivered')::int, 0) < (v_items->i->>'qty')::int then v_done := false; end if;
  end loop;
  update public.material_orders
     set items = v_items, updated_at = now(),
         stage = case when v_done then 'concluido' else stage end,
         closed_at = case when v_done then now() else closed_at end,
         history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', p_by, 'what',
                   case when v_done then 'Entrega concluída' else 'Entrega parcial' end || ' (' || v_units || ' unidade(s))'
                   || coalesce(' para ' || nullif(btrim(p_receiver), ''), ''), 'term', v_group))
   where id = p_order;
  return jsonb_build_object('group_id', v_group, 'units', v_units, 'done', v_done);
end $$;

-- Cancelar: libera o que estava reservado
create or replace function public.order_cancel(p_order uuid, p_reason text, p_by text)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_o public.material_orders%rowtype;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Diga o motivo do cancelamento.'; end if;
  select * into v_o from public.material_orders where id = p_order for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_o.stage in ('concluido','cancelado') then raise exception 'Este pedido já está encerrado.'; end if;
  perform public.order_release(p_order, null, p_by);
  update public.material_orders set stage = 'cancelado', closed_at = now(), updated_at = now(),
    history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', p_by, 'what', 'Cancelado: ' || btrim(p_reason)))
   where id = p_order;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 6) Inventário, perdas e devoluções de colaborador
-- ---------------------------------------------------------------------
-- p_lines = [{"item_id": "...", "counted": 12}]
create or replace function public.inventory_apply(p_lines jsonb, p_note text, p_by text)
returns jsonb language plpgsql set search_path = public as $$
declare
  r       record;
  v_item  public.stock_items%rowtype;
  v_label text;
  v_n     integer := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Nenhuma contagem informada.'; end if;
  for r in select (e->>'item_id')::uuid as item_id, (e->>'counted')::int as counted from jsonb_array_elements(p_lines) e order by 1 loop
    if r.counted is null or r.counted < 0 then raise exception 'Contagem inválida.'; end if;
    select * into v_item from public.stock_items where id = r.item_id for update;
    if not found then continue; end if;
    if v_item.quantity = r.counted then continue; end if;
    v_label := v_item.name || coalesce(' · ' || nullif(btrim(v_item.size), ''), '');
    if r.counted < v_item.reserved then
      raise exception 'Contagem de "%" (%) é menor do que o reservado para pedidos (%). Libere a reserva antes.', v_label, r.counted, v_item.reserved;
    end if;
    update public.stock_items set quantity = r.counted, updated_at = now() where id = v_item.id;
    insert into public.stock_movements (item_id, item_name, kind, quantity, before_qty, after_qty, note, by_name)
      values (v_item.id, v_label, 'inventario', abs(r.counted - v_item.quantity), v_item.quantity, r.counted,
              coalesce(nullif(btrim(p_note), ''), 'Ajuste de inventário'), p_by);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('adjusted', v_n);
end $$;

-- Baixa por avaria, perda, descarte ou devolução ao fornecedor (sai do disponível, nunca do reservado)
create or replace function public.stock_writeoff(p_item uuid, p_qty integer, p_kind text, p_reason text, p_note_id uuid, p_by text)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_item  public.stock_items%rowtype;
  v_label text;
begin
  if p_kind not in ('perda','devolucao_fornecedor') then raise exception 'Tipo de baixa inválido.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Diga o motivo da baixa.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Informe a quantidade.'; end if;
  select * into v_item from public.stock_items where id = p_item for update;
  if not found then raise exception 'Item não encontrado.'; end if;
  v_label := v_item.name || coalesce(' · ' || nullif(btrim(v_item.size), ''), '');
  if p_qty > v_item.quantity - v_item.reserved then
    raise exception 'Só há % disponíveis de "%" (o resto está reservado).', greatest(v_item.quantity - v_item.reserved, 0), v_label;
  end if;
  update public.stock_items set quantity = quantity - p_qty, updated_at = now() where id = p_item;
  insert into public.stock_movements (item_id, item_name, kind, quantity, before_qty, after_qty, note, by_name, fiscal_note_id)
    values (p_item, v_label, p_kind, p_qty, v_item.quantity, v_item.quantity - p_qty, btrim(p_reason), p_by, p_note_id);
  return jsonb_build_object('quantity', v_item.quantity - p_qty);
end $$;

-- Colaborador devolveu o que recebeu: em bom estado volta ao estoque; avariado só fica registrado
create or replace function public.delivery_return(p_delivery uuid, p_qty integer, p_good boolean, p_reason text, p_by text)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_d     public.deliveries%rowtype;
  v_item  public.stock_items%rowtype;
  v_label text;
begin
  select * into v_d from public.deliveries where id = p_delivery for update;
  if not found then raise exception 'Entrega não encontrada.'; end if;
  if p_qty is null or p_qty <= 0 or p_qty > v_d.qty - v_d.returned_qty then
    raise exception 'Quantidade inválida: dá para devolver até %.', v_d.qty - v_d.returned_qty;
  end if;
  update public.deliveries set returned_qty = returned_qty + p_qty where id = p_delivery;
  v_label := v_d.item_name || coalesce(' · ' || nullif(btrim(v_d.size), ''), '');
  if v_d.item_id is not null then
    select * into v_item from public.stock_items where id = v_d.item_id for update;
  end if;
  if p_good and v_item.id is not null then
    update public.stock_items set quantity = quantity + p_qty, updated_at = now() where id = v_item.id;
  end if;
  insert into public.stock_movements (item_id, item_name, kind, quantity, before_qty, after_qty, note, by_name, order_id, collaborator)
    values (v_d.item_id, v_label, 'devolucao_colaborador', p_qty, v_item.quantity,
            case when p_good and v_item.id is not null then v_item.quantity + p_qty else v_item.quantity end,
            case when p_good then 'Devolvido em bom estado' else 'Devolvido avariado (descartado)' end || coalesce(' — ' || nullif(btrim(p_reason), ''), ''),
            p_by, v_d.order_id, v_d.collaborator_name);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 7) Compras: fornecedor, nº do pedido e previsão de recebimento
-- ---------------------------------------------------------------------
alter table public.purchase_requests add column if not exists supplier       text;
alter table public.purchase_requests add column if not exists order_ref      text;
alter table public.purchase_requests add column if not exists expected_date  date;

-- ---------------------------------------------------------------------
-- 8) Segurança: só o servidor (chave secreta) lê e grava
-- ---------------------------------------------------------------------
alter table public.catalog_groups   enable row level security;
alter table public.catalog_seq      enable row level security;
alter table public.suppliers        enable row level security;
alter table public.supplier_items   enable row level security;
alter table public.fiscal_notes     enable row level security;
alter table public.collaborators    enable row level security;
alter table public.role_kits        enable row level security;
alter table public.material_orders  enable row level security;
alter table public.deliveries       enable row level security;
grant all on public.catalog_groups, public.catalog_seq, public.suppliers, public.supplier_items, public.fiscal_notes,
             public.collaborators, public.role_kits, public.material_orders, public.deliveries to service_role;

notify pgrst, 'reload schema';
select 'ok: Projeto 3 ativado' as resultado;
