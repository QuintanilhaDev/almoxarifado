/**
 * Controle do RH (tela inicial do RH): seis números, relação filtrável e exportável,
 * sem informação separado, troca por peça, ASO/cursos configuráveis e estoque por contrato.
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
const dia = (deltaDias) => new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() + deltaDias));
const iso = (d) => d.toISOString().slice(0, 10);
const meses = (d, m) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, d.getUTCDate()));

/* planilha de controle (Gestão): o que a Ana recebeu, cada peça numa data */
const camisaEm = meses(dia(-30), -12); // troca (12 meses) venceu há 30 dias
const calcaEm = meses(dia(120), -12); // troca em 120 dias
const coturnoEm = meses(dia(-10), -6); // coturno troca a cada 6 meses: venceu há 10 dias
const boneEm = meses(dia(40), -12); // troca em 40 dias: reposição prevista
const fc = new ExcelJS.Workbook();
const ws = fc.addWorksheet('Controle');
ws.addRow(['Empresa', 'Funcionário', 'Função', 'Posto', 'Data de Entrega', 'CAMISA MC', 'QTD MC', 'CALÇA', 'QTD CALÇA', 'CALÇADOS', 'QTD CALÇADOS', 'ITENS A', 'QTD A']);
ws.addRow(['MAX FORTE', 'ANA TESTE CONTROLE', 'VIGILANTE', 'CLIENTE GAMA - PORTARIA', camisaEm, 'M', 1, null, null, null, null, null, null]);
ws.addRow(['MAX FORTE', 'ANA TESTE CONTROLE', 'VIGILANTE', 'CLIENTE GAMA - PORTARIA', calcaEm, null, null, 40, 2, null, null, null, null]);
ws.addRow(['MAX FORTE', 'ANA TESTE CONTROLE', 'VIGILANTE', 'CLIENTE GAMA - PORTARIA', coturnoEm, null, null, null, null, 'COTURNO 38', 1, null, null]);
ws.addRow(['MAX FORTE', 'ANA TESTE CONTROLE', 'VIGILANTE', 'CLIENTE GAMA - PORTARIA', boneEm, null, null, null, null, null, null, 'BONÉ', 1]);
const fcFile = `${SHOTS}/FARDAMENTO_controle_teste.xlsx`;
await fc.xlsx.writeFile(fcFile);

const browser = await chromium.launch();
async function session(user) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'pt-BR', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { problems.push(`pageerror (${user}): ${e.message}`); console.log('  ! pageerror', e.message); });
  await page.goto(B + '/');
  await page.fill('#user', user);
  await page.fill('#pass', '123456');
  await page.click('button[type=submit]');
  await page.waitForURL((u) => u.pathname.length > 1, { timeout: 30000 });
  await page.waitForTimeout(1000);
  return page;
}
const api = (p, path, method = 'GET', body) => p.evaluate(async ([u, m, b]) => { const r = await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; }, [path, method, body]);
const card = async (p, id) => Number(((await p.locator(`[data-max="controle-${id}"] b`).innerText()) || '0').replace(/\D/g, ''));

try {
  console.log('\n[1] Gestão importa a planilha de controle de fardamento');
  const m = await session('mateus');
  await m.goto(B + '/hub#gestao');
  await m.waitForSelector('[data-max="gestao-fardamento"]', { timeout: 20000 });
  await m.click('[data-max="gestao-fardamento"]');
  await m.waitForSelector('input[aria-label="Planilha de controle de fardamento"]', { state: 'attached' });
  await m.setInputFiles('input[aria-label="Planilha de controle de fardamento"]', fcFile);
  await m.waitForFunction(() => /FARDAMENTO_controle_teste/.test(document.querySelector('.fd-meta')?.textContent ?? ''), null, { timeout: 30000 });
  ok(true, 'planilha importada');
  await m.context().close();

  console.log('\n[2] RH: kit com prazo por peça e colaboradores');
  const p = await session('carla');
  let r = await api(p, '/api/rh/kits', 'PUT', { role: 'VIGILANTE', period_months: 12, items: [{ name: 'Camisa', size_from: 'camisa', qty: 2 }, { name: 'Calça', size_from: 'calca', qty: 2 }, { name: 'Coturno', size_from: 'calcado', qty: 1, period_months: 6 }, { name: 'Boné', size_from: null, qty: 1 }] });
  ok(r.status === 200 && r.body.kits.find((k) => k.role === 'VIGILANTE').items.find((i) => i.name === 'Coturno').period_months === 6, 'kit salvo com o coturno trocando a cada 6 meses');
  r = await api(p, '/api/rh/kits', 'PUT', { role: 'PORTEIRO', period_months: 12, items: [{ name: 'Camisa', size_from: 'camisa', qty: 1, period_months: 99 }] });
  ok(r.status === 400, 'prazo da peça fora de 1 a 60 meses é recusado');
  r = await api(p, '/api/rh/colaboradores', 'POST', { name: 'ANA TESTE CONTROLE', matricula: '7701', role: 'VIGILANTE', client: 'CLIENTE GAMA', company: 'MAX FORTE', admitted_at: '2024-03-01', sizes: { camisa: 'M', calca: '40' } });
  ok(r.status === 200, 'Ana cadastrada (sem número de calçado)');
  r = await api(p, '/api/rh/colaboradores', 'POST', { name: 'BIA TESTE SEMKIT', matricula: '7702', role: 'COPEIRA', client: 'CLIENTE GAMA', company: 'MAX SERVIÇOS' });
  ok(r.status === 200, 'Bia cadastrada (função sem kit, sem admissão)');

  console.log('\n[3] Tela inicial do RH: os seis números');
  await p.goto(B + '/setor/rh');
  await p.waitForSelector('[data-max="controle-kit_incompleto"]', { timeout: 20000 });
  const api0 = (await api(p, '/api/rh/controle')).body;
  const R = Object.fromEntries(api0.resumo.map((x) => [x.id, x]));
  ok(api0.resumo.length === 6, 'seis números');
  ok((await card(p, 'kit_incompleto')) === R.kit_incompleto.valor && R.kit_incompleto.valor >= 1 && R.kit_incompleto.semInfo >= 1, `kit incompleto ${R.kit_incompleto.valor} (sem informação ${R.kit_incompleto.semInfo})`);
  ok(R.pendentes.valor >= 1, 'peças pendentes de entrega: ' + R.pendentes.valor);
  ok(R.vencidas.valor >= 2, 'peças com troca vencida: ' + R.vencidas.valor);
  ok(R.reposicoes.valor >= 1, 'reposições em 60 dias: ' + R.reposicoes.valor);
  ok(R.aso.semInfo >= 2 && R.cursos.semInfo >= 1, `sem registro: ASO ${R.aso.semInfo}, cursos ${R.cursos.semInfo}`);
  ok(/sem informação/.test(await p.locator('[data-max="controle-aso"]').innerText()), 'o card mostra o que está sem informação separado');
  const gama = api0.contratos.find((c) => c.contrato === 'CLIENTE GAMA');
  ok(gama && gama.pendentes === 1 && gama.vencidas === 2 && gama.falta === 3 && gama.semKit === 1, 'contrato CLIENTE GAMA: 1 pendente, 2 vencidas, falta receber 3, 1 sem kit: ' + JSON.stringify(gama));
  await p.screenshot({ path: SHOTS + '/ctl-inicio.png', fullPage: true });

  console.log('\n[4] Clique no número: relação, filtros, sem informação e Excel');
  await p.click('[data-max="controle-vencidas"]');
  await p.waitForSelector('.t-table tbody tr', { timeout: 15000 });
  let txt = (await p.locator('.t-table tbody').innerText()).replace(/\s+/g, ' ');
  ok(/ANA TESTE CONTROLE/.test(txt) && /Coturno/.test(txt) && /Camisa/.test(txt) && /Vencida há/.test(txt), 'relação das trocas vencidas com coturno e camisa: ' + txt.slice(0, 160));
  await p.selectOption('select[aria-label="Contrato"]', 'CLIENTE GAMA');
  ok((await p.locator('.t-table tbody tr').count()) === 2, 'filtro por contrato');
  await p.screenshot({ path: SHOTS + '/ctl-relacao.png', fullPage: true });
  const dl = p.waitForEvent('download', { timeout: 30000 });
  await p.click('[data-max="controle-exportar"]');
  const file = await dl;
  const path = SHOTS + '/ctl-export.xlsx';
  await file.saveAs(path);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const pend = wb.getWorksheet('Pendências');
  ok(pend && pend.rowCount === 6 && /Coturno|Camisa/.test(String(pend.getRow(5).getCell(7).value)) && wb.getWorksheet('Sem informação'), `Excel com a relação filtrada (${pend?.rowCount - 4} linhas) e a aba sem informação`);
  await p.click('text=Voltar aos números');
  await p.click('[data-max="controle-kit_incompleto"]');
  await p.waitForSelector('.filter-seg button:has-text("Sem informação")');
  await p.click('.filter-seg button:has-text("Sem informação")');
  await p.waitForSelector('.t-table tbody tr:has-text("BIA TESTE SEMKIT")', { timeout: 10000 });
  ok(/Função COPEIRA sem kit/.test(await p.locator('.t-table tbody tr:has-text("BIA TESTE SEMKIT")').innerText()), 'sem informação: função sem kit aparece separada');
  await p.click('text=Voltar aos números');

  console.log('\n[5] Exigência nova sem programar: NR-35 só para vigilante');
  await p.click('[data-max="controle-exigencias"]');
  await p.waitForSelector('text=Reciclagem de vigilante');
  await p.click('[data-max="exigencia-nova"]');
  await p.fill('#ex-n', 'NR-35 trabalho em altura');
  await p.fill('#ex-v', '24');
  await p.fill('#ex-a', '30');
  await p.fill('#esc-funcoes', 'VIGILANTE');
  await p.press('#esc-funcoes', 'Enter');
  await p.click('.modal .btn-primary:has-text("Salvar")');
  await p.waitForSelector('text=NR-35 trabalho em altura', { timeout: 10000 });
  ok(/funções: VIGILANTE/.test(await p.locator('.ctl-exig:has-text("NR-35")').innerText()), 'NR-35 cadastrada para a função Vigilante, validade 24 meses, alerta 30 dias');
  await p.keyboard.press('Escape');
  r = await api(p, '/api/rh/exigencias', 'POST', { name: 'nr-35 TRABALHO EM ALTURA', validity_months: 12 });
  ok(r.status === 409, 'não deixa duplicar o nome');

  console.log('\n[6] Ficha do colaborador: peças e registro do ASO');
  const lista = (await api(p, '/api/rh/colaboradores')).body.collaborators;
  const ana = lista.find((c) => c.name === 'ANA TESTE CONTROLE');
  await p.goto(B + '/setor/rh#colaboradores');
  await p.waitForSelector('tr:has-text("ANA TESTE CONTROLE")', { timeout: 20000 });
  await p.click('tr:has-text("ANA TESTE CONTROLE")');
  await p.waitForSelector('text=Fardamento por peça', { timeout: 15000 });
  await p.waitForSelector('.drawer .kv-row:has-text("Coturno")');
  const drawer = (await p.locator('.drawer').innerText()).replace(/\s+/g, ' ');
  ok(/troca a cada 6 meses/.test(drawer) && /1× Camisa M.*Troca vencida/.test(drawer) && /1× Camisa.*Pendente de entrega/.test(drawer), 'cada peça com a própria entrega e troca (coturno 6 meses, uma camisa vencida e outra pendente)');
  ok(/Falta informar:.*Sem tamanho de calçado/.test(drawer) && /NR-35 trabalho em altura/.test(drawer) && /Reciclagem de vigilante/.test(drawer), 'falta o tamanho de calçado; NR-35 e reciclagem aparecem para a vigilante');
  await p.locator('.drawer .kv-row:has-text("ASO periódico") >> text=registrar').click();
  const asoEm = iso(meses(dia(45), -12));
  await p.fill('#rg-d', asoEm);
  await p.click('.modal .btn-primary:has-text("Registrar")');
  await p.waitForSelector('.drawer .kv-row:has-text("ASO periódico") .pbadge:has-text("Vence em")', { timeout: 10000 });
  ok(true, 'ASO registrado: vence em 45 dias (a vencer)');
  await p.screenshot({ path: SHOTS + '/ctl-ficha.png', fullPage: true });
  r = await api(p, `/api/rh/colaboradores/${ana.id}/controle`, 'POST', { requirement_id: api0.exigencias[0].id, done_at: '2099-01-01' });
  ok(r.status === 400, 'data de realização no futuro é recusada');
  r = await api(p, '/api/rh/controle?ind=aso');
  ok(r.body.linhas.some((l) => l.name === 'ANA TESTE CONTROLE' && !l.semInfo && l.dias === 45), 'Ana agora entra nos ASOs a vencer em 60 dias');

  console.log('\n[7] Troca anual usa a peça que vence primeiro');
  r = await api(p, '/api/rh/trocas');
  const t = r.body.rows.find((x) => x.collaborator.name === 'ANA TESTE CONTROLE');
  ok(t && t.status === 'vencida' && t.days === -30, 'troca da Ana: a camisa venceu há 30 dias: ' + JSON.stringify({ s: t?.status, d: t?.days, due: t?.due }));

  console.log('\n[8] Permissão: quem só vê não cadastra');
  const rita = await session('rita');
  r = await api(rita, '/api/rh/exigencias', 'POST', { name: 'Teste', validity_months: 12 });
  ok(r.status === 403, 'Rita (só visualiza colaboradores) não cadastra exigência');
  r = await api(rita, '/api/rh/controle');
  ok(r.status === 200, 'mas vê os números');
  await rita.context().close();
} catch (e) {
  problems.push('exceção: ' + e.message);
  console.log(e);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} PROBLEMA(S)` : '\nTUDO CERTO');
process.exit(problems.length ? 1 : 0);
