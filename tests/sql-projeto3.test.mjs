/**
 * Regras do banco do Projeto 3 testadas em um Postgres de verdade (PGlite).
 * Rodar: node tests/sql-projeto3.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase');
const db = new PGlite();
let fail = 0;
const ok = (name, cond, extra) => {
  if (!cond) fail++;
  console.log(cond ? '  ✓' : '  ✗', name, cond ? '' : JSON.stringify(extra ?? '').slice(0, 300));
};
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const val = async (sql, p = []) => Object.values((await db.query(sql, p)).rows[0] ?? {})[0];
const err = async (sql, p = []) => {
  try {
    await db.query(sql, p);
    return null;
  } catch (e) {
    return e.message;
  }
};
const run = async (f) => db.exec(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/create extension[^;]*;/gi, '').replace(/notify pgrst[^;]*;/gi, ''));

process.on('unhandledRejection', (e) => { console.log('EXCEÇÃO', e.message); process.exit(1); });
await db.exec('create role anon; create role authenticated; create role service_role;');
for (const f of ['schema.sql', 'estoque.sql', 'baixa_e_usuarios.sql', 'maxhub.sql', 'categorias.sql', 'max_aprendizado.sql', 'compras.sql', 'projeto3.sql']) await run(f);
await run('projeto3.sql'); // de novo: precisa ser idempotente
console.log('arquivos rodados (projeto3.sql duas vezes)');

// dados
const bota = await val(`insert into stock_items (name, size, quantity, min_quantity, cost) values ('Bota de segurança','42',10,4,100) returning id`);
const camisa = await val(`insert into stock_items (name, size, quantity, min_quantity, cost) values ('Camisa operacional','M',30,0,40) returning id`);
const luva = await val(`insert into stock_items (name, size, quantity, min_quantity, cost) values ('Luva de proteção',null,0,0,null) returning id`);

console.log('\n[1] Catálogo e código CC-GG-NNNN');
ok('primeiro código do grupo', (await val(`select assign_item_code($1,'01','03')`, [bota])) === '01-03-0001');
ok('segundo item do mesmo grupo', (await val(`select assign_item_code($1,'01','01')`, [camisa])) === '01-01-0001');
ok('código não muda (atribuir de novo)', /não muda/.test(await err(`select assign_item_code($1,'01','03')`, [bota])));
ok('código não muda (update direto)', /não pode ser alterado/.test(await err(`update stock_items set code = '99-99-9999' where id = $1`, [bota])));
ok('grupo inexistente é recusado', /não existe/.test(await err(`select assign_item_code($1,'01','99')`, [luva])));
const tmp = await val(`insert into stock_items (name, quantity) values ('Coturno', 0) returning id`);
ok('outro calçado: 01-03-0002', (await val(`select assign_item_code($1,'01','03')`, [tmp])) === '01-03-0002');
await db.query('delete from stock_items where id = $1', [tmp]);
const tmp2 = await val(`insert into stock_items (name, quantity) values ('Coturno novo', 0) returning id`);
ok('código apagado não é reutilizado (vem 0003)', (await val(`select assign_item_code($1,'01','03')`, [tmp2])) === '01-03-0003');
ok('dois itens não podem ter o mesmo código', /duplicate key|unique/i.test(await err(`insert into stock_items (name, code) values ('X', '01-03-0001')`)));

console.log('\n[2] Pedido, reserva, mínimo e entrega');
const col = await val(`insert into collaborators (name, matricula, role, posto_name, sizes) values ('Ana Lima','123','Vigilante','Posto 01','{"camisa":"M","calcado":"42"}') returning id`);
const items = JSON.stringify([
  { item_id: bota, name: 'Bota de segurança', size: '42', unit: 'Par', qty: 8, reserved: 0, delivered: 0 },
  { item_id: camisa, name: 'Camisa operacional', size: 'M', unit: 'Cada', qty: 3, reserved: 0, delivered: 0 },
  { item_id: null, name: 'Capa de chuva', size: null, unit: 'Cada', qty: 1, reserved: 0, delivered: 0 },
]);
const ord = await val(`insert into material_orders (origin, stage, requester, collaborator_id, collaborator_name, posto_name, items) values ('rh_admissao','encaminhado','Carla',$1,'Ana Lima','Posto 01',$2) returning id`, [col, items]);
ok('reservar além do que falta no pedido é recusado', /faltam reservar só 3/.test(await err(`select order_reserve($1,'[{"i":1,"qty":4}]',false,'Neilton')`, [ord])));
ok('reservar item sem ligação ao estoque é recusado', /não está ligado/.test(await err(`select order_reserve($1,'[{"i":2,"qty":1}]',false,'Neilton')`, [ord])));
let e = await err(`select order_reserve($1,'[{"i":0,"qty":8}]',false,'Neilton')`, [ord]);
ok('reserva que fura o mínimo pede liberação excepcional', /^MINIMO\|/.test(e ?? ''), e);
ok('…e não reserva nada', (await val('select reserved from stock_items where id=$1', [bota])) === 0);
await db.query(`select order_reserve($1,'[{"i":0,"qty":6}]',false,'Neilton')`, [ord]);
ok('reserva dentro do mínimo passa', (await val('select reserved from stock_items where id=$1', [bota])) === 6);
ok('saldo físico não muda com a reserva', (await val('select quantity from stock_items where id=$1', [bota])) === 10);
ok('sair do estoque o que está reservado é bloqueado (trigger)', /reservada/.test(await err(`select stock_move($1,'saida',5,null,'x','y')`, [bota])));
ok('sair só o livre funciona', (await err(`select stock_move($1,'saida',4,null,'x','y')`, [bota])) === null);
ok('agora o disponível é zero', (await val('select quantity - reserved from stock_items where id=$1', [bota])) === 0);
ok('reserva simultânea além do disponível é recusada', /Só há 0 disponíveis/.test(await err(`select order_reserve($1,'[{"i":0,"qty":1}]',true,'Neilton')`, [ord])));
// entrega parcial
let d = await one(`select order_deliver($1,'[{"i":0,"qty":4},{"i":1,"qty":3}]','Ana Lima',false,'Neilton') as r`, [ord]);
ok('entrega parcial devolve o termo', d.r.group_id && d.r.done === false, d);
let o = await one('select stage, items from material_orders where id=$1', [ord]);
ok('linhas: bota 4 entregues + 2 ainda reservadas; camisa entregue', o.items[0].delivered === 4 && o.items[0].reserved === 2 && o.items[1].delivered === 3 && o.stage === 'encaminhado', o.items);
ok('estoque: bota 2 físicas/2 reservadas; camisa 27', (await val('select quantity from stock_items where id=$1', [bota])) === 2 && (await val('select reserved from stock_items where id=$1', [bota])) === 2 && (await val('select quantity from stock_items where id=$1', [camisa])) === 27);
ok('histórico individual: 2 entregas registradas para Ana', (await val('select count(*)::int from deliveries where collaborator_id=$1', [col])) === 2);
ok('movimento "entrega" ligado ao pedido', (await val(`select count(*)::int from stock_movements where order_id=$1 and kind='entrega'`, [ord])) === 2);
ok('entregar mais do que falta é recusado', /faltam entregar só 4/.test(await err(`select order_deliver($1,'[{"i":0,"qty":5}]','x',false,'y')`, [ord])));
// capa de chuva: liga ao estoque e conclui
await db.query(`update material_orders set items = jsonb_set(items, '{2,item_id}', to_jsonb($2::text)) where id = $1`, [ord, luva]);
await db.query(`update stock_items set quantity = 1 where id = $1`, [luva]);
e = await err(`select order_deliver($1,'[{"i":0,"qty":4},{"i":2,"qty":1}]','Ana Lima',false,'Neilton')`, [ord]);
ok('entregar 4 botas com só 2 físicas (reservadas) é recusado, sem baixar nada', /Só há 0 disponíveis/.test(e ?? '') && (await val('select quantity from stock_items where id=$1', [luva])) === 1, e);
d = await one(`select order_deliver($1,'[{"i":0,"qty":2},{"i":2,"qty":1}]','Ana Lima',false,'Neilton') as r`, [ord]);
o = await one('select stage, items from material_orders where id=$1', [ord]);
ok('entrega das 2 reservadas + capa: pedido segue parcial (faltam 2 botas)', d.r.done === false && o.stage === 'encaminhado' && o.items[0].delivered === 6 && o.items[0].reserved === 0 && o.items[2].delivered === 1, o.items);
ok('bota zerada e sem reserva', (await val('select quantity from stock_items where id=$1', [bota])) === 0 && (await val('select reserved from stock_items where id=$1', [bota])) === 0);

console.log('\n[3] Entrega completa e cancelamento');
const ord2 = await val(`insert into material_orders (origin, stage, requester, collaborator_name, items) values ('operacao','encaminhado','Uesley','João',$1) returning id`, [JSON.stringify([{ item_id: camisa, name: 'Camisa', qty: 2, reserved: 0, delivered: 0 }])]);
await db.query(`select order_reserve($1,'[{"i":0,"qty":2}]',false,'N')`, [ord2]);
d = await one(`select order_deliver($1,'[{"i":0,"qty":2}]','João',false,'N') as r`, [ord2]);
o = await one('select stage, closed_at from material_orders where id=$1', [ord2]);
ok('entrega integral conclui o pedido', d.r.done === true && o.stage === 'concluido' && o.closed_at, o);
ok('entregar pedido concluído é recusado', /com o Almoxarifado/.test(await err(`select order_deliver($1,'[{"i":0,"qty":1}]','x',false,'y')`, [ord2])));
const ord3 = await val(`insert into material_orders (origin, stage, requester, items) values ('operacao','encaminhado','Uesley',$1) returning id`, [JSON.stringify([{ item_id: camisa, name: 'Camisa', qty: 5, reserved: 0, delivered: 0 }])]);
await db.query(`select order_reserve($1,'[{"i":0,"qty":5}]',false,'N')`, [ord3]);
const before = await val('select reserved from stock_items where id=$1', [camisa]);
ok('cancelar sem motivo é recusado', /motivo/.test(await err(`select order_cancel($1,'  ','N')`, [ord3])));
await db.query(`select order_cancel($1,'Colaborador desligado','N')`, [ord3]);
ok('cancelar libera a reserva', (await val('select reserved from stock_items where id=$1', [camisa])) === before - 5);
ok('cancelado não reserva mais', /com o Almoxarifado/.test(await err(`select order_reserve($1,'[{"i":0,"qty":1}]',false,'N')`, [ord3])));

console.log('\n[4] Nota fiscal: parcial, custo médio, duplicidade e estorno');
const sup = await val(`insert into suppliers (name, cnpj) values ('Fardas Bahia LTDA','12345678000199') returning id`);
const nfItems = JSON.stringify([
  { code: 'BT42', description: 'BOTA SEG 42', unit: 'PAR', qty: 10, unit_cost: 120, total: 1200, received: 0 },
  { code: 'CAM-M', description: 'CAMISA OPER M', unit: 'UN', qty: 20, unit_cost: 40, total: 800, received: 0 },
]);
const nf = await val(`insert into fiscal_notes (number, series, access_key, supplier_id, supplier_name, cnpj, items) values ('1001','1','29261012345678000199550010000010011000000017',$1,'Fardas Bahia LTDA','12345678000199',$2) returning id`, [sup, nfItems]);
ok('mesma nota de novo é bloqueada (chave)', /duplicate key|unique/i.test(await err(`insert into fiscal_notes (number, series, access_key, supplier_name, cnpj) values ('1001','1','29261012345678000199550010000010011000000017','F','12345678000199')`)));
ok('mesma nota de novo é bloqueada (CNPJ+número+série, sem chave)', /duplicate key|unique/i.test(await err(`insert into fiscal_notes (number, series, supplier_name, cnpj) values ('1001','1','F','12345678000199')`)));
ok('linha sem item ligado é recusada', /escolha o item/.test(await err(`select post_fiscal_note($1,'[{"i":0,"qty":5}]','N')`, [nf])));
ok('receber mais do que a nota é recusado', /faltam receber só 10/.test(await err(`select post_fiscal_note($1,$2,'N')`, [nf, JSON.stringify([{ i: 0, item_id: bota, qty: 11 }])])));
const q0 = await one('select quantity, cost from stock_items where id=$1', [bota]);
let pr = await val(`select post_fiscal_note($1,$2,'Neilton')`, [nf, JSON.stringify([{ i: 0, item_id: bota, qty: 6 }])]);
const q1 = await one('select quantity, cost from stock_items where id=$1', [bota]);
const expected = Math.round(((q0.quantity * Number(q0.cost) + 6 * 120) / (q0.quantity + 6)) * 100) / 100;
ok('entrada parcial soma só o recebido', pr.status === 'parcial' && q1.quantity === q0.quantity + 6, [pr, q0, q1]);
ok(`custo médio ponderado (${expected})`, Number(q1.cost) === expected, q1);
ok('fornecedor aprendido (BT42 → bota)', (await val(`select item_id from supplier_items where supplier_code='BT42'`)) === bota);
pr = await val(`select post_fiscal_note($1,$2,'Neilton')`, [nf, JSON.stringify([{ i: 0, item_id: bota, qty: 4 }, { i: 1, item_id: camisa, qty: 20 }])]);
ok('restante recebido: nota lançada', pr.status === 'lancada', pr);
ok('nota lançada não recebe mais', /lançada por completo/.test(await err(`select post_fiscal_note($1,$2,'N')`, [nf, JSON.stringify([{ i: 0, item_id: bota, qty: 1 }])])));
ok('movimentos de entrada com a NF no texto', (await val(`select count(*)::int from stock_movements where fiscal_note_id=$1 and kind='entrada' and note like 'NF 1001/1 — Fardas%'`, [nf])) === 3);
// estorno bloqueado se já saiu
const free0 = await val('select quantity - reserved from stock_items where id=$1', [camisa]);
const out = free0 - 5; // sobram só 5 livres: menos do que as 20 que entraram pela nota
await db.query(`select stock_move($1,'saida',$2,null,'uso','N')`, [camisa, out]);
const free = await val('select quantity - reserved from stock_items where id=$1', [camisa]);
e = await err(`select reverse_fiscal_note($1,'Nota errada','N')`, [nf]);
ok(`estorno bloqueado quando o material já saiu (livre: ${free})`, /Não dá para estornar/.test(e ?? ''), e);
await db.query(`select stock_move($1,'entrada',$2,null,'volta','N')`, [camisa, out]);
const qb = await val('select quantity from stock_items where id=$1', [bota]);
ok('estorno sem motivo é recusado', /motivo/.test(await err(`select reverse_fiscal_note($1,'','N')`, [nf])));
const rv = await val(`select reverse_fiscal_note($1,'Nota lançada em duplicidade','N')`, [nf]);
ok('estorno devolve as quantidades', rv.units === 30 && (await val('select quantity from stock_items where id=$1', [bota])) === qb - 10, rv);
ok('entrada original continua no histórico + movimentos de estorno', (await val(`select count(*)::int from stock_movements where fiscal_note_id=$1`, [nf])) === 5);
ok('nota estornada pode ser lançada de novo (correção)', (await err(`insert into fiscal_notes (number, series, access_key, supplier_name, cnpj) values ('1001','1','29261012345678000199550010000010011000000017','F','12345678000199')`)) === null);

console.log('\n[5] Inventário, perdas e devoluções');
const qc = await val('select quantity from stock_items where id=$1', [camisa]);
let inv = await val(`select inventory_apply($1,'Inventário inicial','N')`, [JSON.stringify([{ item_id: camisa, counted: qc - 3 }, { item_id: luva, counted: 0 }])]);
ok('inventário ajusta só o que divergiu', inv.adjusted === 1 && (await val('select quantity from stock_items where id=$1', [camisa])) === qc - 3, inv);
ok('movimento de inventário com antes/depois', (await one(`select before_qty, after_qty from stock_movements where kind='inventario' and item_id=$1`, [camisa])).after_qty === qc - 3);
await db.query(`select order_reserve($1,'[{"i":0,"qty":2}]',false,'N')`, [ord]).catch(() => undefined);
ok('baixa por perda exige motivo', /motivo/.test(await err(`select stock_writeoff($1,1,'perda','',null,'N')`, [camisa])));
ok('baixa por perda', (await err(`select stock_writeoff($1,2,'perda','Rasgada no transporte',null,'N')`, [camisa])) === null);
const del = await val(`select id from deliveries where collaborator_id=$1 and item_id=$2`, [col, camisa]);
const qcam = await val('select quantity from stock_items where id=$1', [camisa]);
await db.query(`select delivery_return($1,1,true,'Tamanho errado','N')`, [del]);
ok('devolução em bom estado volta ao estoque', (await val('select quantity from stock_items where id=$1', [camisa])) === qcam + 1);
await db.query(`select delivery_return($1,1,false,'Rasgou','N')`, [del]);
ok('devolução avariada não volta ao estoque', (await val('select quantity from stock_items where id=$1', [camisa])) === qcam + 1);
ok('não devolve mais do que recebeu', /dá para devolver até 1/.test(await err(`select delivery_return($1,2,true,'x','N')`, [del])));

console.log(fail ? `\n${fail} falha(s)` : '\nOK');
process.exit(fail ? 1 : 0);

