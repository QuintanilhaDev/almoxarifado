/**
 * Gestão → Controle de fardamento: importa a planilha do RH/DP (montada aqui, com nomes
 * inventados), confere os números, os filtros, a grade de tamanhos e a lista de entregas.
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

/* ---------- planilha de controle (12 meses, 3 empresas, 4 postos) */
const wb = new ExcelJS.Workbook();
wb.addWorksheet('PRÉVIA PORC.%').addRow(['Soma de QTD CALÇA', 'CALÇAS']);
const ws = wb.addWorksheet('Controle_2026');
ws.addRow([null, null, null, null, null, null, null, null, 9999]);
ws.addRow(['Empresa', 'Data de Solicitação', 'Solicitante', 'Funcionário', 'Função', 'Posto', 'mês/ano', 'Data de Entrega', 'CAMISA MC', 'QTD MC', 'CAMISA ML', 'QTD ML', 'CALÇA', 'QTD CALÇA', 'CALÇADOS', 'QTD CALÇADOS', 'ITENS A', 'QTD A']);
const EMP = ['MAX FORTE', 'MAX SERVIÇOS ', 'MAX FORTE', 'MAX CONFIÁVEL'];
const POSTOS = ['PORTO TESTE', 'CONDOMINIO TESTE', 'SHOPPING TESTE', 'HOSPITAL TESTE'];
const FUNC = ['VIGILANTE', 'AGENTE DE PORTARIA', 'VIGILANTE', 'ASG'];
let n = 0;
for (let m = 0; m < 12; m++) {
  const y = m < 3 ? 2025 : 2026; // out/25 a set/26
  const mes = ((9 + m) % 12) + 1;
  const qtd = 3 + (m % 4); // 3 a 6 entregas por mês
  for (let k = 0; k < qtd; k++) {
    const i = n++ % 4;
    const d = new Date(Date.UTC(y, mes - 1, 2 + k));
    ws.addRow([EMP[i], d, k % 2 ? 'NARDELE' : 'RH/DP', `FUNCIONARIO ${String(n % 20).padStart(2, '0')}`, FUNC[i], POSTOS[i], null, d, 4 + (k % 3), 1, 4 + (k % 3), 1, 44 + 2 * (k % 3), 2, i === 3 ? 'ANTI 38' : `BOTINA ${40 + k}`, 1, 'BONÉ', 1]);
  }
}
const xlsx = `${SHOTS}/FARDAMENTO_CONTROLE_teste.xlsx`;
await wb.xlsx.writeFile(xlsx);
const total = n;

const browser = await chromium.launch();
async function session(user, mobile = false) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1360, height: 900 }, locale: 'pt-BR', ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
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
const stats = async (p) => (await p.locator('.fd .stat-grid').innerText()).replace(/\s+/g, ' ');

try {
  console.log('\n[1] Só master acessa');
  const carla = await session('carla');
  const st = await carla.evaluate(async () => (await fetch('/api/gestao/fardamento')).status);
  ok(st === 403, 'Carla (master do RH, não geral) não lê o controle pela API: ' + st);
  await carla.context().close();

  const p = await session('mateus');
  await p.goto(B + '/hub#gestao');
  await p.waitForSelector('[data-max="gestao-fardamento"]', { timeout: 20000 });
  await p.click('[data-max="gestao-fardamento"]');
  await p.waitForSelector('.fd-drop', { timeout: 15000 });
  ok(/Importe a planilha/.test(await p.locator('.fd-drop').textContent()), 'sem planilha: pede para importar');

  console.log('\n[2] Importa a planilha');
  await p.setInputFiles('input[aria-label="Planilha de controle de fardamento"]', xlsx);
  await p.waitForSelector('.fd .stat-grid', { timeout: 30000 });
  const meta = (await p.locator('.fd-meta').textContent()).replace(/\s+/g, ' ');
  ok(new RegExp(`${total} entregas de outubro de 2025 a setembro de 2026`).test(meta) && /aba Controle_2026/.test(meta), 'lê a aba certa: ' + meta.slice(0, 160));
  let s = await stats(p);
  ok(new RegExp(`Entregas ${total}\\b`).test(s), `${total} entregas nos últimos 12 meses: ` + s);
  ok(/Funcionários atendidos 20 em 4 postos/.test(s), '20 funcionários em 4 postos');
  ok(new RegExp(`Peças entregues ${total * 6}\\b`).test(s), `${total * 6} peças (6 por entrega)`);
  ok((await p.locator('.fd-chart rect.fd-bar').count()) === 12, 'gráfico com 12 meses');
  await p.screenshot({ path: SHOTS + '/fd-painel.png', fullPage: true });

  console.log('\n[3] Filtros');
  await p.locator('.fd-row:has-text("HOSPITAL TESTE")').first().click();
  await p.waitForTimeout(300);
  s = await stats(p);
  ok(/em 1 postos?/.test(s) && /Max Confiável/.test(await p.locator('.fd-lista').textContent()), 'clicar no posto filtra tudo: ' + s.slice(0, 120));
  ok((await p.locator('.fd-grade').textContent()).includes('Antiderrapante') || (await p.locator('.fd-sel-sm select').inputValue()) !== '', 'grade de tamanhos acompanha o filtro');
  await p.click('.fd-selects .link-btn');
  await p.selectOption('select[aria-label="Peça"]', 'Calça');
  await p.waitForTimeout(300);
  s = await stats(p);
  ok(new RegExp(`Calça entregues ${total * 2}\\b`).test(s), 'filtro de peça: só calças: ' + s.slice(0, 160));
  const gradeTxt = (await p.locator('.fd-grade').textContent()).replace(/\s+/g, ' ');
  ok(/44/.test(gradeTxt) && /46/.test(gradeTxt) && /48/.test(gradeTxt) && /Média\/mês/.test(gradeTxt), 'grade da calça com 44, 46 e 48 e média por mês');
  await p.click('.fd-selects .link-btn');
  await p.click('.fd-chip:has-text("2025")');
  await p.waitForTimeout(300);
  s = await stats(p);
  ok(/Entregas (1[0-9]|[2-9])\b/.test(s) && (await p.locator('.fd-chart rect.fd-bar').count()) === 3, 'período 2025: out a dez (3 meses)');
  await p.click('.fd-chip:has-text("Últimos 12 meses")');

  console.log('\n[4] Lista de entregas e quem recebeu mais vezes');
  await p.fill('input[aria-label="Buscar entregas"]', 'FUNCIONARIO 03');
  await p.waitForTimeout(300);
  const linhas = await p.locator('.fd-lista tbody tr').count();
  ok(linhas >= 2 && (await p.locator('.fd-lista tbody tr').first().textContent()).includes('FUNCIONARIO 03'), 'busca por funcionário: ' + linhas + ' entregas');
  ok((await p.locator('.fd-rec').count()) === 1, 'lista de funcionários com 3 ou mais entregas');

  console.log('\n[5] Celular');
  const m = await session('mateus', true);
  await m.goto(B + '/hub#gestao');
  await m.waitForSelector('[data-max="gestao-fardamento"]', { timeout: 20000 });
  await m.click('[data-max="gestao-fardamento"]');
  await m.waitForSelector('.fd .stat-grid', { timeout: 20000 });
  const largura = await m.evaluate(() => document.documentElement.scrollWidth);
  ok(largura <= 392, 'sem rolagem lateral no celular: ' + largura);
  await m.screenshot({ path: SHOTS + '/fd-celular.png', fullPage: true });
} catch (e) {
  problems.push('exceção: ' + e.message);
  console.log(e);
}
await browser.close();
console.log(problems.length ? `\n${problems.length} PROBLEMA(S)` : '\nTUDO CERTO');
process.exit(problems.length ? 1 : 0);
