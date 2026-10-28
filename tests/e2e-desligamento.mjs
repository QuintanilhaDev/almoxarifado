/**
 * Desligamento e devolução (RH → Colaboradores): importa a planilha do RH com duas abas,
 * registra o desligamento conferindo o que a pessoa recebeu (planilha de controle da Gestão),
 * acompanha a devolução pendente e baixa o relatório filtrado por cliente e posto.
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

/* ---------- planilha do RH com duas abas (como a do DP: "SEM O TRE" e "TODOS") */
const rh = new ExcelJS.Workbook();
const cab = ['Mat', 'Nome', 'Admissão', 'Descrição cargo', 'Descrição Serviço', 'CPF', 'Data nascimento'];
const pessoas = [
  ['9101', 'JOSE TESTE DESLIGADO', '03/08/2022', 'VIGIA', 'CLIENTE ALFA LTDA', '00000000001', '10/01/1990'],
  ['9102', 'MARIA TESTE ATIVA', '01/11/2022', 'ASG', 'CLIENTE BETA SA', '00000000002', '21/03/1985'],
];
const a1 = rh.addWorksheet('SEM O TRE');
a1.addRow(cab);
pessoas.forEach((p) => a1.addRow(p));
const a2 = rh.addWorksheet('TODOS');
a2.addRow(cab);
pessoas.forEach((p) => a2.addRow(p));
a2.addRow(['9103', 'PEDRO TESTE TRE', '05/05/2023', 'VIGILANTE', 'TRE BAHIA', '00000000003', '01/01/1980']);
const rhFile = `${SHOTS}/Colaboradores_Max_Servicos_teste.xlsx`;
await rh.xlsx.writeFile(rhFile);

/* ---------- planilha de controle de fardamento (Gestão) com o que o José recebeu */
const fc = new ExcelJS.Workbook();
const ws = fc.addWorksheet('Controle_2026');
ws.addRow(['Empresa', 'Data de Solicitação', 'Solicitante', 'Funcionário', 'Função', 'Posto', 'mês/ano', 'Data de Entrega', 'CAMISA MC', 'QTD MC', 'CALÇA', 'QTD CALÇA', 'CALÇADOS', 'QTD CALÇADOS', 'ITENS A', 'QTD A']);
const d = (y, m, dd) => new Date(Date.UTC(y, m - 1, dd));
ws.addRow(['MAX SERVIÇOS', d(2025, 3, 2), 'RH/DP', 'JOSE TESTE DESLIGADO', 'VIGIA', 'CLIENTE ALFA LTDA - PORTARIA 2', 'mar/25', d(2025, 3, 2), 5, 2, 46, 2, 'BOTINA 42', 1, 'BONÉ', 1]);
ws.addRow(['MAX SERVIÇOS', d(2026, 2, 10), 'RH/DP', 'JOSE TESTE DESLIGADO', 'VIGIA', 'CLIENTE ALFA LTDA - PORTARIA 2', 'fev/26', d(2026, 2, 10), 5, 1, 46, 1, null, null, null, null]);
ws.addRow(['MAX SERVIÇOS', d(2026, 2, 11), 'RH/DP', 'MARIA TESTE ATIVA', 'ASG', 'CLIENTE BETA SA', 'fev/26', d(2026, 2, 11), 4, 1, 44, 1, null, null, null, null]);
const fcFile = `${SHOTS}/FARDAMENTO_desl_teste.xlsx`;
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

try {
  console.log('\n[1] A Gestão importa o controle de fardamento');
  const m = await session('mateus');
  await m.goto(B + '/hub#gestao');
  await m.waitForSelector('[data-max="gestao-fardamento"]', { timeout: 20000 });
  await m.click('[data-max="gestao-fardamento"]');
  await m.waitForSelector('input[aria-label="Planilha de controle de fardamento"]', { state: 'attached' });
  await m.setInputFiles('input[aria-label="Planilha de controle de fardamento"]', fcFile);
  await m.waitForFunction(() => /FARDAMENTO_desl_teste/.test(document.querySelector('.fd-meta')?.textContent ?? ''), null, { timeout: 30000 });
  ok(true, 'planilha de controle importada');
  await m.context().close();

  console.log('\n[2] RH importa a planilha de colaboradores escolhendo a aba');
  const p = await session('carla');
  await p.goto(B + '/setor/rh');
  await p.waitForSelector('.nav-item[data-tab="colaboradores"]', { timeout: 20000 });
  await p.click('.nav-item[data-tab="colaboradores"]');
  await p.waitForSelector('[data-max="colab-importar"]', { timeout: 15000 });
  await p.setInputFiles('input[aria-label="Planilha de colaboradores"]', rhFile);
  await p.waitForSelector('.imp-abas', { timeout: 20000 });
  const imp = (await p.locator('.modal').innerText()).replace(/\s+/g, ' ');
  ok(/SEM O TRE 2 pessoa/.test(imp) && /TODOS 3 pessoa/.test(imp) && /Importar 3\b/.test(imp), 'lê as duas abas e junta quem aparece nas duas (3 pessoas): ' + imp.slice(0, 160));
  ok(/2 pessoa\(s\) aparecem em mais de uma aba/.test(imp) && /Novos cadastros 3/.test(imp), 'mostra quantas foram juntadas e quantas são novas');
  ok(/Descrição Serviço → cliente/.test(imp) && (await p.inputValue('input[aria-label="Empresa"]')) === 'Max Serviços', 'reconhece o cliente e a empresa pelo nome do arquivo');
  await p.click('.modal .btn-primary');
  await p.waitForSelector('tr:has-text("JOSE TESTE DESLIGADO")', { timeout: 20000 });
  ok((await p.locator('tr:has-text("PEDRO TESTE TRE")').count()) === 1, 'quem só está na aba TODOS também entrou');

  console.log('\n[3] Registrar desligamento com a conferência');
  await p.waitForSelector('.modal', { state: 'detached', timeout: 10000 }).catch(() => undefined);
  await p.waitForTimeout(500);
  await p.click('tr:has-text("JOSE TESTE DESLIGADO")');
  await p.waitForSelector('[data-max="colab-desligar"]', { timeout: 15000 });
  await p.click('[data-max="colab-desligar"]');
  await p.waitForSelector('.dl-item', { timeout: 15000 });
  const itens = await p.locator('.dl-item').allInnerTexts();
  ok(itens.length === 4 && itens.some((t) => /3× Camisa MC/.test(t) && /2 entregas/.test(t)) && itens.some((t) => /Botina/.test(t) && /42/.test(t)), 'lista o que recebeu (planilha de controle), somando as entregas: ' + itens.map((t) => t.split('\n')[0]).join(' | '));
  await p.screenshot({ path: SHOTS + '/dl-conferencia.png', fullPage: true });
  // camisa: devolveu 3; calça: devolveu 2 de 3 (pendente); botina: não devolvida; boné: não se aplica
  const linha = (t) => p.locator('.dl-item', { hasText: t });
  await linha('Camisa MC').locator('button:text-is("Devolvido")').click();
  await linha('Calça').locator('input[aria-label="Quantidade devolvida"]').fill('2');
  await linha('Calça').locator('input[aria-label="Observação do item"]').fill('falta 1, vai trazer');
  await linha('Botina').locator('button:has-text("Não devolvido")').click();
  await linha('Botina').locator('input[aria-label="Observação do item"]').fill('extraviada');
  await linha('Boné').locator('button:has-text("Não se aplica")').click();
  await p.click('text=Incluir item (crachá');
  await p.locator('.dl-item').last().locator('input[aria-label="Nome do item"]').fill('Crachá');
  await p.selectOption('select[aria-label="Motivo do desligamento"]', 'Pedido de demissão');
  await p.click('[data-max="desligar-confirmar"]');
  await p.waitForSelector('.dl-ficha', { timeout: 20000 });
  const ficha = (await p.locator('.dl-ficha').innerText()).replace(/\s+/g, ' ');
  ok(/Pedido de demissão/.test(ficha) && /2 pendente/.test(ficha), 'ficha mostra o desligamento e 2 pendentes (calça e crachá): ' + ficha.slice(0, 200));
  ok(/Camisa MC.*Devolvido/.test(ficha) && /Botina.*Não devolvido/.test(ficha) && !/Boné/.test(ficha), 'devolvido, não devolvido e o "não se aplica" de fora');
  ok(/Desligado/.test(await p.locator('.drawer-top').innerText()), 'cadastro inativo');
  await p.screenshot({ path: SHOTS + '/dl-ficha.png', fullPage: true });

  console.log('\n[4] Sai dos alertas e das listas de ativos, mas o histórico fica');
  let r = await api(p, '/api/rh/trocas');
  ok(r.status === 200 && !JSON.stringify(r.body).includes('JOSE TESTE DESLIGADO'), 'fora dos alertas de troca de fardamento');
  r = await api(p, '/api/rh/colaboradores');
  const jose = r.body.collaborators.find((c) => c.name === 'JOSE TESTE DESLIGADO');
  ok(jose && jose.active === false && jose.dismissed_at && jose.client === 'CLIENTE ALFA LTDA' && /PORTARIA 2/.test(jose.posto_name ?? ''), 'inativo, com data, cliente e o posto da planilha: ' + JSON.stringify({ a: jose?.active, c: jose?.client, p: jose?.posto_name }));
  r = await api(p, `/api/rh/colaboradores/${jose.id}/desligamento`, 'POST', { date: '2026-10-01', items: [] });
  ok(r.status === 409, 'não deixa desligar duas vezes');
  await p.keyboard.press('Escape');

  console.log('\n[5] Aba Devoluções: pendências, filtros e relatório');
  await p.click('[data-max="colab-devolucoes"]');
  await p.waitForSelector('.dl-view tr:has-text("JOSE TESTE DESLIGADO")', { timeout: 15000 });
  ok(/2 item/.test(await p.locator('.dl-view tr:has-text("JOSE TESTE DESLIGADO")').innerText()), 'aparece com 2 itens pendentes');
  const opts = await p.locator('select[aria-label="Cliente"] option').allInnerTexts();
  ok(opts.includes('CLIENTE ALFA LTDA'), 'filtro de cliente: ' + opts.join(', '));
  await p.selectOption('select[aria-label="Cliente"]', 'CLIENTE ALFA LTDA');
  await p.selectOption('select[aria-label="Posto"]', { index: 1 });
  ok((await p.locator('.dl-view tbody tr').count()) === 1, 'filtrado por cliente e posto');
  await p.screenshot({ path: SHOTS + '/dl-devolucoes.png', fullPage: true });
  const dl = p.waitForEvent('download', { timeout: 30000 });
  await p.click('[data-max="devolucoes-pdf"]');
  const pdf = await dl;
  await pdf.saveAs(`${SHOTS}/devolucoes.pdf`);
  const buf = fs.readFileSync(`${SHOTS}/devolucoes.pdf`);
  ok(/^Devoluções pendentes .*\.pdf$/.test(pdf.suggestedFilename()) && buf.subarray(0, 4).toString() === '%PDF', 'relatório PDF: ' + pdf.suggestedFilename());
  const dx = p.waitForEvent('download', { timeout: 30000 });
  await p.click('[data-max="devolucoes-xlsx"]');
  const xl = await dx;
  await xl.saveAs(`${SHOTS}/devolucoes.xlsx`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(`${SHOTS}/devolucoes.xlsx`);
  const linhas = [];
  wb.getWorksheet('Itens').eachRow((row, n) => n > 4 && linhas.push(row.values.slice(1).map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)).join(' | ')));
  ok(linhas.length === 2 && linhas.every((t) => /Pendente/.test(t)) && linhas.some((t) => /Calça/.test(t) && /falta 1/.test(t)), 'planilha com os 2 itens pendentes: ' + linhas.join(' // '));

  console.log('\n[6] Atualiza a devolução pendente');
  await p.click('.dl-view tr:has-text("JOSE TESTE DESLIGADO")');
  await p.waitForSelector('.dl-fitem:has-text("Crachá")', { timeout: 15000 });
  const cracha = p.locator('.dl-fitem', { hasText: 'Crachá' });
  await cracha.locator('text=atualizar').click();
  await cracha.locator('.dl-st button:text-is("Devolvido")').click();
  await cracha.locator('button:has-text("Salvar")').click();
  await p.waitForFunction(() => /1 pendente/.test(document.querySelector('.dl-ficha')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => undefined);
  ok(/1 pendente/.test(await p.locator('.dl-ficha').innerText()), 'crachá devolvido: resta 1 pendente');
  await p.locator('.dl-fitem', { hasText: 'Crachá' }).locator('button[aria-label="Histórico do item"]').click();
  ok(/Pendente → Devolvido/.test(await p.locator('.dl-fitem', { hasText: 'Crachá' }).innerText()), 'histórico de quem mudou e quando');

  console.log('\n[7] Permissão');
  const rita = await session('rita');
  r = await api(rita, `/api/rh/colaboradores/${r.body?.id ?? jose.id}/desligamento`, 'POST', { date: '2026-10-01', items: [] });
  ok(r.status === 403, 'a Rita (só visualiza colaboradores) não registra desligamento');
  r = await api(rita, '/api/rh/devolucoes');
  ok(r.status === 200, 'mas consulta as devoluções');
  await rita.context().close();
} catch (e) {
  problems.push('exceção: ' + e.message);
  console.log(e);
}
await browser.close();
console.log(problems.length ? `\n${problems.length} PROBLEMA(S)` : '\nTUDO CERTO');
process.exit(problems.length ? 1 : 0);
