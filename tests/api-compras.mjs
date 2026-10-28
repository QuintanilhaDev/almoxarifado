/**
 * Aceite das especificações "Módulo de Compras" e "Estoque/Recebimento/NF/Pagamentos"
 * pelas rotas da API (servidor Next + Postgres de teste).
 *
 *   node tests/api-compras.mjs [http://localhost:3100]
 */
import fs from 'node:fs';

const B = process.argv[2] || 'http://localhost:3100';
let pass = 0;
let failN = 0;
const ok = (cond, msg) => {
  if (cond) pass++;
  else failN++;
  console.log(`${cond ? '✓' : '✗ FALHOU'} ${msg}`);
};
class Client {
  constructor(name) {
    this.name = name;
    this.cookie = '';
  }
  async login() {
    const r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: this.name, password: '123456' }) });
    this.cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    if (r.status !== 200) throw new Error(`login ${this.name}: ${r.status}`);
    return this;
  }
  async req(method, url, json) {
    const r = await fetch(B + url, { method, headers: { cookie: this.cookie, ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: json === undefined ? undefined : JSON.stringify(json) });
    const ct = r.headers.get('content-type') || '';
    const body = ct.includes('json') ? await r.json().catch(() => ({})) : { bytes: (await r.arrayBuffer()).byteLength, type: ct };
    return { status: r.status, body };
  }
  get(u) { return this.req('GET', u); }
  post(u, j) { return this.req('POST', u, j ?? {}); }
  patch(u, j) { return this.req('PATCH', u, j); }
  put(u, j) { return this.req('PUT', u, j); }
  del(u) { return this.req('DELETE', u); }
  async upload(u, buf, name, type, extra = {}) {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type }), name);
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    const r = await fetch(B + u, { method: 'POST', headers: { cookie: this.cookie }, body: fd });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
}

/** chave de acesso válida (DV módulo 11) para CNPJ/série/número */
function makeKey(cnpj, series, number) {
  const base = '29' + '2610' + cnpj + '55' + String(series).padStart(3, '0') + String(number).padStart(9, '0') + '1' + '12345678';
  let w = 2;
  let s = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    s += Number(base[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  return base + (s % 11 < 2 ? 0 : 11 - (s % 11));
}

const [mateus, neilton, carlos, lucas, fabia] = await Promise.all(['mateus', 'neilton', 'carlos', 'lucas', 'fabia'].map((n) => new Client(n).login()));
const stock = async () => (await neilton.get('/api/almoxarifado/stock')).body.items;
const find = (items, name, size) => items.find((i) => i.name === name && (i.size ?? null) === (size ?? null));
let items = await stock();
const bota42 = find(items, 'Bota de segurança', '42');
const calca = find(items, 'Calça tática', '44');
const bone = find(items, 'Boné', null);

/* ------------------------------------------------------------ fornecedores */
console.log('\n— Fornecedores: homologação e prazos');
let r = await carlos.post('/api/compras/fornecedores', { name: 'Fardas Bahia Ltda', cnpj: '11222333000181', email: 'vendas@fardas.com', category: 'fardamento, calças, botas' });
ok(r.status === 200, 'cadastra Fardas Bahia');
const fardas = r.body.supplier;
r = await carlos.post('/api/compras/fornecedores', { name: 'Botas Forte Comércio', cnpj: '11444777000161', category: 'botas e calçados de segurança' });
const botasF = r.body.supplier;
r = await carlos.post('/api/compras/fornecedores', { name: 'Marvin Uniformes', cnpj: '45723174000110', category: 'uniformes, bonés' });
const marvin = r.body.supplier;
r = await carlos.get(`/api/compras/fornecedores/${fardas.id}/perfil`);
ok(r.status === 200 && r.body.supplier.homologation === 'pendente', 'fornecedor novo nasce "aguardando homologação"');
r = await carlos.patch(`/api/compras/fornecedores/${fardas.id}/perfil`, { homologation: 'homologado', lead_days: 7, payment_terms: '30/60' });
ok(r.status === 200, 'Fardas homologado, prazo padrão 7 dias úteis');
r = await carlos.patch(`/api/compras/fornecedores/${marvin.id}/perfil`, {
  homologation: 'homologado',
  exclusive: true,
  products: [
    { item_id: bone.id, lead_days: 5, lead_business: true, mode: 'pronta', in_contract: true, confirmed: false },
    { item_id: calca.id, lead_days: 30, lead_business: true, mode: 'producao', in_contract: false },
  ],
});
ok(r.status === 200, 'Marvin: boné do contrato em 5 dias úteis; calça sob produção em 30 dias úteis (prazos por item)');
r = await carlos.get(`/api/compras/fornecedores/${marvin.id}/perfil`);
ok(r.body.products.length === 2 && r.body.products.find((p) => p.item_id === bone.id).in_contract && r.body.products.find((p) => p.item_id === calca.id).mode === 'producao', 'prazos diferentes por item (não presume o mesmo prazo para tudo)');
r = await lucas.patch(`/api/compras/fornecedores/${botasF.id}/perfil`, { homologation: 'homologado' });
ok(r.status === 403, 'quem só visualiza não homologa');

/* ------------------------------------------------------------ requisição → cotação */
console.log('\n— Requisição de compra → cotação com mapa');
r = await neilton.post('/api/compras/requests', { items: [{ item_id: bota42.id, quantity: 20 }, { item_id: calca.id, quantity: 10 }], reason: 'Reposição do mínimo', priority: 'urgente' });
ok(r.status === 200, 'Almoxarifado pede compra (bota 42 × 20, calça 44 × 10)');
const req1 = r.body.request;
r = await neilton.post('/api/compras/requests', { items: [{ item_id: calca.id, quantity: 5 }] });
const req2 = r.body.request;
r = await carlos.post('/api/compras/cotacoes', { request_ids: [req1.id, req2.id], reply_by: '2026-10-25' });
ok(r.status === 200, 'Compras abre uma cotação juntando as duas solicitações');
let q = r.body.quote;
const kBota = q.items.find((i) => i.item_id === bota42.id).key;
const kCalca = q.items.find((i) => i.item_id === calca.id).key;
ok(q.items.find((i) => i.key === kCalca).qty === 15 && q.items.find((i) => i.key === kCalca).requests.length === 2, 'calça consolidada: 10 + 5 = 15, guardando as duas origens');
ok(q.proposals.some((p) => p.supplier_id === marvin.id) && q.proposals.some((p) => p.supplier_id === fardas.id), `fornecedores sugeridos entraram sozinhos (${q.proposals.map((p) => p.supplier_name).join(', ')})`);
r = await carlos.get('/api/compras/requests');
ok(r.body.requests.find((x) => x.id === req1.id).status === 'em_cotacao', 'solicitação passou para "Em cotação"');
r = await carlos.post('/api/compras/cotacoes', { request_ids: [req1.id] });
ok(r.status === 409, 'a mesma solicitação não entra em duas cotações abertas');
r = await carlos.get(`/api/compras/cotacoes/${q.id}/rfq?proposal=${q.proposals[0].id}`);
ok(r.status === 200 && /pdf/.test(r.body.type) && r.body.bytes > 1500, 'solicitação de orçamento em PDF');
r = await carlos.get(`/api/compras/cotacoes/${q.id}/rfq?proposal=${q.proposals.find((p) => p.supplier_id === fardas.id).id}&format=email`);
ok(r.status === 200 && r.body.to === 'vendas@fardas.com' && /Solicitação de orçamento/.test(r.body.subject) && /Bota de segurança/.test(r.body.body), 'e-mail do pedido de orçamento pronto (com o e-mail do fornecedor)');

const pFardas = q.proposals.find((p) => p.supplier_id === fardas.id);
const pMarvin = q.proposals.find((p) => p.supplier_id === marvin.id);
const line = (key, unit_price, extra = {}) => ({ key, unit_price, ...extra });
r = await carlos.patch(`/api/compras/cotacoes/${q.id}`, { action: 'proposal', proposal: { id: pFardas.id, status: 'recebida', valid_until: '2026-12-31', freight: 30, payment: { mode: 'parcelado', installments: 2, days: '30/60' }, delivery: { days: 7, business: true }, lines: [line(kBota, 100, { first_price: 110, brand: 'Bracol' }), line(kCalca, 80, { first_price: 85 })] } });
ok(r.status === 200, 'proposta da Fardas registrada (com preço inicial e negociado)');
r = await carlos.patch(`/api/compras/cotacoes/${q.id}`, { action: 'proposal', proposal: { id: pMarvin.id, status: 'recebida', valid_until: '2026-12-31', lines: [line(kBota, null, { available: false }), line(kCalca, 90)], delivery: { days: 30, business: true, mode: 'producao' } } });
ok(r.status === 200, 'proposta da Marvin (sem bota; calça sob produção) ' + (r.body.error ?? ''));
r = await carlos.patch(`/api/compras/cotacoes/${q.id}`, { action: 'proposal', proposal: { supplier_id: botasF.id, status: 'recebida' } });
ok(r.status === 409, 'o mesmo fornecedor não entra duas vezes na cotação');
r = await carlos.patch(`/api/compras/cotacoes/${q.id}`, { action: 'proposal', proposal: { id: q.proposals.find((p) => p.supplier_id === botasF.id).id, status: 'recebida', valid_until: '2026-12-31', lines: [line(kBota, 92)], delivery: { days: 3 } } });
ok(r.status === 200, 'Botas Forte (ainda não homologado) também cotou ' + (r.body.error ?? ''));
q = r.body.quote;
const pBotas = q.proposals.find((p) => p.supplier_id === botasF.id);
r = await carlos.patch(`/api/compras/cotacoes/${q.id}`, { action: 'decide', lines: { [kBota]: pBotas.id, [kCalca]: pFardas.id } });
ok(r.status === 409 && /homologad/.test(r.body.error), 'não contrata fornecedor sem homologação: ' + r.body.error);
// a calça da Marvin (90) é mais cara que a da Fardas (80); o fornecedor sem homologação nem entra na recomendação
r = await carlos.patch(`/api/compras/cotacoes/${q.id}`, { action: 'decide', lines: { [kBota]: pFardas.id, [kCalca]: pMarvin.id } });
ok(r.status === 400 && r.body.needs === 'justification', 'escolher quem não é o de menor custo exige justificativa');
r = await carlos.patch(`/api/compras/cotacoes/${q.id}`, { action: 'decide', lines: { [kBota]: pFardas.id, [kCalca]: pFardas.id }, justification: 'Bracol tem CA válido e a Botas Forte ainda não foi homologada; um fornecedor só reduz frete.' });
ok(r.status === 200 && r.body.orders.length === 1, 'mapa decidido com justificativa → 1 pedido de compra em rascunho');
let po = r.body.orders[0];
ok(po.status === 'rascunho' && po.items.length === 2 && po.total === 100 * 20 + 80 * 15 + 30, `pedido com itens, preços e frete da proposta (total ${po.total})`);
r = await carlos.get(`/api/compras/cotacoes/${q.id}`);
ok(r.body.quote.status === 'decidida' && r.body.quote.proposals.length === 3, 'cotação decidida e as propostas não vencedoras continuam guardadas');

/* ------------------------------------------------------------ pedido de compra */
console.log('\n— Pedido de compra: aprovação, envio, confirmação');
r = await carlos.patch(`/api/compras/pedidos/${po.id}`, { action: 'submit' });
ok(r.status === 200 && r.body.order.status === 'aguardando_aprovacao', 'enviado para aprovação (alçada padrão: todo pedido)');
r = await carlos.patch(`/api/compras/pedidos/${po.id}`, { action: 'approve' });
ok(r.status === 409 && /próprio/.test(r.body.error), 'quem emitiu não aprova o próprio pedido');
r = await lucas.patch(`/api/compras/pedidos/${po.id}`, { action: 'approve' });
ok(r.status === 403, 'sem a permissão de aprovação, não aprova');
r = await mateus.patch(`/api/compras/pedidos/${po.id}`, { action: 'approve', note: 'ok' });
ok(r.status === 200 && r.body.order.status === 'aprovado' && r.body.order.expected_date, `aprovado pelo master geral, previsão calculada (${r.body.order.expected_date})`);
r = await carlos.get('/api/compras/requests');
ok(r.body.requests.find((x) => x.id === req1.id).status === 'comprada' && /PC 0001/.test(r.body.requests.find((x) => x.id === req1.id).order_ref), 'solicitação virou "Comprada" com o nº do pedido');
r = await carlos.get(`/api/compras/pedidos/${po.id}/pdf`);
ok(r.status === 200 && /pdf/.test(r.body.type) && r.body.bytes > 1500, 'PDF do pedido de compra');
r = await carlos.patch(`/api/compras/pedidos/${po.id}`, { action: 'send', via: 'e-mail' });
ok(r.status === 200 && r.body.order.status === 'enviado', 'enviado ao fornecedor');
r = await carlos.patch(`/api/compras/pedidos/${po.id}`, { action: 'confirm', promised_date: '2026-10-28' });
ok(r.status === 200 && r.body.order.status === 'confirmado' && r.body.order.promised_date === '2026-10-28', 'fornecedor confirmou a data');
// alteração depois de aprovado: precisa de motivo e volta para aprovação
r = await carlos.patch(`/api/compras/pedidos/${po.id}`, { action: 'edit', items: po.items.map((i) => ({ ...i, unit_price: i.key === po.items[0].key ? 105 : i.unit_price })) });
ok(r.status === 400, 'alterar pedido aprovado exige motivo');
r = await carlos.patch(`/api/compras/pedidos/${po.id}`, { action: 'edit', reason: 'fornecedor reajustou', items: po.items.map((i) => ({ ...i, unit_price: i.key === po.items[0].key ? 105 : i.unit_price })) });
ok(r.status === 200 && r.body.order.status === 'aguardando_aprovacao', 'mudou preço → volta para aprovação, com histórico');
r = await mateus.patch(`/api/compras/pedidos/${po.id}`, { action: 'reject', note: 'manter o preço combinado' });
ok(r.status === 200 && r.body.order.status === 'confirmado' && r.body.order.items[0].unit_price === 100, 'alteração recusada: pedido volta ao que foi aprovado (e ao status de antes)');
po = r.body.order;

/* ------------------------------------------------------------ saldos */
console.log('\n— Saldos: pedido não soma ao físico');
items = await stock();
ok(find(items, 'Calça tática', '44').quantity === calca.quantity, 'emitir pedido NÃO muda o estoque físico (critério a)');
r = await neilton.get('/api/almoxarifado/stock/a-receber');
ok(r.status === 200 && r.body.on_order[calca.id]?.qty === 15 && r.body.on_order[calca.id].next === '2026-10-28', 'calça: 15 "a receber", previsão 28/10');
r = await neilton.get('/api/compras/pedidos');
ok(r.status === 200 && r.body.orders.some((o) => o.id === po.id && o.payment.mode === 'parcelado'), 'Almoxarifado vê o pedido e as condições sem pedir a Compras (critério c)');

/* ------------------------------------------------------------ recebimento pelo pedido */
console.log('\n— Recebimento: DANFE, conferência, divergência, parcelas');
const up = await neilton.upload('/api/anexos', Buffer.from('%PDF-1.4 danfe de teste'), 'danfe.pdf', 'application/pdf', { scope: 'nota' });
ok(up.status === 200 && up.body.attachment.path.startsWith('compras/nota/'), 'DANFE anexado');
r = await neilton.get('/api/anexos?path=' + encodeURIComponent(up.body.attachment.path));
ok(r.status === 200 && r.body.bytes > 10, 'anexo baixa de volta');
const key = makeKey('11222333000181', 1, 5501);
const iCalca = po.items.find((i) => i.item_id === calca.id);
const iBota = po.items.find((i) => i.item_id === bota42.id);
const bad = makeKey('11222333000181', 1, 5502);
r = await neilton.post('/api/almoxarifado/notas', { number: '5501', series: '1', access_key: bad, supplier_name: 'Fardas Bahia Ltda', cnpj: '11222333000181', items: [{ code: 'CAL-44', description: 'Calça tática 44', qty: 15, total: 1230, unit_value: 82, item_id: calca.id }], purchase_order_id: po.id });
ok(r.status === 400 && /5502/.test(r.body.error), 'chave que não bate com o número é recusada (erro de leitura do DANFE)');
// calça veio 82 (pedido 80) → preço divergente; bota sem divergência
const nfBody = {
  number: '5501',
  series: '1',
  access_key: key,
  issue_date: '2026-10-16',
  supplier_name: 'Fardas Bahia Ltda',
  cnpj: '11222333000181',
  items: [
    { code: 'CAL-44', description: 'Calça tática 44', unit: 'UN', qty: 15, unit_value: 82, total: 1230, item_id: calca.id, po_key: iCalca.key },
    { code: 'BT-42', description: 'Bota segurança 42', unit: 'PAR', qty: 20, unit_value: 100, total: 2000, item_id: bota42.id, po_key: iBota.key },
  ],
  totals: { freight: 30, total: 3260 },
  purchase_order_id: po.id,
  attachments: [up.body.attachment],
};
r = await neilton.post('/api/almoxarifado/notas', nfBody);
ok(r.status === 200, 'NF registrada pelo DANFE, ligada ao pedido');
let note = r.body.note;
ok(note.status === 'divergencia' && note.divergences.some((d) => d.kind === 'preco' && d.blocking), 'preço diferente do pedido é destacado (critério)');
ok(note.installments.length === 2 && note.installments_status === 'incompleta' && Math.abs(note.installments.reduce((t, p) => t + p.value, 0) - 3260) < 0.001, 'parcelas sugeridas pela condição do pedido (30/60), ainda a validar');
items = await stock();
ok(find(items, 'Calça tática', '44').quantity === calca.quantity, 'registrar/digitalizar a nota NÃO movimenta o estoque');
r = await neilton.post('/api/almoxarifado/notas', nfBody);
ok(r.status === 409, 'NF já registrada pela mesma chave não entra de novo (critério)');
// parcelas: 1000 + 1000 + 999,99 para 3000 → bloqueia mostrando 0,01
r = await neilton.post(`/api/almoxarifado/notas/${note.id}/parcelas`, { validate: true, installments: [{ n: '1/3', due: '2026-11-10', value: 1000 }, { n: '2/3', due: '2026-12-10', value: 1000 }, { n: '3/3', due: '2027-01-10', value: 1259.99 }] });
ok(r.status === 400 && /0,01/.test(r.body.error), 'soma das parcelas ≠ total bloqueia e mostra a diferença de R$ 0,01: ' + r.body.error);
r = await neilton.post(`/api/almoxarifado/notas/${note.id}/parcelas`, { validate: true, installments: [{ n: '1/2', due: '2026-11-17', value: 1630, method: 'Boleto', ref: '23790.0001' }, { n: '2/2', due: '2026-12-15', value: 1630 }] });
ok(r.status === 200 && r.body.note.installments_status === 'validada', 'parcelas validadas (soma exata), com forma e referência do boleto');
ok(r.body.note.history.some((h) => /Parcelas alteradas/.test(h.what)), 'alteração das parcelas fica registrada no histórico ' + JSON.stringify(r.body.note.history.map((h) => h.what)));
// conferência física: calça chegou 13, 1 com avaria; bota 20 ok
const iNC = note.items.findIndex((l) => l.item_id === calca.id);
const iNB = note.items.findIndex((l) => l.item_id === bota42.id);
r = await neilton.post(`/api/almoxarifado/notas/${note.id}/conferencia`, { lines: [{ i: iNC, delivered: 13, accepted: 12, refused: 1 }, { i: iNB, delivered: 20, accepted: 20, refused: 0 }] });
ok(r.status === 400 && /motivo/.test(r.body.error), 'recusa exige motivo');
r = await neilton.post(`/api/almoxarifado/notas/${note.id}/conferencia`, { lines: [{ i: iNC, delivered: 13, accepted: 12, refused: 1, note: 'costura aberta' }, { i: iNB, delivered: 20, accepted: 20, refused: 0 }] });
ok(r.status === 200 && r.body.note.divergences.some((d) => d.kind === 'falta') && r.body.note.divergences.some((d) => d.kind === 'recusa'), 'faltou 2 e 1 recusada: viram divergências (sem inflar o saldo)');
note = r.body.note;
r = await neilton.post(`/api/almoxarifado/notas/${note.id}/post`, { lines: [{ i: iNC, qty: 12 }, { i: iNB, qty: 20 }] });
ok(r.status === 409 && /divergência/.test(r.body.error), 'divergência de preço aberta trava a entrada: ' + r.body.error);
const dPreco = note.divergences.find((d) => d.kind === 'preco');
r = await neilton.post(`/api/almoxarifado/notas/${note.id}/divergencia`, { divergence_id: dPreco.id, resolution: 'ok', decision: 'tratada' });
ok(r.status === 403, 'Almoxarifado não trata divergência comercial (é de Compras/gestão)');
r = await lucas.post(`/api/almoxarifado/notas/${note.id}/divergencia`, { divergence_id: dPreco.id, resolution: 'Autorizo o preço novo', decision: 'autorizada' });
ok(r.status === 403, 'quem só visualiza Compras não trata');
r = await carlos.post(`/api/almoxarifado/notas/${note.id}/divergencia`, { divergence_id: dPreco.id, resolution: 'Fornecedor reajustou R$ 2; diferença autorizada pela gestão', decision: 'autorizada' });
ok(r.status === 200 && r.body.note.divergences.find((d) => d.id === dPreco.id).status === 'resolvida', 'Compras/gestão autoriza com justificativa');
r = await neilton.post(`/api/almoxarifado/notas/${note.id}/post`, { lines: [{ i: iNC, qty: 13 }] });
ok(r.status === 409 && /aceitou 12/.test(r.body.error), 'só entra o que foi aceito na conferência');
r = await neilton.post(`/api/almoxarifado/notas/${note.id}/post`, { lines: [{ i: iNC, qty: 12 }, { i: iNB, qty: 20 }] });
ok(r.status === 200 && r.body.order?.status === 'parcial', 'entrada confirmada; pedido fica "entrega parcial" (critério b)');
note = r.body.note;
ok(note.status === 'parcial', 'nota fica "recebimento parcial" (faltam 2 calças)');
items = await stock();
ok(find(items, 'Calça tática', '44').quantity === calca.quantity + 12 && find(items, 'Bota de segurança', '42').quantity === bota42.quantity + 20, 'físico subiu só o aceito: +12 calças e +20 botas');
r = await neilton.get('/api/almoxarifado/stock/a-receber');
ok(r.body.on_order[calca.id]?.qty === 3 && !r.body.on_order[bota42.id], 'a receber da calça caiu para 3 (15 − 12); bota zerou');
r = await carlos.get('/api/compras/requests');
ok(r.body.requests.find((x) => x.id === req1.id).status === 'comprada', 'solicitação continua "Comprada" enquanto falta chegar');

/* ------------------------------------------------------------ equivalências */
console.log('\n— Equivalência de códigos (XML de 3 itens, 2 códigos conhecidos)');
r = await neilton.post('/api/compras/fornecedores', { name: 'Fornecedor XML', cnpj: '12345678000199' });
ok(r.status === 403, 'Almoxarifado não cadastra fornecedor (é de Compras)');
r = await carlos.post('/api/compras/fornecedores', { name: 'Distribuidora Exemplo', cnpj: '12345678000195' });
// o XML de exemplo é do CNPJ 12345678000199 (dígito inválido para cadastro manual): a 1ª nota cria o fornecedor
r = await neilton.upload('/api/almoxarifado/notas/parse', fs.readFileSync('tests/fixtures/nfe-exemplo.xml'), 'nfe.xml', 'text/xml');
const sid = r.body.supplier_id;
ok(r.status === 200 && r.body.nfe.items.every((l) => l.item_id === null), 'sem equivalência validada, nada é ligado só pela descrição');
ok(r.body.nfe.items.find((l) => l.code === 'BT-42').options[0]?.id === bota42.id, 'mas a bota aparece como sugestão para confirmar');
const xmlNote = r.body;
// registra a 1ª nota desse fornecedor para ele existir, e valida duas equivalências
r = await neilton.post('/api/almoxarifado/notas', { ...xmlNote.nfe, supplier_name: xmlNote.nfe.supplier.name, cnpj: xmlNote.nfe.supplier.cnpj, items: xmlNote.nfe.items.map((l) => ({ ...l, item_id: null })), xml: xmlNote.xml });
ok(r.status === 200 && r.body.note.installments_status === 'validada', 'parcelas do XML que fecham com o total já valem');
const firstNote = r.body.note;
const sid2 = r.body.note.supplier_id;
r = await neilton.post('/api/almoxarifado/equivalencias', { supplier_id: sid2, code: 'BT-42', unit: 'PAR', description: 'BOTA DE SEGURANCA PRETA N 42', item_id: bota42.id, factor: 1 });
ok(r.status === 200, 'Juliana valida: BT-42 (PAR) = Bota 42');
r = await neilton.post('/api/almoxarifado/equivalencias', { supplier_id: sid2, code: 'CAM-OP-M', unit: 'UN', item_id: find(items, 'Camisa social manga curta', 'M').id, factor: 1 });
ok(r.status === 200, 'CAM-OP-M = Camisa M');
r = await neilton.post('/api/almoxarifado/equivalencias', { supplier_id: sid2, code: 'X', item_id: bota42.id, factor: 0 });
ok(r.status === 400, 'fator de conversão inválido é recusado');
r = await neilton.upload('/api/almoxarifado/notas/parse', fs.readFileSync('tests/fixtures/nfe-exemplo.xml'), 'nfe.xml', 'text/xml');
const lines = r.body.nfe.items;
ok(lines.find((l) => l.code === 'BT-42').item_id === bota42.id && lines.find((l) => l.code === 'CAM-OP-M').item_id && lines.find((l) => l.code === 'BT-42').via === 'fornecedor', 'NF com 3 itens e 2 códigos conhecidos: os 2 reconhecidos sozinhos');
ok(lines.find((l) => l.code === 'LT-REC').item_id === null, 'código desconhecido exige associação manual');
ok(r.body.duplicate, 'e a mesma nota aparece como já registrada');
r = await neilton.post(`/api/almoxarifado/notas/${firstNote.id}/post`, { lines: [{ i: 2, qty: 5 }] });
ok(r.status === 409 && /escolha o item/i.test(r.body.error), 'sem associar o item desconhecido, não entra');
r = await neilton.get('/api/almoxarifado/equivalencias');
ok(r.status === 200 && r.body.equivalences.filter((e) => e.supplier_id === sid2).length >= 2 && r.body.equivalences.every((e) => e.validated_by), 'tabela de equivalências com quem validou');
void sid;

// fator de conversão: 2 caixas de 10 = 20 unidades no estoque
console.log('\n— Fator de conversão');
r = await neilton.post('/api/almoxarifado/notas', { number: '7001', series: '1', supplier_name: 'Distribuidora Exemplo', cnpj: '12345678000195', items: [{ code: 'BN-CX', description: 'Boné caixa c/ 10', unit: 'CX', qty: 2, total: 200, item_id: bone.id, factor: 10 }], installments: [{ n: '1/1', due: '2026-11-30', value: 200 }], validate_installments: true });
ok(r.status === 200 && r.body.note.installments_status === 'validada', 'nota em caixas registrada, parcela confirmada');
const cx = r.body.note;
r = await neilton.post(`/api/almoxarifado/notas/${cx.id}/post`, { lines: [{ i: 0, qty: 20 }] });
ok(r.status === 200 && r.body.note.status === 'lancada', '2 caixas × 10 = 20 bonés deram entrada');
items = await stock();
ok(find(items, 'Boné', null).quantity === bone.quantity + 20 && Math.abs(Number(find(items, 'Boné', null).cost) - ((bone.quantity * 25 + 20 * 10) / (bone.quantity + 20))) < 0.02, 'saldo +20 e custo por unidade (R$ 10, não R$ 100 da caixa)');

/* ------------------------------------------------------------ compra direta (contrato) */
console.log('\n— Compra direta (item do contrato Marvin)');
r = await carlos.post('/api/compras/pedidos', { supplier_id: marvin.id, items: [{ item_id: bone.id, name: 'Boné', qty: 50, unit_price: 18 }] });
ok(r.status === 400 && /direta/.test(r.body.error), 'compra sem cotação exige o motivo');
r = await carlos.post('/api/compras/pedidos', { supplier_id: marvin.id, reason: 'Item do contrato Marvin', items: [{ item_id: bone.id, name: 'Boné', qty: 50, unit_price: 18 }] });
ok(r.status === 200 && r.body.order.delivery.days === 5 && r.body.order.delivery.business, 'pedido direto usa o prazo do item no contrato (5 dias úteis)');
const direct = r.body.order;
r = await carlos.put('/api/compras/config', { approval_min: 1000 });
ok(r.status === 200, 'alçada configurada: abaixo de R$ 1.000 aprova sozinho');
r = await carlos.patch(`/api/compras/pedidos/${direct.id}`, { action: 'submit' });
ok(r.status === 200 && r.body.order.status === 'aprovado' && r.body.order.approval.auto, 'pedido de R$ 900 aprovado pela alçada');
r = await lucas.put('/api/compras/config', { approval_min: 0 });
ok(r.status === 403, 'só o master de Compras ou o geral muda a alçada');

/* ------------------------------------------------------------ painéis e relatórios */
console.log('\n— Painéis e relatórios');
r = await carlos.get('/api/compras/painel');
ok(r.status === 200 && r.body.counts.po_open >= 2 && r.body.gestao.bought > 0, `painel de Compras (${r.body.counts.po_open} pedidos a receber, comprado ${r.body.gestao.bought})`);
ok(r.body.gestao.savings.negotiated === (110 - 100) * 20 + (85 - 80) * 15, `economia negociada pelo critério (${r.body.gestao.savings.negotiated})`);
ok(r.body.suppliers.some((s) => s.name.startsWith('Fardas')) && r.body.gestao.by_supplier.length > 0 && r.body.gestao.by_category.length > 0, 'desempenho de fornecedores e valor comprado por fornecedor/categoria');
r = await fabia.get('/api/almoxarifado/notas/vencimentos?format=xlsx');
ok(r.status === 200 && r.body.bytes > 3000, 'Financeiro baixa a planilha de vencimentos');
r = await fabia.get('/api/almoxarifado/notas/vencimentos?format=pdf&from=2026-11-01&to=2026-12-31');
ok(r.status === 200 && /pdf/.test(r.body.type), 'vencimentos por período em PDF (previsão, sem afirmar pagamento)');
r = await neilton.get(`/api/compras/pedidos/${po.id}`);
ok(r.status === 200 && r.body.notes.length === 1 && r.body.order.history.length >= 6, 'cada operação fica rastreável no histórico do pedido (critério f)');

/* ------------------------------------------------------------ estorno */
console.log('\n— Estorno devolve ao "a receber"');
r = await neilton.post(`/api/almoxarifado/notas/${note.id}/reverse`, { reason: 'NF cancelada pelo fornecedor' });
ok(r.status === 200, 'nota estornada');
r = await neilton.get('/api/almoxarifado/stock/a-receber');
ok(r.body.on_order[calca.id]?.qty === 15 && r.body.on_order[bota42.id]?.qty === 20, 'o pedido volta a ter tudo a receber');

/* ------------------------------------------------------------ uma nota, vários pedidos */
console.log('\n— Uma nota fiscal atendendo vários pedidos de compra (mesmo fornecedor)');
items = await stock();
const camM = find(items, 'Camisa social manga curta', 'M');
const radio = find(items, 'Rádio comunicador', null);
const mk = async (item, name, qty, price) => {
  const x = await carlos.post('/api/compras/pedidos', { supplier_id: marvin.id, reason: 'Item do contrato Marvin', items: [{ item_id: item.id, name, qty, unit_price: price }] });
  const y = await carlos.patch(`/api/compras/pedidos/${x.body.order.id}`, { action: 'submit' });
  return y.body.order;
};
const pA = await mk(camM, 'Camisa social manga curta', 5, 40);
const pB = await mk(radio, 'Rádio comunicador', 3, 12);
const pC = await mk(camM, 'Camisa social manga curta', 3, 40);
ok([pA, pB, pC].every((o) => o.status === 'aprovado'), `três pedidos da Marvin aprovados: PC ${pA.number} (5 camisas), PC ${pB.number} (3 rádios), PC ${pC.number} (3 camisas)`);
const lbl = (o) => String(o.number).padStart(4, '0');
const mkey = makeKey('45723174000110', 1, 9100);
// a Marvin faturou tudo numa nota só: 8 camisas numa linha (5 do PC A + 3 do PC C) e os rádios
// com o pedido escrito no item (xPed/nItemPed); nas informações complementares, os pedidos
const multiXml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${mkey}" versao="4.00">
<ide><serie>1</serie><nNF>9100</nNF><dhEmi>2026-10-16T09:00:00-03:00</dhEmi></ide>
<emit><CNPJ>45723174000110</CNPJ><xNome>MARVIN UNIFORMES LTDA</xNome></emit><dest><CNPJ>11222333000144</CNPJ><xNome>MAX FORTE</xNome></dest>
<det nItem="1"><prod><cProd>CSMC-M</cProd><xProd>CAMISA SOCIAL MANGA CURTA M</xProd><uCom>UN</uCom><qCom>8.0000</qCom><vUnCom>40.00</vUnCom><vProd>320.00</vProd></prod></det>
<det nItem="2"><prod><cProd>RD-01</cProd><xProd>RADIO COMUNICADOR HT</xProd><uCom>UN</uCom><qCom>3.0000</qCom><vUnCom>12.00</vUnCom><vProd>36.00</vProd><xPed>PC ${lbl(pB)}</xPed><nItemPed>1</nItemPed></prod></det>
<total><ICMSTot><vProd>356.00</vProd><vDesc>0</vDesc><vFrete>0</vFrete><vSeg>0</vSeg><vOutro>0</vOutro><vIPI>0</vIPI><vNF>356.00</vNF></ICMSTot></total>
<cobr><dup><nDup>001</nDup><dVenc>2026-11-16</dVenc><vDup>356.00</vDup></dup></cobr>
<infAdic><infCpl>Ref. seus pedidos ${lbl(pA)}, ${lbl(pB)} e ${lbl(pC)}</infCpl></infAdic>
</infNFe></NFe></nfeProc>`;
r = await neilton.upload('/api/almoxarifado/notas/parse', Buffer.from(multiXml), 'marvin.xml', 'text/xml');
ok(r.status === 200, 'XML da Marvin lido');
const mp = r.body;
ok(mp.order_refs?.includes(pA.number) && mp.order_refs.includes(pB.number) && mp.order_refs.includes(pC.number), 'pedidos citados nas informações complementares: ' + JSON.stringify(mp.order_refs));
const lRad = mp.nfe.items.find((l) => l.code === 'RD-01');
const lCam = mp.nfe.items.find((l) => l.code === 'CSMC-M');
ok(lRad.item_id === radio.id && lRad.via === 'pedido', 'rádio: o fornecedor citou pedido e linha → item ligado pelo pedido');
ok(lCam.item_id === null && lCam.options[0]?.id === camM.id && lCam.options[0].from === 'pedido', 'camisa (código novo): sugerida porque está nos pedidos em aberto — confirma com um toque: ' + lCam.options[0]?.label);
const pv = (i) => mp.preview.find((x) => x.i === i).parts;
ok(pv(mp.nfe.items.indexOf(lRad)).length === 1 && pv(mp.nfe.items.indexOf(lRad))[0].po_id === pB.id, `prévia: rádios → PC ${lbl(pB)}`);
// confirma a sugestão da camisa e registra SEM escolher pedido nenhum: a ligação é automática
r = await neilton.post('/api/almoxarifado/notas', { ...mp.nfe, supplier_name: mp.nfe.supplier.name, cnpj: mp.nfe.supplier.cnpj, items: mp.nfe.items.map((l) => ({ ...l, item_id: l.item_id ?? l.options[0].id })), xml: mp.xml });
ok(r.status === 200, 'nota registrada sem escolher pedido');
let mn = r.body.note;
const ids = mn.purchase_order_ids ?? [];
ok(ids.length === 3 && [pA, pB, pC].every((o) => ids.includes(o.id)), 'a nota ficou ligada aos 3 pedidos sozinha');
const cams = mn.items.filter((l) => l.item_id === camM.id);
ok(cams.length === 2 && cams.find((l) => l.po_id === pA.id)?.qty === 5 && cams.find((l) => l.po_id === pC.id)?.qty === 3 && cams.every((l) => l.parts === 2 && l.src === 0), 'a linha de 8 camisas foi dividida: 5 no PC A e 3 no PC C');
ok(Math.round(cams.reduce((t, l) => t + l.total, 0) * 100) === 32000, 'os valores das partes fecham com a linha da nota');
ok(mn.items.find((l) => l.item_id === radio.id)?.po_id === pB.id, 'rádios no PC B');
ok(!mn.divergences.some((d) => d.status !== 'resolvida'), 'sem divergência: preço e quantidades batem com os 3 pedidos');
ok(mn.history.some((h) => /Ligada (também|sozinha)/.test(h.what) && /dividida/.test(h.what)), 'o histórico conta a ligação automática');
ok(mn.items.every((l) => !l.po_id || l.po_why), 'cada ligação diz o porquê: ' + mn.items.map((l) => l.po_why).join(' | '));
// trocar à mão: rádio "fora de pedido" vira divergência; voltar ao automático desfaz
const iRad = mn.items.findIndex((l) => l.item_id === radio.id);
r = await neilton.patch(`/api/almoxarifado/notas/${mn.id}`, { po_links: [{ i: iRad, po_id: null }] });
ok(r.status === 200 && r.body.note.divergences.some((d) => d.kind === 'item_fora' && d.status === 'aberta') && !r.body.note.purchase_order_ids.includes(pB.id), 'linha marcada "fora de pedido": vira divergência e o PC B sai da nota');
r = await neilton.patch(`/api/almoxarifado/notas/${mn.id}`, { po_links: [{ i: iRad, auto: true }] });
ok(r.status === 200 && r.body.note.items[iRad].po_id === pB.id && !r.body.note.divergences.some((d) => d.status === 'aberta' && d.kind === 'item_fora'), 'de volta ao automático: rádio no PC B, divergência some');
r = await neilton.patch(`/api/almoxarifado/notas/${mn.id}`, { po_links: [{ i: iRad, po_id: pA.id, po_key: pA.items[0].key }] });
ok(r.status === 409 && /outro item/.test(r.body.error), 'não deixa ligar o rádio à linha de camisas');
mn = (await neilton.get(`/api/almoxarifado/notas/${mn.id}?orders=1`)).body;
ok(mn.orders?.some((o) => o.id === pA.id) && mn.orders.some((o) => o.id === pB.id), 'a nota lista os pedidos possíveis para trocar uma linha');
mn = mn.note;
// entrada de tudo: cada pedido baixa o seu
r = await neilton.post(`/api/almoxarifado/notas/${mn.id}/post`, { lines: mn.items.map((l, i) => ({ i, qty: l.qty * (l.factor || 1), item_id: l.item_id })) });
ok(r.status === 200 && r.body.note.status === 'lancada' && r.body.orders?.length === 3, 'entrada confirmada na nota inteira');
ok(r.body.orders.every((o) => o.status === 'concluido'), 'os 3 pedidos ficaram concluídos: ' + JSON.stringify(r.body.orders));
items = await stock();
ok(find(items, 'Camisa social manga curta', 'M').quantity === camM.quantity + 8 && find(items, 'Rádio comunicador', null).quantity === radio.quantity + 3, 'estoque: +8 camisas e +3 rádios');
r = await neilton.get('/api/almoxarifado/stock/a-receber');
ok(!r.body.on_order[camM.id] && !r.body.on_order[radio.id], 'nada mais a receber desses itens');
r = await carlos.get(`/api/compras/pedidos/${pC.id}`);
ok(r.body.notes.some((n) => n.id === mn.id) && r.body.order.items[0].received === 3, `o PC C mostra a nota e os 3 recebidos`);
// estorno: cada pedido volta a ter o seu a receber
r = await neilton.post(`/api/almoxarifado/notas/${mn.id}/reverse`, { reason: 'teste de estorno' });
ok(r.status === 200, 'nota estornada');
r = await neilton.get('/api/almoxarifado/stock/a-receber');
ok(r.body.on_order[camM.id]?.qty === 8 && r.body.on_order[radio.id]?.qty === 3, 'estorno devolve 8 camisas (5 + 3) e 3 rádios ao "a receber" dos pedidos certos');

// descrição que nem código nem nome resolvem: a IA lê e sugere (só sugere)
const aiXml = multiXml.replace(mkey, makeKey('45723174000110', 1, 9101)).replace('<nNF>9100</nNF>', '<nNF>9101</nNF>').replace('<xProd>RADIO COMUNICADOR HT</xProd>', '<xProd>KIT HT C/ BATERIA</xProd>').replace(/<xPed>[^<]*<\/xPed><nItemPed>1<\/nItemPed>/, '').replace('<cProd>RD-01</cProd>', '<cProd>KT-9</cProd>');
r = await neilton.upload('/api/almoxarifado/notas/parse', Buffer.from(aiXml), 'marvin2.xml', 'text/xml');
const kit = r.body.nfe?.items.find((l) => l.code === 'KT-9');
ok(r.status === 200 && kit && kit.item_id === null && kit.options[0]?.id === radio.id && kit.options[0].from === 'ia' && r.body.ai === 1, 'linha "KIT HT C/ BATERIA": a IA sugere o rádio do pedido (para confirmar): ' + kit?.options?.[0]?.label);

// pelo DANFE (sem XML): o PDF cita o outro pedido → a tela inclui sozinha
console.log('\n— DANFE em PDF citando outro pedido do fornecedor');
const PDFDocument = (await import('pdfkit')).default;
const pdfBuf = await new Promise((res) => {
  const d = new PDFDocument();
  const ch = [];
  d.on('data', (c) => ch.push(c));
  d.on('end', () => res(Buffer.concat(ch)));
  d.text(`DANFE  CHAVE DE ACESSO ${mkey.replace(/(\d{4})/g, '$1 ')}`);
  d.text('CAMISA SOCIAL MANGA CURTA M   UN  5  40,00  200,00');
  d.text('RADIO COMUNICADOR HT   UN  3  12,00  36,00');
  d.text(`INFORMACOES COMPLEMENTARES: Seu pedido nº ${pB.number}`);
  d.end();
});
const upd = await neilton.upload('/api/anexos', pdfBuf, 'danfe-marvin.pdf', 'application/pdf', { scope: 'nota' });
r = await neilton.get(`/api/almoxarifado/notas/danfe?path=${encodeURIComponent(upd.body.attachment.path)}&order=${pA.id}`);
ok(r.status === 200 && r.body.orders?.some((o) => o.id === pB.id), 'o DANFE traz o PC B também: ' + JSON.stringify(r.body.orders));
ok(Array.isArray(r.body.missing), 'e aponta o que não achou no DANFE: ' + JSON.stringify(r.body.missing?.length));

console.log(`\n${pass} ok, ${failN} falha(s)`);
process.exit(failN ? 1 : 0);
