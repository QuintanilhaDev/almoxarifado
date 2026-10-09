-- =====================================================================
--  Almoxarifado · Baixa pelo "Responder" + Usuário master
--  Cole TODO este arquivo no SQL Editor do Supabase e clique em "Run".
--  Pode rodar mais de uma vez sem problema (é idempotente).
--  Rode DEPOIS do estoque.sql (usa as funções de movimentação dele).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Usuário master
--    Usuário:  master      Senha inicial:  berrythedev45
--    (o banco guarda só o "hash" da senha, nunca a senha em texto).
--    Rodar de novo NÃO volta a senha para a inicial: se o master já
--    existe, só garante que ele continua sendo master.
-- ---------------------------------------------------------------------
alter table public.admins add column if not exists is_master boolean not null default false;

insert into public.admins (username, display_name, password_hash, is_master) values
  ('master', 'Usuário Master', '$2b$10$i7Ylq7ypQTuAogu0FTg6F.22NvNkrINFyaodhQoAi2fFscmXgapx.', true)
on conflict (username) do update set is_master = true;

-- ---------------------------------------------------------------------
-- 2) Baixas registradas em cada solicitação (histórico + estorno)
-- ---------------------------------------------------------------------
alter table public.requests add column if not exists stock_applications jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------
-- 3) Dar baixa dos itens de uma resposta (tudo ou nada, sem duplicar)
--    p_mode: 'transferencia' (almoxarifado → posto) ou 'saida' (só sai do almoxarifado)
--    p_key : chave única da tela; se a mesma chave chegar duas vezes
--            (duplo clique, internet que caiu), a segunda NÃO baixa de novo.
-- ---------------------------------------------------------------------
create or replace function public.apply_request_baixa(
  p_request uuid,
  p_key     text,
  p_mode    text,
  p_posto   uuid,
  p_lines   jsonb,
  p_note    text,
  p_text    text,
  p_by      text
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_req      public.requests%rowtype;
  v_existing jsonb;
  v_posto    public.postos%rowtype;
  v_lines    jsonb;
  v_res      jsonb;
  v_app      jsonb;
begin
  if p_mode not in ('transferencia', 'saida') then
    raise exception 'Tipo de baixa inválido.';
  end if;
  if p_key is null or length(btrim(p_key)) = 0 or length(p_key) > 80 then
    raise exception 'Chave da baixa inválida.';
  end if;

  select * into v_req from public.requests where id = p_request for update;
  if not found then
    raise exception 'Solicitação não encontrada.';
  end if;

  select e into v_existing
    from jsonb_array_elements(coalesce(v_req.stock_applications, '[]'::jsonb)) e
   where e->>'id' = p_key
   limit 1;
  if v_existing is not null then
    return jsonb_build_object('already', true, 'application', v_existing);
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Escolha pelo menos um item.';
  end if;

  if p_mode = 'transferencia' then
    select * into v_posto from public.postos where id = p_posto;
    if not found then
      raise exception 'Posto não encontrado.';
    end if;
  end if;

  -- retrato dos itens (nome legível, mesmo que o item seja apagado depois)
  select jsonb_agg(
           jsonb_build_object(
             'item_id', a.item_id,
             'name', i.name || coalesce(' · ' || nullif(btrim(i.size), ''), ''),
             'quantity', a.qty)
           order by i.name, i.size)
    into v_lines
    from (
      select (e->>'item_id')::uuid as item_id, sum((e->>'quantity')::integer)::integer as qty
        from jsonb_array_elements(p_lines) e
       group by 1
    ) a
    join public.stock_items i on i.id = a.item_id;

  -- movimenta o estoque (valida saldo e trava as linhas; erro desfaz tudo)
  v_res := public.stock_move_many(p_mode, p_posto, p_lines, p_note, p_by);

  v_app := jsonb_build_object(
    'id', p_key,
    'at', now(),
    'by', p_by,
    'mode', p_mode,
    'posto_id', p_posto,
    'posto_name', v_posto.name,
    'note', nullif(btrim(coalesce(p_note, '')), ''),
    'lines', coalesce(v_lines, '[]'::jsonb),
    'text', left(coalesce(p_text, ''), 4000),
    'reverted', false
  );

  update public.requests
     set stock_applications = coalesce(stock_applications, '[]'::jsonb) || jsonb_build_array(v_app)
   where id = p_request;

  return jsonb_build_object('already', false, 'application', v_app, 'items', v_res->'items', 'units', v_res->'units');
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Estornar uma baixa (devolve ao almoxarifado, uma vez só)
-- ---------------------------------------------------------------------
create or replace function public.revert_request_baixa(
  p_request uuid,
  p_app     text,
  p_by      text
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_req   public.requests%rowtype;
  v_app   jsonb;
  v_kind  text;
  v_posto uuid;
  v_lines jsonb;
  v_res   jsonb;
begin
  select * into v_req from public.requests where id = p_request for update;
  if not found then
    raise exception 'Solicitação não encontrada.';
  end if;

  select e into v_app
    from jsonb_array_elements(coalesce(v_req.stock_applications, '[]'::jsonb)) e
   where e->>'id' = p_app
   limit 1;
  if v_app is null then
    raise exception 'Baixa não encontrada.';
  end if;
  if coalesce((v_app->>'reverted')::boolean, false) then
    raise exception 'Esta baixa já foi estornada.';
  end if;

  if v_app->>'mode' = 'transferencia' then
    v_kind := 'devolucao';
    v_posto := nullif(v_app->>'posto_id', '')::uuid;
    if v_posto is null or not exists (select 1 from public.postos where id = v_posto) then
      raise exception 'O posto desta baixa já foi removido (os itens voltaram ao almoxarifado quando ele foi removido). Não há o que estornar.';
    end if;
  else
    v_kind := 'entrada';
    v_posto := null;
  end if;

  select jsonb_agg(jsonb_build_object('item_id', l->>'item_id', 'quantity', (l->>'quantity')::integer))
    into v_lines
    from jsonb_array_elements(v_app->'lines') l;

  v_res := public.stock_move_many(v_kind, v_posto, v_lines,
             'Estorno de baixa' || coalesce(' · ' || (v_app->>'note'), ''), p_by);

  update public.requests
     set stock_applications = (
       select jsonb_agg(
                case when t.e->>'id' = p_app
                     then t.e || jsonb_build_object('reverted', true, 'reverted_at', now(), 'reverted_by', p_by)
                     else t.e end
                order by t.ord)
         from jsonb_array_elements(coalesce(v_req.stock_applications, '[]'::jsonb)) with ordinality as t(e, ord)
     )
   where id = p_request;

  return jsonb_build_object('items', v_res->'items', 'units', v_res->'units');
end;
$$;

-- ---------------------------------------------------------------------
-- 5) Permissões: só o servidor (service_role) executa
-- ---------------------------------------------------------------------
revoke all on function public.apply_request_baixa(uuid, text, text, uuid, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.revert_request_baixa(uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_request_baixa(uuid, text, text, uuid, jsonb, text, text, text) to service_role;
grant execute on function public.revert_request_baixa(uuid, text, text) to service_role;

notify pgrst, 'reload schema';
