-- =====================================================================
--  Max Hub · Compras completo e recebimento pelo pedido
--  (especificações "Módulo de Compras" e "Estoque/Recebimento/NF/Pagamentos")
--
--  Cole TODO este arquivo no SQL Editor do Supabase e clique em "Run".
--  Rode DEPOIS de: compras.sql, pedidos_e_notas.sql e fornecedores.sql.
--
--  Cria: cotações (mapa comparativo), pedidos de compra numerados com aprovação,
--  prazos por fornecedor/produto, homologação de fornecedores, equivalência de
--  códigos com fator de conversão, conferência física e divergências da nota,
--  validação das parcelas.
--
--  NÃO apaga nada nem altera saldos, custos ou histórico que já existem.
--  Pode rodar mais de uma vez (é idempotente).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Fornecedores: homologação, exclusividade, prazo e condições padrão
-- ---------------------------------------------------------------------
alter table public.suppliers add column if not exists homologation      text;
alter table public.suppliers add column if not exists homologation_note text;
alter table public.suppliers add column if not exists homologated_by    text;
alter table public.suppliers add column if not exists homologated_at    timestamptz;
alter table public.suppliers add column if not exists exclusive         boolean not null default false;
alter table public.suppliers add column if not exists lead_days         integer;
alter table public.suppliers add column if not exists lead_business     boolean not null default true;
alter table public.suppliers add column if not exists payment_terms     text;
alter table public.suppliers add column if not exists brands            text;
-- quem já era fornecedor continua liberado; os novos entram "pendente" até alguém validar
update public.suppliers set homologation = 'homologado' where homologation is null;
alter table public.suppliers alter column homologation set default 'pendente';
alter table public.suppliers alter column homologation set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'suppliers_homologation_check') then
    alter table public.suppliers add constraint suppliers_homologation_check check (homologation in ('pendente', 'homologado', 'bloqueado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'suppliers_lead_check') then
    alter table public.suppliers add constraint suppliers_lead_check check (lead_days is null or lead_days between 0 and 365);
  end if;
end $$;

-- Itens que cada fornecedor fornece, com o prazo de cada um (ex.: Marvin: 5 dias úteis
-- para itens do contrato, 30 dias úteis para o que precisa ser produzido).
create table if not exists public.supplier_products (
  supplier_id   uuid not null references public.suppliers (id) on delete cascade,
  item_id       uuid not null references public.stock_items (id) on delete cascade,
  lead_days     integer check (lead_days is null or lead_days between 0 and 365),
  lead_business boolean not null default true,
  mode          text not null default 'pronta' check (mode in ('pronta', 'producao')),
  in_contract   boolean not null default false,
  confirmed     boolean not null default false,   -- prazo confirmado em contrato
  exclusive     boolean not null default false,
  last_price    numeric(14, 4),
  note          text,
  updated_by    text,
  updated_at    timestamptz not null default now(),
  primary key (supplier_id, item_id)
);
create index if not exists supplier_products_item_idx on public.supplier_products (item_id);

-- ---------------------------------------------------------------------
-- 2) Equivalência de códigos: CNPJ do fornecedor + código externo + unidade
--    → item interno, com a descrição do fornecedor e o fator de conversão
--    (ex.: 1 caixa = 10 unidades). Um item interno pode ter vários códigos.
-- ---------------------------------------------------------------------
alter table public.supplier_items add column if not exists unit_key     text not null default '';
alter table public.supplier_items add column if not exists description  text;
alter table public.supplier_items add column if not exists unit         text;
alter table public.supplier_items add column if not exists factor       numeric(12, 4) not null default 1;
alter table public.supplier_items add column if not exists validated_by text;
alter table public.supplier_items add column if not exists validated_at timestamptz;
alter table public.supplier_items add column if not exists created_at   timestamptz not null default now();
-- os vínculos antigos nasceram quando alguém lançou a nota escolhendo o item: já são validados
update public.supplier_items set validated_by = coalesce(validated_by, 'Lançamento de nota'), validated_at = coalesce(validated_at, updated_at) where validated_at is null;
do $$
declare v_cols int;
begin
  if not exists (select 1 from pg_constraint where conname = 'supplier_items_factor_check') then
    alter table public.supplier_items add constraint supplier_items_factor_check check (factor > 0 and factor <= 100000);
  end if;
  select count(*) into v_cols from pg_constraint c join lateral unnest(c.conkey) k on true
   where c.conrelid = 'public.supplier_items'::regclass and c.contype = 'p';
  if v_cols = 2 then
    alter table public.supplier_items drop constraint supplier_items_pkey;
    alter table public.supplier_items add primary key (supplier_id, supplier_code, unit_key);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3) Cotações: propostas de vários fornecedores e o mapa comparativo por item
-- ---------------------------------------------------------------------
create table if not exists public.purchase_quotes (
  id           uuid primary key default gen_random_uuid(),
  number       bigint generated always as identity unique,
  status       text not null default 'aberta' check (status in ('aberta', 'decidida', 'cancelada')),
  request_ids  uuid[] not null default '{}',
  items        jsonb not null default '[]'::jsonb,   -- [{key, item_id, name, size, unit, qty, requests:[{id, number, qty}]}]
  proposals    jsonb not null default '[]'::jsonb,   -- propostas (as que perderam ficam guardadas)
  decision     jsonb,                                -- {lines: {key: proposal_id}, justification, by, at}
  reply_by     date,                                 -- prazo pedido aos fornecedores
  note         text,
  created_by   text,
  history      jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists purchase_quotes_created_idx on public.purchase_quotes (created_at desc);

-- ---------------------------------------------------------------------
-- 4) Pedido de compra numerado
-- ---------------------------------------------------------------------
create table if not exists public.purchase_orders (
  id             uuid primary key default gen_random_uuid(),
  number         bigint generated always as identity unique,
  status         text not null default 'rascunho' check (status in
                   ('rascunho', 'aguardando_aprovacao', 'aprovado', 'enviado', 'confirmado', 'parcial', 'concluido', 'cancelado')),
  quote_id       uuid references public.purchase_quotes (id) on delete set null,
  request_ids    uuid[] not null default '{}',
  supplier_id    uuid references public.suppliers (id) on delete set null,
  supplier_name  text not null,
  cnpj           text,
  items          jsonb not null default '[]'::jsonb,  -- [{key, item_id, name, size, unit, qty, unit_price, discount, ext_code, brand, spec, received, refused, requests}]
  freight        numeric(14, 2) not null default 0,
  other_costs    numeric(14, 2) not null default 0,
  discount       numeric(14, 2) not null default 0,
  total          numeric(14, 2) not null default 0,
  payment        jsonb not null default '{}'::jsonb,  -- {mode, installments, days, note}
  delivery       jsonb not null default '{}'::jsonb,  -- {days, business, mode, location}
  expected_date  date,                                -- previsão (calculada pelo prazo)
  promised_date  date,                                -- data confirmada pelo fornecedor
  notes          text,
  attachments    jsonb not null default '[]'::jsonb,
  approval       jsonb,                               -- {by, at, note, total}
  approved_hash  text,                                -- o que foi aprovado (mudou depois? pede de novo)
  sent_at        timestamptz,
  sent_by        text,
  sent_via       text,
  confirmed_at   timestamptz,
  confirmed_by   text,
  cancel_reason  text,
  created_by     text,
  history        jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists purchase_orders_created_idx on public.purchase_orders (created_at desc);
create index if not exists purchase_orders_status_idx on public.purchase_orders (status);

-- ---------------------------------------------------------------------
-- 5) Nota fiscal: ligada ao pedido, com DANFE anexo, conferência,
--    divergências e parcelas validadas
-- ---------------------------------------------------------------------
alter table public.fiscal_notes add column if not exists purchase_order_id   uuid references public.purchase_orders (id) on delete set null;
alter table public.fiscal_notes add column if not exists attachments         jsonb not null default '[]'::jsonb;
alter table public.fiscal_notes add column if not exists divergences         jsonb not null default '[]'::jsonb;
alter table public.fiscal_notes add column if not exists installments_status text;
-- notas antigas: parcelas que já fecham com o total contam como validadas
update public.fiscal_notes n
   set installments_status = case
     when abs(coalesce((select sum((e->>'value')::numeric) from jsonb_array_elements(n.installments) e), 0)
              - coalesce((n.totals->>'total')::numeric, 0)) < 0.005 then 'validada' else 'incompleta' end
 where installments_status is null;
alter table public.fiscal_notes alter column installments_status set default 'incompleta';
alter table public.fiscal_notes alter column installments_status set not null;
alter table public.fiscal_notes drop constraint if exists fiscal_notes_status_check;
alter table public.fiscal_notes add constraint fiscal_notes_status_check
  check (status in ('aberta', 'conferencia', 'divergencia', 'parcial', 'lancada', 'estornada'));
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fiscal_notes_inst_check') then
    alter table public.fiscal_notes add constraint fiscal_notes_inst_check check (installments_status in ('incompleta', 'validada'));
  end if;
end $$;
create index if not exists fiscal_notes_po_idx on public.fiscal_notes (purchase_order_id) where purchase_order_id is not null;

-- ---------------------------------------------------------------------
-- 6) Entrada no estoque: só o que foi ACEITO na conferência.
--    Com fator de conversão (quantidade da nota × fator = unidades do estoque)
--    e baixa do "a receber" do pedido de compra ligado.
--    p_lines = [{"i": 0, "item_id": "...", "qty": 10}]  (qty em unidades do estoque)
-- ---------------------------------------------------------------------
create or replace function public.post_fiscal_note(p_note uuid, p_lines jsonb, p_by text)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_note    public.fiscal_notes%rowtype;
  v_items   jsonb;
  v_line    jsonb;
  r         record;
  v_item    public.stock_items%rowtype;
  v_i       integer;
  v_qty     integer;
  v_factor  numeric;
  v_expect  numeric;
  v_rem     numeric;
  v_unit    numeric;
  v_cost    numeric;
  v_label   text;
  v_units   integer := 0;
  v_done    boolean := true;
  v_status  text;
  v_target  uuid;
  v_po      public.purchase_orders%rowtype;
  v_poitems jsonb;
  v_k       integer;
  v_podone  boolean;
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
  if v_note.purchase_order_id is not null then
    select * into v_po from public.purchase_orders where id = v_note.purchase_order_id for update;
    v_poitems := coalesce(v_po.items, '[]'::jsonb);
  end if;
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
    v_factor := coalesce(nullif(v_line->>'factor', '')::numeric, 1);
    v_expect := coalesce((v_line->>'qty')::numeric, 0) * v_factor;
    v_rem := v_expect - coalesce((v_line->>'received')::numeric, 0) - coalesce((v_line->>'refused')::numeric, 0);
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
    -- custo por unidade do estoque (o da nota é por unidade de compra)
    v_unit := coalesce((v_line->>'unit_cost')::numeric, 0) / v_factor;
    v_cost := case when v_item.quantity + v_qty > 0
                   then round(((v_item.quantity * coalesce(v_item.cost, v_unit)) + v_qty * v_unit) / (v_item.quantity + v_qty), 2)
                   else v_unit end;
    v_label := v_item.name || coalesce(' · ' || nullif(btrim(v_item.size), ''), '');
    update public.stock_items set quantity = quantity + v_qty, cost = v_cost, active = true, updated_at = now() where id = v_target;
    insert into public.stock_movements (item_id, item_name, kind, quantity, before_qty, after_qty, note, by_name, fiscal_note_id)
      values (v_target, v_label, 'entrada', v_qty, v_item.quantity, v_item.quantity + v_qty,
              'NF ' || v_note.number || coalesce('/' || v_note.series, '') || ' — ' || v_note.supplier_name
                || case when v_po.id is not null then ' · PC ' || lpad(v_po.number::text, 4, '0') else '' end, p_by, p_note);
    v_items := jsonb_set(v_items, array[v_i::text], v_line || jsonb_build_object(
      'item_id', v_target,
      'received', coalesce((v_line->>'received')::numeric, 0) + v_qty));
    -- equivalência validada por quem deu a entrada (código + unidade do fornecedor → item)
    if v_note.supplier_id is not null and coalesce(v_line->>'code', '') <> '' then
      insert into public.supplier_items (supplier_id, supplier_code, unit_key, item_id, description, unit, factor, validated_by, validated_at)
        values (v_note.supplier_id, v_line->>'code', lower(coalesce(v_line->>'unit', '')), v_target, v_line->>'description', v_line->>'unit', v_factor, p_by, now())
        on conflict (supplier_id, supplier_code, unit_key) do update
          set item_id = excluded.item_id, description = excluded.description, unit = excluded.unit, factor = excluded.factor,
              validated_by = coalesce(public.supplier_items.validated_by, excluded.validated_by),
              validated_at = coalesce(public.supplier_items.validated_at, excluded.validated_at), updated_at = now();
    end if;
    -- baixa do "a receber" no pedido de compra
    if v_po.id is not null and coalesce(v_line->>'po_key', '') <> '' then
      for v_k in 0 .. jsonb_array_length(v_poitems) - 1 loop
        if v_poitems->v_k->>'key' = v_line->>'po_key' then
          v_poitems := jsonb_set(v_poitems, array[v_k::text], (v_poitems->v_k) || jsonb_build_object(
            'received', coalesce((v_poitems->v_k->>'received')::numeric, 0) + v_qty));
        end if;
      end loop;
    end if;
    v_units := v_units + v_qty;
  end loop;
  if v_units = 0 then raise exception 'Nada a lançar: informe quantidades recebidas maiores que zero.'; end if;
  for v_i in 0 .. jsonb_array_length(v_items) - 1 loop
    if coalesce((v_items->v_i->>'received')::numeric, 0) + coalesce((v_items->v_i->>'refused')::numeric, 0)
       < coalesce((v_items->v_i->>'qty')::numeric, 0) * coalesce(nullif(v_items->v_i->>'factor', '')::numeric, 1) then v_done := false; end if;
  end loop;
  v_status := case when v_done then 'lancada' else 'parcial' end;
  update public.fiscal_notes
     set items = v_items, status = v_status, posted_at = coalesce(posted_at, now()), updated_at = now(),
         received_date = coalesce(received_date, (now() at time zone 'America/Bahia')::date),
         history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', p_by, 'what',
                   case when v_done then 'Entrada confirmada' else 'Entrada parcial confirmada' end || ' (' || v_units || ' unidades)'))
   where id = p_note;
  if v_po.id is not null then
    v_podone := true;
    for v_k in 0 .. jsonb_array_length(v_poitems) - 1 loop
      if coalesce((v_poitems->v_k->>'received')::numeric, 0) < coalesce((v_poitems->v_k->>'qty')::numeric, 0) then v_podone := false; end if;
    end loop;
    update public.purchase_orders
       set items = v_poitems, updated_at = now(),
           status = case when v_po.status in ('aprovado','enviado','confirmado','parcial') then (case when v_podone then 'concluido' else 'parcial' end) else v_po.status end,
           history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', p_by, 'what',
                     'Recebido pela NF ' || v_note.number || ' (' || v_units || ' unidades)' || case when v_podone then ': pedido concluído' else '' end))
     where id = v_po.id;
  end if;
  return jsonb_build_object('status', v_status, 'units', v_units, 'po_done', v_podone);
end $$;

-- Estorno: desfaz as entradas da nota com movimentos novos (a entrada original fica no
-- histórico) e devolve ao "a receber" do pedido de compra o que tinha entrado.
create or replace function public.reverse_fiscal_note(p_note uuid, p_reason text, p_by text)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_note    public.fiscal_notes%rowtype;
  v_line    jsonb;
  v_item    public.stock_items%rowtype;
  v_qty     integer;
  v_unit    numeric;
  v_cost    numeric;
  v_label   text;
  v_units   integer := 0;
  r         record;
  v_po      public.purchase_orders%rowtype;
  v_poitems jsonb;
  v_k       integer;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Diga o motivo do estorno.'; end if;
  select * into v_note from public.fiscal_notes where id = p_note for update;
  if not found then raise exception 'Nota fiscal não encontrada.'; end if;
  if v_note.status = 'estornada' then raise exception 'Esta nota já foi estornada.'; end if;
  if v_note.purchase_order_id is not null then
    select * into v_po from public.purchase_orders where id = v_note.purchase_order_id for update;
    v_poitems := coalesce(v_po.items, '[]'::jsonb);
  end if;
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
    v_unit := coalesce((v_line->>'unit_cost')::numeric, 0) / coalesce(nullif(v_line->>'factor', '')::numeric, 1);
    v_cost := case when v_item.quantity - v_qty > 0 and v_item.cost is not null
                   then greatest(0, round((v_item.quantity * v_item.cost - v_qty * v_unit) / (v_item.quantity - v_qty), 2))
                   else v_item.cost end;
    update public.stock_items set quantity = quantity - v_qty, cost = v_cost, updated_at = now() where id = v_item.id;
    insert into public.stock_movements (item_id, item_name, kind, quantity, before_qty, after_qty, note, by_name, fiscal_note_id)
      values (v_item.id, v_label, 'estorno', v_qty, v_item.quantity, v_item.quantity - v_qty,
              'Estorno da NF ' || v_note.number || ' — ' || btrim(p_reason), p_by, p_note);
    if v_po.id is not null and coalesce(v_line->>'po_key', '') <> '' then
      for v_k in 0 .. jsonb_array_length(v_poitems) - 1 loop
        if v_poitems->v_k->>'key' = v_line->>'po_key' then
          v_poitems := jsonb_set(v_poitems, array[v_k::text], (v_poitems->v_k) || jsonb_build_object(
            'received', greatest(0, coalesce((v_poitems->v_k->>'received')::numeric, 0) - v_qty)));
        end if;
      end loop;
    end if;
    v_units := v_units + v_qty;
  end loop;
  update public.fiscal_notes
     set status = 'estornada', updated_at = now(),
         history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', p_by, 'what', 'Nota estornada: ' || btrim(p_reason)))
   where id = p_note;
  if v_po.id is not null and v_units > 0 then
    update public.purchase_orders
       set items = v_poitems, updated_at = now(),
           status = case when status in ('parcial','concluido') then
                      case when exists (select 1 from jsonb_array_elements(v_poitems) e where coalesce((e->>'received')::numeric, 0) > 0)
                           then 'parcial' else coalesce(nullif(case when confirmed_at is not null then 'confirmado' when sent_at is not null then 'enviado' else 'aprovado' end, ''), 'aprovado') end
                    else status end,
           history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', p_by, 'what',
                     'NF ' || v_note.number || ' estornada: ' || v_units || ' unidade(s) voltaram para "a receber"'))
     where id = v_po.id;
  end if;
  return jsonb_build_object('units', v_units);
end $$;

-- ---------------------------------------------------------------------
-- 7) Segurança: só o servidor (chave secreta) lê e grava
-- ---------------------------------------------------------------------
alter table public.supplier_products enable row level security;
alter table public.purchase_quotes   enable row level security;
alter table public.purchase_orders   enable row level security;
grant all on public.supplier_products, public.purchase_quotes, public.purchase_orders to service_role;

notify pgrst, 'reload schema';
select 'ok: compras completo ativado (cotações, pedidos de compra, conferência e parcelas)' as resultado;
