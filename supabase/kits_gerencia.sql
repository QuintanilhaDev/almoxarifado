-- =====================================================================
--  Max Hub · Kits por função e contrato do TRE (pedido da gerência, 04/11/2026)
--
--  Rode DEPOIS de contratos_e_devolucoes.sql. Pode rodar mais de uma vez:
--  os kits destas funções são substituídos pelos daqui (prazo de troca de 12 meses;
--  ajuste em RH › Colaboradores › Kits por função).
--
--  - ASG vale para AUX SERV GERAIS, AUX SERVIÇOS GERAIS II, AGENTE DE LIMPEZA e
--    ENCARREGADO DE LIMPEZA.
--  - AGENTE DE PORTARIA recebe o kit operacional; nos contratos marcados como
--    "Portaria social" recebe o AGENTE DE PORTARIA SOCIAL.
--  - VIGILANTE só para a função VIGILANTE (VIGIA não recebe este kit).
--  - TRE: contrato marcado para a importação de colaboradores ignorar.
-- =====================================================================

insert into public.role_kits (role, items, period_months, updated_by)
values
  ('AUXILIAR OPERACIONAL', '[{"name": "Conjunto marrom com faixa refletiva", "qty": 2, "size_from": "camisa", "item_id": null}, {"name": "Botina com biqueira", "qty": 1, "size_from": "calcado", "item_id": null}, {"name": "Capacete de segurança", "qty": 1, "size_from": null, "item_id": null}, {"name": "Boné de casquete", "qty": 1, "size_from": null, "item_id": null}, {"name": "Luva anticorte", "qty": 1, "size_from": null, "item_id": null}, {"name": "Luva pigmentada", "qty": 1, "size_from": null, "item_id": null}, {"name": "Óculos de segurança", "qty": 1, "size_from": null, "item_id": null}]'::jsonb, 12, 'gerência (04/11/2026)'),
  ('AUX SERV GERAIS', '[{"name": "Conjunto ASG", "qty": 2, "size_from": "camisa", "item_id": null}, {"name": "Sapato antiderrapante", "qty": 1, "size_from": "calcado", "item_id": null}, {"name": "Luva látex", "qty": 1, "size_from": null, "item_id": null}, {"name": "Máscara PFF2", "qty": 1, "size_from": null, "item_id": null}]'::jsonb, 12, 'gerência (04/11/2026)'),
  ('AUX SERVIÇOS GERAIS II', '[{"name": "Conjunto ASG", "qty": 2, "size_from": "camisa", "item_id": null}, {"name": "Sapato antiderrapante", "qty": 1, "size_from": "calcado", "item_id": null}, {"name": "Luva látex", "qty": 1, "size_from": null, "item_id": null}, {"name": "Máscara PFF2", "qty": 1, "size_from": null, "item_id": null}]'::jsonb, 12, 'gerência (04/11/2026)'),
  ('AGENTE DE LIMPEZA', '[{"name": "Conjunto ASG", "qty": 2, "size_from": "camisa", "item_id": null}, {"name": "Sapato antiderrapante", "qty": 1, "size_from": "calcado", "item_id": null}, {"name": "Luva látex", "qty": 1, "size_from": null, "item_id": null}, {"name": "Máscara PFF2", "qty": 1, "size_from": null, "item_id": null}]'::jsonb, 12, 'gerência (04/11/2026)'),
  ('ENCARREGADO DE LIMPEZA', '[{"name": "Conjunto ASG", "qty": 2, "size_from": "camisa", "item_id": null}, {"name": "Sapato antiderrapante", "qty": 1, "size_from": "calcado", "item_id": null}, {"name": "Luva látex", "qty": 1, "size_from": null, "item_id": null}, {"name": "Máscara PFF2", "qty": 1, "size_from": null, "item_id": null}]'::jsonb, 12, 'gerência (04/11/2026)'),
  ('COPEIRA', '[{"name": "Conjunto copeira", "qty": 2, "size_from": "camisa", "item_id": null}, {"name": "Sapato antiderrapante", "qty": 1, "size_from": "calcado", "item_id": null}, {"name": "Avental", "qty": 1, "size_from": null, "item_id": null}, {"name": "Touca", "qty": 1, "size_from": null, "item_id": null}]'::jsonb, 12, 'gerência (04/11/2026)'),
  ('VIGILANTE', '[{"name": "Camisa operacional MC", "qty": 1, "size_from": "camisa", "item_id": null}, {"name": "Camisa operacional ML", "qty": 1, "size_from": "camisa", "item_id": null}, {"name": "Calça operacional", "qty": 2, "size_from": "calca", "item_id": null}, {"name": "Cinto niquelado", "qty": 1, "size_from": null, "item_id": null}, {"name": "Boné Max Forte", "qty": 1, "size_from": null, "item_id": null}, {"name": "Coturno", "qty": 1, "size_from": "calcado", "item_id": null}, {"name": "Capa de colete", "qty": 1, "size_from": null, "item_id": null}, {"name": "Apito com fiel", "qty": 1, "size_from": null, "item_id": null}, {"name": "Capa de chuva", "qty": 1, "size_from": null, "item_id": null}]'::jsonb, 12, 'gerência (04/11/2026)'),
  ('AGENTE DE PORTARIA', '[{"name": "Camisa operacional MC", "qty": 1, "size_from": "camisa", "item_id": null}, {"name": "Camisa operacional ML", "qty": 1, "size_from": "camisa", "item_id": null}, {"name": "Calça operacional", "qty": 2, "size_from": "calca", "item_id": null}, {"name": "Cinto niquelado", "qty": 1, "size_from": null, "item_id": null}, {"name": "Boné Max Serviços", "qty": 1, "size_from": null, "item_id": null}, {"name": "Botina com biqueira", "qty": 1, "size_from": "calcado", "item_id": null}]'::jsonb, 12, 'gerência (04/11/2026)'),
  ('JARDINEIRO', '[{"name": "Camisa operacional MC", "qty": 1, "size_from": "camisa", "item_id": null}, {"name": "Camisa operacional ML", "qty": 1, "size_from": "camisa", "item_id": null}, {"name": "Calça operacional", "qty": 2, "size_from": "calca", "item_id": null}, {"name": "Botina com biqueira", "qty": 1, "size_from": "calcado", "item_id": null}, {"name": "Protetor facial", "qty": 1, "size_from": null, "item_id": null}, {"name": "Perneira", "qty": 1, "size_from": null, "item_id": null}, {"name": "Avental de raspa", "qty": 1, "size_from": null, "item_id": null}, {"name": "Máscara PFF2", "qty": 1, "size_from": null, "item_id": null}]'::jsonb, 12, 'gerência (04/11/2026)'),
  ('AGENTE DE PORTARIA SOCIAL', '[{"name": "Camisa social", "qty": 2, "size_from": "camisa", "item_id": null}, {"name": "Calça social", "qty": 2, "size_from": "calca", "item_id": null}, {"name": "Cinto niquelado", "qty": 1, "size_from": null, "item_id": null}, {"name": "Sapato social", "qty": 1, "size_from": "calcado", "item_id": null}, {"name": "Gravata", "qty": 1, "size_from": null, "item_id": null}, {"name": "Paletó", "qty": 1, "size_from": "camisa", "item_id": null}]'::jsonb, 12, 'gerência (04/11/2026)')
on conflict (role) do update set items = excluded.items, period_months = excluded.period_months, updated_by = excluded.updated_by, updated_at = now();

insert into public.contracts (name, active, block_import, notes, created_by)
values ('TRIBUNAL REGIONAL ELEITORAL DA BAHIA', false, true, 'Colaboradores excluídos do sistema em 04/11/2026 a pedido da gerência; a importação ignora este contrato.', 'sistema')
on conflict (name_key) do update set active = false, block_import = true, notes = excluded.notes, updated_at = now();

select 'ok: ' || (select count(*) from public.role_kits) || ' kits; TRE bloqueado na importação' as resultado;
