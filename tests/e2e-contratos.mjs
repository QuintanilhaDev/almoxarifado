/**
 * Pedidos da gerência (04/11/2026): contratos no RH (portaria social, não importar), cadastro de postos
 * no RH, kit social pelo contrato, EPI extra com vencimento individual, estoque de devolução Fard/EPI
 * (higienização, entrada no estoque, descarte) e só o Almoxarifado pede compras.
 * Nomes inventados: nada de dado real no repositório.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const ExcelJS = require('exceljs');
const B = 'http://localhost:3100';
const SHOTS = process.env.SHOTS || '/tmp/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const problems = [];
const ok = (cond, msg) => { if (!cond) { problems.push(msg); console.log('  ✗', msg); } else console.log('  ✓', msg); };
const hoje = new Date(Date.now() - 3 * 3_600_000);
const iso = (d) => d.toISOString().slice(0, 10);
const diasAtras = (n) => new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() - n));

const browser = await chromium.launch();
async function session(user) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'pt-BR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { problems.push(`pageerror (${user}): ${e.message}`); console.log('  ! pageerror', e.message); });
  page.on('dialog', (d) => d.accept());
  await page.goto(B + '/');
  await page.fill('#user', user);
  await page.fill('#pass', '123456');
  await page.click('button[type=submit]');
  await page.waitForURL((u) => u.pathname.length > 1, { timeout: 30000 });
  await page.waitForTimeout(800);
  return page;
}
const api = (p, path, method = 'GET', body) => p.evaluate(async ([u, m, b]) => { const r = await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; }, [path, method, body]);

try {
  console.log('\n[1] RH: colaboradores de três clientes');
  const rh = await session('carla');
  let r = await api(rh, '/api/rh/colaboradores', 'POST', { rows: [
    { name: 'PEDRO TESTE PORTARIA', matricula: '8801', role: 'AGENTE DE PORTARIA', client: 'CONDOMINIO SOCIAL TESTE', company: 'MAX SERVIÇOS', admitted_at: '2025-01-01', sizes: { camisa: 'G', calca: '42', calcado: '41' } },
    { name: 'PAULA TESTE PORTARIA', matricula: '8802', role: 'AGENTE DE PORTARIA', client: 'INDUSTRIA OPERACIONAL TESTE', company: 'MAX SERVIÇOS', admitted_at: '2025-01-01', sizes: { camisa: 'M', calca: '38', calcado: '36' } },
    { name: 'TIAGO TESTE TRIBUNAL', matricula: '8803', role: 'AUXILIAR ADMINISTRATIVO', client: 'TRIBUNAL TESTE ELEITORAL', company: 'MAX SERVIÇOS' },
  ] });
  ok(r.status === 200 && r.body.created === 3, 'três colaboradores importados');

  console.log('\n[2] RH › Contratos: cria os contratos dos clientes, portaria social e "não importar"');
  await rh.goto(B + '/setor/rh#contratos');
  await rh.waitForSelector('text=Clientes sem contrato', { timeout: 20000 });
  await rh.click('.filter-seg button:has-text("Clientes sem contrato")');
  for (const c of ['CONDOMINIO SOCIAL TESTE', 'INDUSTRIA OPERACIONAL TESTE', 'TRIBUNAL TESTE ELEITORAL']) {
    await rh.click(`.kv-row:has-text("${c}") >> text=Criar contrato`);
    await rh.waitForSelector(`.kv-row:has-text("${c}")`, { state: 'detached', timeout: 10000 });
  }
  ok(true, 'contratos criados a partir dos clientes do cadastro');
  await rh.click('.filter-seg button:has-text("Contratos")');
  await rh.click('tr:has-text("CONDOMINIO SOCIAL TESTE")');
  await rh.waitForSelector('#ct-n');
  await rh.check('text=Portaria social: o Agente de Portaria deste contrato recebe o kit social');
  await rh.fill('#ct-np', 'PORTARIA TORRE A TESTE');
  await rh.click('#ct-np + button');
  await rh.waitForSelector('.kv-row:has-text("PORTARIA TORRE A TESTE")', { timeout: 10000 });
  await rh.click('.modal .btn-primary:has-text("Salvar")');
  await rh.waitForSelector('tr:has-text("CONDOMINIO SOCIAL TESTE") .pbadge:has-text("Portaria social")', { timeout: 10000 });
  ok(/1/.test(await rh.locator('tr:has-text("CONDOMINIO SOCIAL TESTE") td.n').nth(1).innerText()), 'posto novo cadastrado no RH, já ligado ao contrato');
  await rh.click('tr:has-text("TRIBUNAL TESTE ELEITORAL")');
  await rh.waitForSelector('#ct-n');
  await rh.check('text=Não importar: a planilha de colaboradores ignora quem é deste contrato');
  await rh.click('.modal .btn-primary:has-text("Salvar")');
  await rh.waitForSelector('tr:has-text("TRIBUNAL TESTE ELEITORAL") .pbadge:has-text("Não importar")', { timeout: 10000 });
  await rh.screenshot({ path: SHOTS + '/ct-contratos.png', fullPage: true });
  r = await api(rh, '/api/rh/colaboradores', 'POST', { rows: [{ name: 'NOVO TESTE TRIBUNAL', matricula: '8804', role: 'AUXILIAR ADMINISTRATIVO', client: 'Tribunal teste eleitoral' }] });
  ok(r.status === 200 && r.body.created === 0 && r.body.ignorados === 1, 'importação ignora quem é do contrato marcado "não importar"');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Colaboradores');
  ws.addRow(['Matrícula', 'Nome', 'Função', 'Cliente']);
  ws.addRow(['8805', 'OUTRO TESTE TRIBUNAL', 'AUXILIAR ADMINISTRATIVO', 'TRIBUNAL TESTE ELEITORAL']);
  ws.addRow(['8806', 'NOVA TESTE INDUSTRIA', 'AGENTE DE PORTARIA', 'INDUSTRIA OPERACIONAL TESTE']);
  const fpath = SHOTS + '/colab-tre.xlsx';
  await wb.xlsx.writeFile(fpath);
  const prev = await rh.evaluate(async (b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const fd = new FormData(); fd.append('file', new File([bin], 'colab.xlsx')); const res = await fetch('/api/rh/colaboradores/import', { method: 'POST', body: fd }); return res.json(); }, fs.readFileSync(fpath).toString('base64'));
  ok(prev.rows?.length === 1 && prev.rows[0].name === 'NOVA TESTE INDUSTRIA' && prev.warnings.some((w) => /contrato marcado para não importar/.test(w)), 'a conferência da planilha já tira o contrato bloqueado e avisa');

  console.log('\n[3] Kit social pelo contrato');
  await api(rh, '/api/rh/kits', 'PUT', { role: 'AGENTE DE PORTARIA', period_months: 12, items: [{ name: 'Camisa operacional MC', size_from: 'camisa', qty: 1 }, { name: 'Botina com biqueira', size_from: 'calcado', qty: 1 }] });
  r = await api(rh, '/api/rh/kits', 'PUT', { role: 'AGENTE DE PORTARIA SOCIAL', period_months: 12, items: [{ name: 'Camisa social', size_from: 'camisa', qty: 2 }, { name: 'Gravata', size_from: null, qty: 1 }] });
  ok(r.status === 200, 'kits operacional e social cadastrados');
  const cs = (await api(rh, '/api/rh/colaboradores')).body.collaborators;
  const pedro = cs.find((c) => c.name === 'PEDRO TESTE PORTARIA');
  const paula = cs.find((c) => c.name === 'PAULA TESTE PORTARIA');
  const fp = (await api(rh, `/api/rh/colaboradores/${pedro.id}/controle`)).body.colab;
  const fq = (await api(rh, `/api/rh/colaboradores/${paula.id}/controle`)).body.colab;
  ok(fp.kit === 'AGENTE DE PORTARIA SOCIAL' && fp.pecas.some((p) => p.item === 'Gravata') && fp.contrato === 'CONDOMINIO SOCIAL TESTE', 'Pedro (portaria social) recebe o kit social');
  ok(fq.kit === 'AGENTE DE PORTARIA' && fq.pecas.some((p) => p.item === 'Botina com biqueira'), 'Paula (contrato operacional) recebe o kit operacional');

  console.log('\n[4] EPI extra (avulso) com vencimento individual');
  await rh.goto(B + '/setor/rh#colaboradores');
  await rh.waitForSelector('text=Kits', { timeout: 20000 });
  await rh.click('.filter-seg button:has-text("Kits")');
  await rh.waitForSelector('[data-max="avulsos-editar"]', { timeout: 15000 });
  await rh.click('[data-max="avulsos-editar"]');
  await rh.click('text=Adicionar item');
  await rh.fill('input[aria-label="EPI extra 1"]', 'Protetor auricular');
  await rh.fill('input[aria-label="Vencimento do item 1 (meses)"]', '3');
  await rh.click('[data-max="epi-avulsos"] .btn-primary:has-text("Salvar")');
  await rh.waitForSelector('[data-max="epi-avulsos"] .kv-row:has-text("vence em 3 meses")', { timeout: 10000 });
  ok(true, 'EPI extra cadastrado na tela de kits (3 meses)');
  // entrega pela planilha de controle (Gestão): protetor entregue há 100 dias → vencido
  const m = await session('mateus');
  const fc = new ExcelJS.Workbook();
  const w2 = fc.addWorksheet('Controle');
  w2.addRow(['Empresa', 'Funcionário', 'Função', 'Posto', 'Data de Entrega', 'ITENS A', 'QTD A']);
  w2.addRow(['MAX SERVIÇOS', 'PAULA TESTE PORTARIA', 'AGENTE DE PORTARIA', 'INDUSTRIA', diasAtras(100), 'PROTETOR AURICULAR', 1]);
  const fcf = SHOTS + '/fc-avulso.xlsx';
  await fc.xlsx.writeFile(fcf);
  await m.goto(B + '/hub#gestao');
  await m.waitForSelector('[data-max="gestao-fardamento"]', { timeout: 20000 });
  await m.click('[data-max="gestao-fardamento"]');
  await m.setInputFiles('input[aria-label="Planilha de controle de fardamento"]', fcf);
  await m.waitForFunction(() => /fc-avulso/.test(document.querySelector('.fd-meta')?.textContent ?? ''), null, { timeout: 30000 });
  const fq2 = (await api(rh, `/api/rh/colaboradores/${paula.id}/controle`)).body.colab;
  const pa = fq2.pecas.find((p) => p.avulso);
  ok(pa && pa.item === 'Protetor auricular' && pa.status === 'vencida' && pa.periodo === 3, 'protetor auricular entregue há 100 dias: vencido pelo prazo próprio (3 meses)');
  r = await api(rh, '/api/rh/controle?ind=vencidas');
  ok(r.body.linhas.some((l) => l.name === 'PAULA TESTE PORTARIA' && l.item === 'Protetor auricular' && /avulso/.test(l.obs)), 'EPI extra vencido aparece nas trocas vencidas do Controle');

  console.log('\n[5] Postos: cadastro só no RH; o Almoxarifado mexe no estoque');
  const nei = await session('neilton');
  r = await api(nei, '/api/almoxarifado/postos', 'POST', { name: 'POSTO DO ALMOX TESTE' });
  ok(r.status === 403 && /RH/.test(r.body.error ?? ''), 'Almoxarifado não cadastra posto: ' + (r.body.error ?? r.status));
  await nei.goto(B + '/setor/almoxarifado#postos');
  await nei.reload();
  await nei.waitForSelector('text=O cadastro dos postos', { timeout: 20000 });
  ok((await nei.locator('[data-max="posto-novo"]').count()) === 0, 'o botão "Novo posto" saiu do Almoxarifado');
  r = await api(nei, '/api/almoxarifado/postos');
  ok(r.status === 200 && r.body.postos.some((p) => p.name === 'PORTARIA TORRE A TESTE'), 'Almoxarifado vê o posto cadastrado pelo RH');

  console.log('\n[6] Devolução vai para o estoque de devolução Fard/EPI');
  r = await api(rh, `/api/rh/colaboradores/${pedro.id}/desligamento`, 'POST', { date: iso(diasAtras(1)), reason: 'Pedido de demissão', items: [{ item_name: 'Camisa social', size: 'G', qty_delivered: 2, qty_returned: 2, status: 'devolvido', source: 'manual' }] });
  ok(r.status === 200, 'Pedro desligado, devolveu 2 camisas sociais');
  r = await api(nei, '/api/almoxarifado/devolucoes');
  const lote = r.body.lotes?.find((l) => l.collaborator_name === 'PEDRO TESTE PORTARIA');
  ok(lote && lote.qty === 2 && lote.status === 'aguardando', 'as 2 camisas entram no estoque de devolução, aguardando avaliação');
  await nei.goto(B + '/setor/almoxarifado#devolucoes');
  await nei.reload();
  await nei.waitForSelector('tr:has-text("PEDRO TESTE PORTARIA")', { timeout: 20000 });
  await nei.click('tr:has-text("PEDRO TESTE PORTARIA") [data-max="devol-higienizar"]');
  await nei.waitForSelector('tr:has-text("PEDRO TESTE PORTARIA") .pbadge:has-text("Em higienização")', { timeout: 10000 });
  const itens = (await api(nei, '/api/almoxarifado/stock')).body.items;
  const alvo = itens[0];
  await nei.click('tr:has-text("PEDRO TESTE PORTARIA") [data-max="devol-reaproveitar"]');
  await nei.fill('#av-q', '1');
  await nei.fill('#av-b', alvo.name);
  await nei.locator('.av-list input[type=radio]').first().check();
  const escolhido = await nei.locator('.av-list label').first().innerText();
  await nei.click('.modal .btn-primary:has-text("Dar entrada")');
  await nei.waitForSelector('.modal', { state: 'detached', timeout: 10000 });
  const depois = (await api(nei, '/api/almoxarifado/stock')).body.items;
  const mudou = depois.find((i) => escolhido.includes(i.name) && i.quantity === (itens.find((x) => x.id === i.id)?.quantity ?? -9) + 1);
  ok(Boolean(mudou), 'reaproveitar 1: entrada de 1 no item escolhido do estoque');
  r = await api(nei, '/api/almoxarifado/devolucoes');
  const ls = r.body.lotes.filter((l) => l.collaborator_name === 'PEDRO TESTE PORTARIA');
  ok(ls.length === 2 && ls.some((l) => l.status === 'reaproveitado' && l.qty === 1) && ls.some((l) => l.status === 'higienizacao' && l.qty === 1), 'o lote se divide: 1 reaproveitada, 1 continua em higienização');
  const resto = ls.find((l) => l.status === 'higienizacao');
  r = await api(nei, `/api/almoxarifado/devolucoes?id=${resto.id}`, 'PATCH', { acao: 'descartar' });
  ok(r.status === 400, 'descarte sem motivo é recusado');
  r = await api(nei, `/api/almoxarifado/devolucoes?id=${resto.id}`, 'PATCH', { acao: 'descartar', notes: 'rasgada' });
  ok(r.status === 200, 'a outra camisa é descartada (rasgada)');
  await nei.screenshot({ path: SHOTS + '/ct-devolucoes.png', fullPage: true });
  const devs = (await api(rh, '/api/rh/devolucoes')).body;
  const item = (devs.desligados ?? devs.lista ?? []).flatMap((d) => d.itens ?? []).find((i) => i.item_name === 'Camisa social');
  if (item) {
    r = await api(rh, `/api/rh/devolucoes/${item.id}`, 'PATCH', { status: 'devolvido', qty_returned: 1 });
    ok(r.status === 409, 'RH não muda a quantidade de uma devolução já avaliada pelo Almoxarifado');
  } else ok(false, 'item da devolução não encontrado na lista do RH');

  console.log('\n[7] Só o Almoxarifado pede compras');
  r = await api(rh, '/api/compras/requests', 'POST', { items: [{ name: 'Teste', quantity: 1 }], reason: 'teste' });
  ok(r.status === 403, 'RH não abre solicitação de compra');
  const comp = await session('carlos');
  r = await api(comp, '/api/compras/requests', 'POST', { items: [{ name: 'Teste', quantity: 1 }], reason: 'teste' });
  ok(r.status === 403, 'Compras também não abre (só recebe do Almoxarifado)');
  await comp.context().close();
  await m.context().close();
  await nei.context().close();
  await rh.context().close();
} catch (e) {
  problems.push('exceção: ' + e.message);
  console.log(e);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} PROBLEMA(S)` : '\nTUDO CERTO');
process.exit(problems.length ? 1 : 0);
