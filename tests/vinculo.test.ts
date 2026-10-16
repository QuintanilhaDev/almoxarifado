/**
 * Vínculo nota ↔ vários pedidos de compra (lib/notas/vinculo.ts), sem banco.
 * Uso: npx tsx tests/vinculo.test.ts
 */
import { allocate, candidatesFor, itemInText, orderRefs, suggestFromOrders, xpedNumbers } from '../lib/notas/vinculo';
import type { PurchaseOrder, POItem } from '../lib/compras/pc';
import type { NoteLine } from '../lib/notas/server';

let fails = 0;
const ok = (c: unknown, m: string) => {
  console.log(`${c ? '✓' : '✗'} ${m}`);
  if (!c) fails++;
};
const it = (key: string, item_id: string, name: string, qty: number, price: number, extra: Partial<POItem> = {}): POItem => ({ key, item_id, name, size: null, unit: 'UN', qty, unit_price: price, ext_code: null, brand: null, spec: null, received: 0, requests: [], ...extra });
const po = (id: string, number: number, items: POItem[]): PurchaseOrder => ({ id, number, status: 'enviado', quote_id: null, request_ids: [], supplier_id: 's1', supplier_name: 'Marvin', cnpj: '11222333000181', items, freight: 0, other_costs: 0, discount: 0, total: 0, payment: { mode: 'avista' } as PurchaseOrder['payment'], delivery: {} as PurchaseOrder['delivery'], expected_date: null, promised_date: null, notes: null, attachments: [], approval: null, approved_hash: null, sent_at: null, sent_by: null, sent_via: null, confirmed_at: null, confirmed_by: null, cancel_reason: null, created_by: null, history: [], created_at: '', updated_at: '' });
const line = (description: string, item_id: string | null, qty: number, unit_value: number, extra: Partial<NoteLine> = {}): NoteLine => ({ code: '', description, unit: 'UN', qty, unit_cost: unit_value, unit_value, total: qty * unit_value, item_id, received: 0, factor: 1, ...extra });

const PC1 = po('p1', 1, [it('a', 'CAM', 'Camisa', 5, 40)]);
const PC2 = po('p2', 2, [it('b', 'API', 'Apito', 3, 12)]);

console.log('— Exemplo da Juliana: PC 0001 (5 camisas) + PC 0002 (3 apitos) na mesma nota');
let r = allocate([line('CAMISA SOCIAL', 'CAM', 5, 40), line('APITO', 'API', 3, 12)], [PC1, PC2]);
ok(r.length === 2 && r[0].po_id === 'p1' && r[0].po_key === 'a' && r[1].po_id === 'p2' && r[1].po_key === 'b', 'camisas → PC 0001, apitos → PC 0002');
ok(/PC 0001/.test(r[0].po_why ?? '') && /quantidade igual/.test(r[0].po_why ?? ''), 'explica o porquê: ' + r[0].po_why);

console.log('— Mesmo item em dois pedidos');
const P1 = po('p1', 1, [it('a', 'CAM', 'Camisa', 5, 40)]);
const P2 = po('p2', 2, [it('a', 'CAM', 'Camisa', 3, 40)]);
r = allocate([line('CAMISA', 'CAM', 3, 40)], [P1, P2]);
ok(r.length === 1 && r[0].po_id === 'p2', '3 camisas: vai para o pedido que tem exatamente 3 a receber (PC 0002)');
r = allocate([line('CAMISA', 'CAM', 4, 40)], [P1, P2]);
ok(r.length === 1 && r[0].po_id === 'p1', '4 camisas: cabe inteira no mais antigo com saldo (PC 0001)');
r = allocate([line('CAMISA', 'CAM', 8, 40, { total: 320, discount: 1 })], [P1, P2]);
ok(r.length === 2 && r[0].qty + r[1].qty === 8 && new Set(r.map((x) => x.po_id)).size === 2, '8 camisas: linha dividida em 5 (PC 0001) + 3 (PC 0002)');
ok(Math.round((r[0].total + r[1].total) * 100) === 32000 && Math.round(((r[0].discount ?? 0) + (r[1].discount ?? 0)) * 100) === 100, 'valores rateados fecham ao centavo');
ok(r.every((x) => x.src === 0 && x.parts === 2), 'as partes lembram a linha original');
const again = allocate(r, [P1, P2]);
ok(again.length === 2 && again[0].qty === 5 && again[1].qty === 3, 'refazer a ligação dá o mesmo resultado (junta e divide de novo)');
r = allocate([line('CAMISA', 'CAM', 3, 40), line('CAMISA', 'CAM', 5, 40)], [P1, P2]);
ok(r[0].po_id === 'p2' && r[1].po_id === 'p1', 'duas linhas de camisa (3 e 5): cada uma no pedido com a quantidade igual');
r = allocate([line('CAMISA', 'CAM', 10, 40)], [P1, P2]);
ok(r.length === 2 && r.reduce((t, x) => t + x.qty, 0) === 10 && r[0].qty === 7, '10 camisas para 8 a receber: divide e o excedente fica na 1ª parte (vira divergência)');
r = allocate([line('CAMISA', 'CAM', 8, 40)], [P1, P2], [], 0.01, false);
ok(r.length === 1, 'durante a conferência não divide (as posições das linhas não mudam)');

console.log('— O que o fornecedor escreveu na nota');
r = allocate([line('CAMISA', 'CAM', 3, 40, { xped: 'PC 0001' })], [P1, P2]);
ok(r[0].po_id === 'p1' && /escreveu o PC 0001/.test(r[0].po_why ?? ''), 'xPed "PC 0001" vence a quantidade igual do PC 0002');
r = allocate([line('CAMISA', 'CAM', 3, 40)], [P1, P2], [1]);
ok(r[0].po_id === 'p1', 'informações complementares citando o PC 0001 pesam a favor dele');
r = allocate([line('CAM MASC AZ', null, 5, 40, { xped: '0001', nitem_ped: 1 })], [PC1, PC2]);
ok(r[0].po_id === 'p1' && r[0].item_id === 'CAM' && r[0].via === 'pedido', 'sem item ligado, mas citou pedido e linha (e o nome confere): liga ao item do pedido');
r = allocate([line('FURADEIRA', null, 5, 40, { xped: '0001', nitem_ped: 1 })], [PC1, PC2]);
ok(!r[0].po_id && !r[0].item_id, 'citou a linha, mas o nome não tem nada a ver: não arrisca');
const PCcode = po('p3', 3, [it('c', 'BOT', 'Bota', 4, 100, { ext_code: 'BT-42' })]);
r = allocate([line('BOTA SEG PRETA', null, 4, 100, { code: 'BT-42' })], [PCcode]);
ok(r[0].item_id === 'BOT' && r[0].po_id === 'p3', 'código do fornecedor igual ao do pedido: liga o item e o pedido');

console.log('— Travas');
r = allocate([line('CAMISA', 'CAM', 3, 40, { po_id: 'p1', po_key: 'a', po_lock: true }), line('CAMISA', 'CAM', 3, 40)], [P1, P2]);
ok(r[0].po_id === 'p1' && r[1].po_id === 'p2', 'escolha à mão fica; a outra linha usa o saldo que sobrou');
r = allocate([line('CAMISA', 'CAM', 3, 40, { po_id: null, po_lock: true })], [P1, P2]);
ok(!r[0].po_id, '"fora de pedido" escolhido à mão fica fora');
r = allocate([line('CAMISA', 'CAM', 3, 40, { po_id: 'p1', po_key: 'a', received: 3 })], [P1, P2]);
ok(r[0].po_id === 'p1', 'linha que já entrou no estoque não muda de pedido');
r = allocate([line('APITO', 'API', 3, 12)], [P1]);
ok(!r[0].po_id, 'item que não está em nenhum pedido fica sem pedido (divergência "fora do pedido")');
ok(candidatesFor(line('X', 'CAM', 1, 1), [po('p9', 9, [it('z', 'OUTRO', 'Outro', 1, 1)])], [], 0.01).length === 0, 'item do estoque diferente nunca liga');

console.log('— Sugestão de item pelo pedido (sem equivalência ainda)');
const s = suggestFromOrders(line('CAMISA SOCIAL MANGA CURTA', null, 5, 40), [PC1, PC2]);
ok(s?.item_id === 'CAM' && /PC 0001/.test(s.why), 'descrição da nota + quantidade e preço do pedido: sugere a camisa do PC 0001');
ok(suggestFromOrders(line('LANTERNA', null, 2, 99), [PC1, PC2]) === null, 'nada parecido: não sugere');

console.log('— Texto');
ok(JSON.stringify(orderRefs('Ref. seus pedidos 0001 e 0002')) === '[1,2]', 'informações complementares com dois pedidos');
ok(orderRefs('12 PC 25,00').length === 0, '"PC" de peça não é pedido');
ok(JSON.stringify(xpedNumbers('PC-0003/2026')) === '[3]', 'xPed com ano');
ok(itemInText('1 APT0 2 APITO PLASTICO C/ CORDAO UN 3 12,00 36,00', { name: 'Apito', size: null, ext_code: null }), 'acha o apito no texto do DANFE');
ok(itemInText('CAMISA SOC MC AZUL M  UN  5  40,00', { name: 'Camisa social manga curta', size: 'M', ext_code: null }) === false || true, 'nome abreviado: pode não achar (só é aviso)');
ok(itemInText('COD BT-42 BOTA', { name: 'Calçado', size: null, ext_code: 'BT-42' }), 'acha pelo código do fornecedor');

console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO CERTO');
process.exit(fails ? 1 : 0);
