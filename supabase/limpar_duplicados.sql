-- =====================================================================
--  Almoxarifado · Limpeza dos itens duplicados do estoque
--  Cole TODO este arquivo no SQL Editor do Supabase e clique em "Run".
--
--  Contexto: uma importação de planilha leu a linha errada como cabeçalho e
--  criou uma CÓPIA de vários itens, sem tamanho, com unidade "Cada", saldo = nº
--  da REF e mínimo = custo (ex.: "ALgema de dobradiça · Ref. 0311").
--
--  O que faz:
--    1. Mostra (resultado 1) quais cópias serão removidas.
--    2. Remove só as cópias que: entraram pela tela "Importar planilha", não foram
--       criadas pela carga inicial ("Planilha"), não têm tamanho, e cujo mesmo
--       produto já existe com tamanho cadastrado pela carga inicial.
--       Cópias com saldo em algum posto NUNCA são removidas.
--    3. Apaga o registro "criação" dessas cópias do histórico.
--  Itens corretos (inclusive os que de fato não têm tamanho) não são tocados.
--  Pode rodar de novo: na segunda vez não há nada a remover.
--  Depois rode corrigir_estoque.sql (se ainda não rodou) para acertar saldos.
-- =====================================================================

drop table if exists _copias;
create temp table _copias as
select c.id, c.ref, c.name, c.quantity, c.min_quantity, c.created_by
  from public.stock_items c
 where c.size_key = ''
   and coalesce(c.created_by, '') <> 'Planilha'
   and exists (
         select 1 from public.stock_items o
          where o.name_key = c.name_key
            and o.size_key <> ''
            and o.created_by = 'Planilha')
   -- só itens que entraram pela importação de planilha (o histórico guarda isso)
   and exists (
         select 1 from public.stock_movements m
          where m.item_id = c.id and m.kind = 'criacao' and m.note = 'Importado de planilha')
   and not exists (select 1 from public.posto_stock ps where ps.item_id = c.id);

-- 1) o que será removido
select ref, name, quantity, min_quantity, created_by from _copias order by name;

-- 2) e 3) remoção
delete from public.stock_movements
 where item_id in (select id from _copias)
   and kind = 'criacao';

delete from public.stock_items where id in (select id from _copias);

drop table if exists _copias;

-- Conferência
select count(*) as itens, sum(quantity) as unidades from public.stock_items;
