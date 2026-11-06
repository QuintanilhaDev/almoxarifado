-- =====================================================================
--  Max Hub · Índices das chaves estrangeiras (desempenho)
--  Pode rodar quando quiser e mais de uma vez. Não muda nenhum dado.
-- =====================================================================
create index if not exists collaborators_posto_idx on public.collaborators (posto_id);
create index if not exists deliveries_item_idx on public.deliveries (item_id);
create index if not exists deliveries_order_idx on public.deliveries (order_id);
create index if not exists fiscal_notes_purchase_request_idx on public.fiscal_notes (purchase_request_id);
create index if not exists fiscal_notes_supplier_idx on public.fiscal_notes (supplier_id);
create index if not exists material_orders_posto_idx on public.material_orders (posto_id);
create index if not exists material_orders_source_request_idx on public.material_orders (source_request_id);
create index if not exists purchase_orders_quote_idx on public.purchase_orders (quote_id);
create index if not exists purchase_orders_supplier_idx on public.purchase_orders (supplier_id);
create index if not exists return_stock_collaborator_idx on public.return_stock (collaborator_id);
create index if not exists return_stock_stock_item_idx on public.return_stock (stock_item_id);
create index if not exists supplier_items_item_idx on public.supplier_items (item_id);
select 'ok: índices criados' as resultado;
