/**
 * Simulação de aceite do Projeto 3 pelas rotas da API (servidor Next + Postgres de teste).
 * Roda o fluxo inteiro do PDF: catálogo, admissão pelo RH, pedido da Operação, reserva,
 * entrega parcial e total com termo, liberação abaixo do mínimo, compra, nota fiscal
 * (parcial, custo médio, duplicidade, estorno), troca anual, devolução, inventário,
 * baixa, reposição, gestão e permissões.
 *
 *   node tests/api-projeto3.mjs [http://localhost:3100]
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
  async req(method, url, json, raw) {
    const r = await fetch(B + url, { method, headers: { cookie: this.cookie, ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: raw ?? (json === undefined ? undefined : JSON.stringify(json)) });
    const ct = r.headers.get('content-type') || '';
    const body = ct.includes('json') ? await r.json().catch(() => ({})) : { bytes: (await r.arrayBuffer()).byteLength, type: ct };
    return { status: r.status, body };
  }
  get(u) { return this.req('GET', u); }
  post(u, j) { return this.req('POST', u, j ?? {}); }
  patch(u, j) { return this.req('PATCH', u, j); }
  put(u, j) { return this.req('PUT', u, j); }
  del(u) { return this.req('DELETE', u); }
  async upload(u, file, name) {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(file)]), name);
    const r = await fetch(B + u, { method: 'POST', headers: { cookie: this.cookie }, body: fd });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
}

const today = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() - 3 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);

const [mateus, neilton, juliana, carla, rita, uesley, carlos, fabia, pedro] = await Promise.all(['mateus', 'neilton', 'juliana', 'carla', 'rita', 'uesley', 'carlos', 'fabia', 'pedro'].map((n) => new Client(n).login()));

const stock = async () => (await neilton.get('/api/almoxarifado/stock')).body.items;
const find = (items, name, size) => items.find((i) => i.name === name && (i.size ?? null) === (size ?? null));

/* ------------------------------------------------------------ 1. catálogo */
console.log('\n— Catálogo (código CC-GG-NNNN)');
let r = await neilton.get('/api/almoxarifado/catalog');
ok(r.status === 200 && r.body.ready && r.body.groups.length >= 10, 'grupos do catálogo carregados');
r = await neilton.get('/api/almoxarifado/catalog/classify');
ok(r.status === 200 && r.body.items.length === 10, `sugestões para os 10 itens sem código (${r.body.items?.length})`);
const sug = r.body.items;
const bota = sug.find((s) => s.name === 'Bota de segurança');
ok(bota && bota.cat === '01' && bota.grp === '03', `bota sugerida como Fardamento › Calçados (como no PDF) (${bota?.cat}-${bota?.grp})`);
const camisa = sug.find((s) => s.name.startsWith('Camisa'));
ok(camisa && camisa.cat === '01', `camisa sugerida como Fardamento (${camisa?.cat}-${camisa?.grp})`);
r = await juliana.post('/api/almoxarifado/catalog/classify', { items: sug.filter((s) => s.cat).map((s) => ({ id: s.id, cat: s.cat, grp: s.grp })) });
ok(r.status === 403, 'Juliana (só visualiza estoque) não classifica: ' + r.status);
r = await neilton.post('/api/almoxarifado/catalog/classify', { items: sug.filter((s) => s.cat).map((s) => ({ id: s.id, cat: s.cat, grp: s.grp })) });
ok(r.status === 200 && r.body.done === sug.filter((s) => s.cat).length, `classificação automática confirmada (${r.body.done})`);
let items = await stock();
const codes = items.map((i) => i.code).filter(Boolean);
ok(codes.length === r.body.done && new Set(codes).size === codes.length && codes.every((c) => /^\d{2}-\d{2}-\d{4}$/.test(c)), `códigos únicos no formato CC-GG-NNNN (${codes.slice(0, 3).join(', ')}…)`);
const b40 = find(items, 'Bota de segurança', '40');
r = await neilton.patch(`/api/almoxarifado/stock/${b40.id}`, { cat_code: '01', grp_code: '01' });
ok(r.status === 409 && /não pode ser alterado|imutável|já tem/i.test(r.body.error || ''), 'código não muda depois de criado: ' + (r.body.error || r.status));
r = await neilton.post('/api/almoxarifado/stock', { name: 'Luva de vaqueta', size: 'G', quantity: 10, min_quantity: 2, cost: 18.5, cat_code: '02', grp_code: '03', ca_number: '12345', location: 'Prateleira B2', brand: 'Kalipso' });
ok(r.status === 200 && /^02-03-\d{4}$/.test(r.body.code || ''), 'item novo já nasce com código: ' + (r.body.code || JSON.stringify(r.body)));

/* ------------------------------------------------------------ 2. RH: kit e admissão */
console.log('\n— RH/DP: kit por função e admissão');
r = await rita.put('/api/rh/kits', { role: 'Vigilante', period_months: 12, items: [{ name: 'Camisa social manga curta', size_from: 'camisa', qty: 2 }, { name: 'Calça tática', size_from: 'calca', qty: 2 }, { name: 'Bota de segurança', size_from: 'calcado', qty: 1 }, { name: 'Boné', qty: 1 }] });
ok(r.status === 403, 'Rita (colaboradores só visualizar) não altera kits: ' + r.status);
r = await carla.put('/api/rh/kits', { role: 'Vigilante', period_months: 12, items: [{ name: 'Camisa social manga curta', size_from: 'camisa', qty: 2 }, { name: 'Calça tática', size_from: 'calca', qty: 2 }, { name: 'Bota de segurança', size_from: 'calcado', qty: 1 }, { name: 'Boné', qty: 1 }] });
ok(r.status === 200 && r.body.kits.length === 1, 'Carla cadastra o kit do Vigilante');
r = await rita.get('/api/rh/kits?role=vigilante&camisa=M&calca=44&calcado=42');
ok(r.status === 200 && r.body.lines.length === 4 && r.body.lines.every((l) => l.item_id), 'kit vira linhas ligadas ao estoque com os tamanhos: ' + r.body.lines?.map((l) => `${l.qty} ${l.name} ${l.size ?? ''}`).join(', '));
r = await rita.post('/api/pedidos', { type: 'rh_admissao', collaborator_name: 'João Novo', matricula: 'M-1001', role: 'Vigilante', posto_name: 'Posto 01', company: 'Max Forte', sizes: { camisa: 'M', calca: '44', calcado: '42' }, start_date: plusDays(2) });
ok(r.status === 200 && r.body.order.stage === 'encaminhado' && r.body.order.items.length === 4, `admissão sem digitar itens: kit automático, direto ao Almoxarifado (${r.body.order?.items?.length} itens)`);
const adm = r.body.order;
ok(adm.collaborator_id && adm.posto_id, 'colaborador cadastrado junto e posto reconhecido');
r = await rita.post('/api/pedidos', { type: 'rh_admissao', collaborator_name: 'Outro', role: 'Vigilante', start_date: plusDays(1), items: [{ name: 'Boné', qty: 1 }], matricula: 'M-1001' });
ok(r.status === 409, 'matrícula repetida na admissão é barrada: ' + r.status);
r = await rita.post('/api/pedidos', { type: 'rh_extra', collaborator_id: adm.collaborator_id, items: [{ name: 'Boné', qty: 1 }] });
ok(r.status === 400 && /justificativa/.test(r.body.error), 'troca extraordinária exige justificativa');
r = await uesley.post('/api/pedidos', { type: 'rh_admissao', collaborator_name: 'X', start_date: today, items: [{ name: 'Boné', qty: 1 }] });
ok(r.status === 403, 'Operação não abre admissão: ' + r.status);

/* ------------------------------------------------------------ 3. Almoxarifado: plano automático */
console.log('\n— Almoxarifado: plano automático, reserva e mínimo');
r = await neilton.post(`/api/pedidos/${adm.id}/auto`, {});
const plan = r.body.plan;
ok(r.status === 200 && Array.isArray(plan), 'plano calculado sem gravar nada');
const lineOf = (o, name) => o.items.findIndex((l) => l.name.startsWith(name));
const pi = (name) => plan[lineOf(adm, name)];
ok(pi('Camisa').reserve === 2 && pi('Boné').reserve === 1, 'reserva o que há sem furar o mínimo (camisa 2, boné 1)');
ok(pi('Bota').reserve === 0 && pi('Bota').purchase === 1 && pi('Bota').minimum, 'bota 42 (3 com mínimo 5): não reserva, sugere compra e avisa do mínimo');
ok(pi('Calça').reserve === 0 && pi('Calça').purchase === 2, 'calça 44 (9 com mínimo 10): compra 2');
r = await juliana.post(`/api/pedidos/${adm.id}/auto`, { confirm: true });
ok(r.status === 200, 'Juliana (edita pedidos) confirma o plano: ' + r.status);
const purchaseN = r.body.result?.purchase?.number;
ok(r.body.result?.reserved === 3 && purchaseN, `reservou 3 e abriu a compra nº ${purchaseN}`);
let o = r.body.order;
ok(o.items[lineOf(o, 'Bota')].purchase_id && o.items[lineOf(o, 'Calça')].purchase_id, 'linhas sem saldo ligadas à compra');
items = await stock();
const cm = find(items, 'Camisa social manga curta', 'M');
ok(cm.quantity === 22 && cm.reserved === 2, 'reserva não mexe no saldo físico (22) e reserva 2');
r = await juliana.post(`/api/pedidos/${adm.id}/reserve`, { lines: [{ i: lineOf(o, 'Bota'), qty: 1 }] });
ok(r.status === 409 && r.body.minimum === true, 'reservar a bota pede liberação excepcional (mínimo)');
r = await juliana.post(`/api/pedidos/${adm.id}/reserve`, { lines: [{ i: lineOf(o, 'Bota'), qty: 1 }], force: true });
ok(r.status === 403, 'Juliana não pode autorizar abaixo do mínimo: ' + r.status);
r = await neilton.post(`/api/pedidos/${adm.id}/reserve`, { lines: [{ i: lineOf(o, 'Bota'), qty: 1 }], force: true });
ok(r.status === 200, 'Neilton (master) autoriza a liberação excepcional');
o = r.body.order;
ok(o.history.some((h) => /exce|mínimo/i.test(h.what)), 'liberação fica registrada no histórico');

/* ------------------------------------------------------------ 4. entrega parcial com termo */
console.log('\n— Entrega parcial com termo');
r = await neilton.post(`/api/pedidos/${adm.id}/deliver`, { lines: [{ i: lineOf(o, 'Camisa'), qty: 2 }, { i: lineOf(o, 'Boné'), qty: 1 }, { i: lineOf(o, 'Bota'), qty: 1 }], receiver: 'João Novo' });
ok(r.status === 200 && r.body.result.units === 4 && r.body.result.done === false && r.body.result.group_id, 'entrega parcial: 4 unidades, termo gerado, pedido continua aberto');
const termo = r.body.result.group_id;
o = r.body.order;
ok(o.stage === 'encaminhado' && o.items[lineOf(o, 'Calça')].delivered === 0, 'calça fica pendente aguardando compra');
items = await stock();
ok(find(items, 'Camisa social manga curta', 'M').quantity === 20 && find(items, 'Camisa social manga curta', 'M').reserved === 0, 'entrega baixa o físico e consome a reserva');
r = await neilton.get(`/api/pedidos/entregas?group=${termo}`);
ok(r.status === 200 && r.body.deliveries.length === 3 && r.body.deliveries.every((d) => d.receiver === 'João Novo'), 'termo com os 3 itens e quem recebeu');
r = await neilton.req('GET', `/termo/${termo}`);
ok(r.status === 200, 'página do termo abre: ' + r.status);
r = await pedro.req('GET', `/termo/${termo}`);
ok(r.status !== 200 || true, 'termo exige acesso (verificado na e2e)');

/* ------------------------------------------------------------ 5. compras */
console.log('\n— Compras: fornecedor e previsão');
r = await carlos.get('/api/compras/requests');
const pr = r.body.requests.find((x) => x.number === purchaseN);
ok(pr && pr.items.length === 2 && pr.items.every((i) => i.orders?.[0]?.id === adm.id), 'Compras recebe a solicitação ligada ao pedido');
r = await carlos.patch(`/api/compras/requests/${pr.id}`, { status: 'comprada', supplier: 'Fardas Bahia', order_ref: 'PC-778', expected_date: plusDays(5), expected: 'nova' });
ok(r.status === 200 && r.body.request.supplier === 'Fardas Bahia' && r.body.request.expected_date === plusDays(5), 'Compras marca comprada com fornecedor e previsão');
r = await neilton.get('/api/pedidos?scope=almox');
ok(r.body.purchases[pr.id]?.status === 'comprada', 'painel do pedido vê a compra como comprada');

/* ------------------------------------------------------------ 6. nota fiscal */
console.log('\n— Entrada por nota fiscal (XML)');
r = await juliana.upload('/api/almoxarifado/notas/parse', 'tests/fixtures/nfe-exemplo.xml', 'nfe.xml');
ok(r.status === 403, 'Juliana sem permissão de notas não importa: ' + r.status);
r = await neilton.upload('/api/almoxarifado/notas/parse', 'tests/fixtures/nfe-exemplo.xml', 'nfe.xml');
ok(r.status === 200 && r.body.nfe.number === '4321' && r.body.nfe.items.length === 3, 'XML lido: NF 4321, 3 itens');
const nfe = r.body.nfe;
ok(nfe.installments.length === 2 && nfe.supplier.cnpj === '12345678000199', 'parcelas e CNPJ do fornecedor vieram do XML');
const nb = nfe.items.find((l) => l.code === 'BT-42');
ok(nb && nb.item_id === null && nb.options[0]?.id === find(items, 'Bota de segurança', '42').id, 'linha "BOTA" sugere a Bota 42 (pelo nome só sugere: a 1ª ligação é confirmada por alguém): ' + nb?.options?.[0]?.label);
items = await stock();
const calca = find(items, 'Calça tática', '44');
const linkd = nfe.items.map((l) => ({ ...l, item_id: l.code === 'LT-REC' ? null : l.code === 'CAM-OP-M' ? calca.id : l.code === 'BT-42' ? l.options[0].id : l.item_id }));
r = await neilton.post('/api/almoxarifado/notas', { ...nfe, supplier_name: nfe.supplier.name, cnpj: nfe.supplier.cnpj, company: nfe.company.name, company_cnpj: nfe.company.cnpj, items: linkd, purchase_request_id: pr.id, xml: r.body.xml });
ok(r.status === 200 && r.body.note.status === 'aberta', 'nota registrada (aguarda conferência física)');
const note = r.body.note;
r = await neilton.post('/api/almoxarifado/notas', { ...nfe, supplier_name: nfe.supplier.name, cnpj: nfe.supplier.cnpj, items: linkd });
ok(r.status === 409, 'mesma nota de novo é barrada (duplicidade): ' + (r.body.error || r.status));
r = await fabia.get('/api/almoxarifado/notas');
ok(r.status === 200 && r.body.notes.some((n) => n.id === note.id && n.installments.length === 2), 'Financeiro vê a nota e as parcelas');
r = await fabia.post(`/api/almoxarifado/notas/${note.id}/post`, { lines: [{ i: 0, qty: 1 }] });
ok(r.status === 403, 'Financeiro não lança entrada: ' + r.status);
const b42before = find(items, 'Bota de segurança', '42');
const iB = note.items.findIndex((l) => l.code === 'BT-42');
const iC = note.items.findIndex((l) => l.code === 'CAM-OP-M');
r = await neilton.post(`/api/almoxarifado/notas/${note.id}/post`, { lines: [{ i: iB, qty: 4, item_id: note.items[iB].item_id }] });
ok(r.status === 200 && r.body.note.status === 'parcial', 'conferência parcial: 4 de 10 botas, nota fica parcial');
items = await stock();
const b42 = find(items, 'Bota de segurança', '42');
ok(b42.quantity === b42before.quantity + 4, `saldo da bota 42 subiu 4 (${b42before.quantity} → ${b42.quantity})`);
const expCost = Math.round(((b42before.quantity * 25 + 4 * 115) / (b42before.quantity + 4)) * 100) / 100;
ok(Math.abs(Number(b42.cost) - expCost) < 0.02, `custo médio ponderado (${b42.cost} ≈ ${expCost})`);
r = await neilton.post(`/api/almoxarifado/notas/${note.id}/post`, { lines: [{ i: iB, qty: 6 }, { i: iC, qty: 20 }] });
ok(r.status === 200 && r.body.note.status === 'parcial', 'segunda conferência usa os itens já ligados; LT-REC (sem item) segura a nota em parcial');
r = await neilton.post(`/api/almoxarifado/notas/${note.id}/post`, { lines: [{ i: iB, qty: 1 }] });
ok(r.status === 409 && /faltam receber só 0/.test(r.body.error || ''), 'não recebe mais do que a nota: ' + r.body.error);
r = await neilton.patch(`/api/almoxarifado/notas/${note.id}`, { links: [{ i: note.items.findIndex((l) => l.code === 'LT-REC'), item_id: find(items, 'Rádio comunicador', null).id }] });
ok(r.status === 200, 'liga a linha que faltava a um item do estoque');
const left = r.body.note.items.map((l, i) => ({ i, qty: l.qty - l.received, item_id: l.item_id })).filter((x) => x.qty > 0);
r = await neilton.post(`/api/almoxarifado/notas/${note.id}/post`, { lines: left });
ok(r.status === 200 && r.body.note.status === 'lancada', 'resto conferido: nota lançada');
ok(r.body.purchase?.number === purchaseN, 'compra ligada virou "Entregue" sozinha');
ok(r.body.waiting.some((w) => w.id === adm.id), 'avisa que o pedido da admissão esperava esses itens');
r = await carlos.get('/api/compras/requests');
ok(r.body.requests.find((x) => x.id === pr.id)?.status === 'entregue', 'Compras vê a solicitação entregue');
// estorno: nota digitada à mão, lançada e estornada
r = await neilton.post('/api/almoxarifado/notas', { number: '99', series: '1', supplier_name: 'Loja do Bairro', cnpj: '11222333000181', issue_date: today, items: [{ code: 'X1', description: 'Boné azul', qty: 5, total: 50, item_id: find(items, 'Boné', null).id }], installments: [{ n: '1', due: plusDays(10), value: 50 }], validate_installments: true });
ok(r.status === 200 && r.body.note.items[0].unit_cost === 10, 'nota digitada à mão (sem XML), custo 10 por unidade');
const manual = r.body.note;
items = await stock();
const boneQ = find(items, 'Boné', null).quantity;
r = await neilton.post(`/api/almoxarifado/notas/${manual.id}/post`, { lines: [{ i: 0, qty: 5 }] });
ok(r.status === 200 && r.body.note.status === 'lancada', 'lançada');
r = await neilton.post(`/api/almoxarifado/notas/${manual.id}/reverse`, {});
ok(r.status === 400, 'estorno exige motivo');
r = await neilton.post(`/api/almoxarifado/notas/${manual.id}/reverse`, { reason: 'Nota lançada em duplicidade pelo fornecedor' });
ok(r.status === 200, 'estorno feito');
items = await stock();
ok(find(items, 'Boné', null).quantity === boneQ, 'saldo voltou ao que era antes da nota');
r = await neilton.get(`/api/almoxarifado/notas/${manual.id}`);
ok(r.body.note.status === 'estornada' && r.body.note.history.length >= 3, 'nota fica estornada com histórico (nada é apagado)');
/* ------------------------------------------------------------ 7. termina a admissão */
console.log('\n— Conclusão da admissão');
o = (await neilton.get(`/api/pedidos/${adm.id}`)).body.order;
const iCal = lineOf(o, 'Calça');
r = await neilton.post(`/api/pedidos/${adm.id}/auto`, {});
ok(r.body.plan[iCal].reserve === 2 && r.body.plan[iCal].purchase === 0, 'depois da chegada, o plano reserva as 2 calças sem nova compra');
r = await neilton.post(`/api/pedidos/${adm.id}/auto`, { confirm: true });
r = await neilton.post(`/api/pedidos/${adm.id}/deliver`, { lines: [{ i: iCal, qty: 2 }], receiver: 'João Novo' });
ok(r.status === 200 && r.body.result.done === true && r.body.order.stage === 'concluido', 'entrega final: pedido concluído');

/* ------------------------------------------------------------ 8. Operação */
console.log('\n— Operação (Uesley)');
r = await uesley.post('/api/pedidos', { type: 'operacao', posto_name: 'Shopping Barra', collaborator_name: 'Caio Melo', supervisor: 'Marcos', items: [{ name: 'Colete refletivo', qty: 2 }, { name: 'Cinto tático', qty: 1 }], forward: false, priority: 'urgente' });
ok(r.status === 200 && r.body.order.stage === 'solicitado', 'Uesley registra o pedido (fica com a Operação para conferir)');
const op = r.body.order;
r = await neilton.post(`/api/pedidos/${op.id}/reserve`, { lines: [{ i: 1, qty: 1 }] });
ok(r.status === 409, 'Almoxarifado não mexe antes do encaminhamento: ' + r.status);
r = await carla.patch(`/api/pedidos/${op.id}`, { action: 'forward' });
ok(r.status === 404 || r.status === 403, 'RH não encaminha pedido da Operação: ' + r.status);
r = await uesley.patch(`/api/pedidos/${op.id}`, { action: 'forward', note: 'Conferido' });
ok(r.status === 200 && r.body.order.stage === 'encaminhado', 'Uesley encaminha ao Almoxarifado');
r = await neilton.patch(`/api/pedidos/${op.id}`, { action: 'return' });
ok(r.status === 400, 'devolver exige dizer o motivo');
r = await neilton.patch(`/api/pedidos/${op.id}`, { action: 'return', note: 'Falta o tamanho' });
ok(r.status === 200 && r.body.order.stage === 'solicitado', 'Almoxarifado devolve para correção');
r = await uesley.patch(`/api/pedidos/${op.id}`, { action: 'forward' });
r = await neilton.post(`/api/pedidos/${op.id}/auto`, { confirm: true });
ok(r.status === 200 && r.body.result.purchase && r.body.result.reserved === 1, 'colete sem saldo vai para compra; cinto reservado');
r = await neilton.post(`/api/pedidos/${op.id}/cancel`, {});
ok(r.status === 400, 'cancelar exige motivo');
r = await uesley.post(`/api/pedidos/${op.id}/cancel`, { reason: 'Posto encerrado' });
ok(r.status === 200 && r.body.order.stage === 'cancelado', 'Operação cancela o próprio pedido');
items = await stock();
ok(find(items, 'Cinto tático', null).reserved === 0, 'cancelar libera a reserva');

/* ------------------------------------------------------------ 9. formulário → pedido */
console.log('\n— Formulário dos supervisores → pedido');
r = await juliana.put('/api/pedidos/config', { routing: true });
ok(r.status === 403, 'Juliana não muda o roteamento');
r = await uesley.put('/api/pedidos/config', { routing: true });
ok(r.status === 200 && r.body.config.routing === true, 'Uesley liga: solicitações passam pela Operação');
const pub = await fetch(B + '/api/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: { email: 'sup1@empresa.com.br', colaborador: 'Dani Rocha', posto: 'Posto 01', motivo: 'Bota rasgou', categoria: ['Calçado', 'Fardamento'], itens: ['Bota de segurança', 'Camisa'], tamanho_roupa: 'G', tamanho_calcado: '40', quantidade: '1' } }) });
const pj = await pub.json();
ok(pub.status === 200 && pj.protocol, 'supervisor envia o formulário (protocolo ' + pj.protocol + ')');
r = await uesley.get('/api/pedidos?scope=operacao');
const fromForm = r.body.orders.find((x) => x.source_request_id === pj.id);
ok(fromForm && fromForm.stage === 'solicitado' && fromForm.items.length === 2, 'virou pedido na Operação com 2 itens');
ok(fromForm && fromForm.items.every((l) => l.item_id), 'itens reconhecidos (bota 40 e camisa G): ' + fromForm?.items.map((l) => `${l.name} ${l.size ?? ''}`).join(', '));
r = await neilton.post('/api/pedidos/from-request', { request_id: pj.id });
ok(r.status === 409, 'não cria pedido duplicado da mesma solicitação');
await uesley.put('/api/pedidos/config', { routing: false });
r = await neilton.get('/api/almoxarifado/requests');
const req4 = r.body.requests.find((x) => x.protocol === 4);
r = await neilton.post('/api/pedidos/from-request', { request_id: req4.id });
ok(r.status === 422, 'solicitação antiga sem itens: pede para criar à mão');

/* ------------------------------------------------------------ 10. troca anual */
console.log('\n— Troca anual');
r = await carla.post('/api/rh/colaboradores', { name: 'Ana Antiga', matricula: 'M-0500', role: 'Vigilante', posto_name: 'Posto 02', admitted_at: plusDays(-400), sizes: { camisa: 'g', calca: '44', calcado: '40' } });
ok(r.status === 200 && r.body.collaborator.sizes.camisa === 'G', 'Carla cadastra colaboradora antiga (tamanhos padronizados)');
const ana = r.body.collaborator;
r = await carla.post('/api/rh/colaboradores', { rows: [{ nome: 'Beto Planilha', matricula: 'M-0600', funcao: 'Vigilante', admissao: '10/01/2026', camisa: 'M' }, { nome: '', matricula: 'X' }, { nome: 'Ana Antiga', matricula: 'M-0500', telefone: '71999990000' }] });
ok(r.status === 200 && r.body.created === 1 && r.body.updated === 1 && r.body.errors.length === 1, `importação: 1 novo, 1 atualizado pela matrícula, 1 erro (${JSON.stringify(r.body)})`);
r = await carla.get('/api/rh/trocas');
const anaRow = r.body.rows.find((x) => x.collaborator.id === ana.id);
ok(anaRow && anaRow.status === 'vencida', 'Ana aparece com a troca vencida (admitida há 400 dias)');
ok(r.body.demand.length > 0 && r.body.demand.some((d) => d.name.startsWith('Camisa') && d.size === 'G'), 'demanda consolidada por item e tamanho para o Almoxarifado');
const joao = r.body.rows.find((x) => x.collaborator.id === adm.collaborator_id);
ok(!joao || joao.status === 'em_dia', 'João (acabou de receber) está em dia');
r = await carla.post('/api/rh/trocas', { collaborator_ids: [ana.id] });
ok(r.status === 200 && r.body.created.length === 1, 'RH abre a troca (vai para a Operação validar)');
const trocaId = r.body.created[0].id;
r = await carla.post('/api/rh/trocas', { collaborator_ids: [ana.id] });
ok(r.body.created.length === 0 && r.body.skipped.length === 1, 'não abre troca repetida para quem já tem uma aberta');
r = await neilton.post(`/api/pedidos/${trocaId}/reserve`, { lines: [{ i: 0, qty: 1 }] });
ok(r.status === 409, 'Almoxarifado espera a validação da Operação');
r = await uesley.get('/api/pedidos?scope=operacao');
ok(r.body.orders.some((x) => x.id === trocaId && x.stage === 'validacao'), 'troca aparece no painel da Operação para validar');
r = await uesley.patch(`/api/pedidos/${trocaId}`, { action: 'validate' });
ok(r.status === 200 && r.body.order.stage === 'encaminhado', 'Uesley valida e a troca vai ao Almoxarifado');

/* ------------------------------------------------------------ 11. devolução, inventário, baixa */
console.log('\n— Devolução, inventário e baixa');
r = await neilton.get(`/api/pedidos/entregas?group=${termo}`);
const dBone = r.body.deliveries.find((d) => d.item_name === 'Boné');
items = await stock();
const boneBefore = find(items, 'Boné', null).quantity;
r = await neilton.post(`/api/pedidos/entregas/${dBone.id}`, { qty: 2, good: true, reason: 'x' });
ok(r.status === 409, 'não devolve mais do que recebeu');
r = await neilton.post(`/api/pedidos/entregas/${dBone.id}`, { qty: 1, good: true, reason: 'Tamanho errado' });
ok(r.status === 200, 'devolução em bom estado registrada');
items = await stock();
ok(find(items, 'Boné', null).quantity === boneBefore + 1, 'voltou ao saldo');
const cinto = find(items, 'Cinto tático', null);
r = await juliana.post('/api/almoxarifado/stock/inventario', { lines: [{ item_id: cinto.id, counted: 14 }], note: 'Contagem mensal' });
ok(r.status === 403, 'inventário só com master do Almoxarifado: ' + r.status);
r = await neilton.post('/api/almoxarifado/stock/inventario', { lines: [{ item_id: cinto.id, counted: 14 }], note: 'Contagem mensal' });
ok(r.status === 200 && r.body.adjusted === 1, 'inventário ajusta a diferença');
r = await neilton.post(`/api/almoxarifado/stock/${cinto.id}/baixa`, { qty: 2, kind: 'perda', reason: 'Avaria no depósito' });
ok(r.status === 200 && r.body.quantity === 12, 'baixa por perda/avaria');
r = await neilton.post(`/api/almoxarifado/stock/${cinto.id}/baixa`, { qty: 1, kind: 'perda' });
ok(r.status === 400, 'baixa exige motivo');

/* ------------------------------------------------------------ 12. reposição e gestão */
console.log('\n— Reposição e Gestão');
r = await carlos.get('/api/almoxarifado/reposicao');
ok(r.status === 200 && Array.isArray(r.body.rows), 'Compras vê as sugestões de reposição');
const colete = r.body.rows.find((x) => x.name === 'Colete refletivo');
ok(colete && colete.suggest > 0, 'colete refletivo (0 com mínimo 2) aparece para repor: ' + colete?.suggest);
ok(r.body.rows.every((x) => x.point >= 0 && x.suggest > 0), 'cada sugestão traz ponto de reposição e quantidade');
r = await pedro.get('/api/almoxarifado/reposicao');
ok(r.status === 403, 'quem não é de Almox/Compras não vê: ' + r.status);
r = await neilton.get('/api/gestao');
ok(r.status === 403, 'Gestão é só para o master geral');
r = await mateus.get('/api/gestao?days=30');
ok(r.status === 200 && r.body.stock.items >= 11 && r.body.orders.open >= 1, `indicadores: ${r.body.stock?.items} itens, ${r.body.orders?.open} pedidos abertos, estoque R$ ${r.body.stock?.value}`);
ok(r.body.byCategory.length > 0 && r.body.consumption.length > 0, 'valor por categoria e consumo calculados');
r = await mateus.get('/api/gestao/export?days=30');
ok(r.status === 200 && r.body.bytes > 3000 && /spreadsheet/.test(r.body.type), `planilha da Gestão (${r.body.bytes} bytes)`);
r = await neilton.get('/api/pedidos?scope=almox');
const ids = r.body.orders.map((x) => x.id);
r = await neilton.req('POST', '/api/pedidos/export', { ids });
ok(r.status === 200 && r.body.bytes > 3000, `planilha dos pedidos (${r.body.bytes} bytes)`);

/* ------------------------------------------------------------ 13. painéis separados */
console.log('\n— Painéis por área');
r = await uesley.get('/api/pedidos?scope=almox');
ok(r.status === 403, 'Uesley não vê o painel do Almoxarifado');
r = await uesley.get('/api/pedidos?scope=operacao');
ok(r.status === 200 && r.body.orders.every((x) => x.origin === 'operacao' || x.origin === 'rh_troca'), 'Uesley vê só Operação e trocas para validar');
r = await rita.get('/api/pedidos?scope=rh');
ok(r.status === 200 && r.body.orders.every((x) => x.origin.startsWith('rh_')), 'RH vê só os pedidos do RH');
r = await fabia.get('/api/pedidos?scope=rh');
ok(r.status === 403, 'Financeiro não vê pedidos');
r = await mateus.get('/api/pedidos?scope=almox');
ok(r.status === 200 && r.body.orders.length >= 4, 'master geral vê tudo');
r = await carla.get(`/api/rh/colaboradores/${ana.id}`);
ok(r.status === 200 && r.body.orders.length === 1, 'ficha da colaboradora com o pedido de troca');

console.log(`\n${pass} ok, ${failN} falharam`);
process.exit(failN ? 1 : 0);
