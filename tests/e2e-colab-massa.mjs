/**
 * Muitos colaboradores (mais de 1.000, o limite de linhas por consulta do banco):
 * a planilha entra inteira, a aba Pessoas mostra todos e importar de novo não duplica.
 * Nomes inventados.
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

const N = 2150;
const wb = new ExcelJS.Workbook();
const cab = ['Mat', 'Nome', 'Admissão', 'Descrição cargo', 'Descrição Serviço'];
const a = wb.addWorksheet('SEM O TRE');
const b = wb.addWorksheet('TODOS');
a.addRow(cab);
b.addRow(cab);
for (let i = 1; i <= N; i++) {
  const row = [String(50000 + i), `PESSOA TESTE ${String(i).padStart(4, '0')}`, '01/02/2023', i % 3 ? 'VIGIA' : 'ASG', `CLIENTE ${i % 40}`];
  if (i <= 700) a.addRow(row);
  b.addRow(row);
}
const file = `${SHOTS}/Colaboradores_Max_Servicos_massa.xlsx`;
await wb.xlsx.writeFile(file);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'pt-BR' });
const p = await ctx.newPage();
p.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
try {
  await p.goto(B + '/');
  await p.fill('#user', 'carla');
  await p.fill('#pass', '123456');
  await p.click('button[type=submit]');
  await p.waitForURL((u) => u.pathname.length > 1, { timeout: 30000 });
  await p.goto(B + '/setor/rh');
  await p.waitForSelector('.nav-item[data-tab="colaboradores"]', { timeout: 20000 });
  await p.click('.nav-item[data-tab="colaboradores"]');
  await p.waitForSelector('[data-max="colab-importar"]', { timeout: 15000 });
  const antes = await p.evaluate(async () => (await (await fetch('/api/rh/colaboradores')).json()).collaborators.length);

  console.log('\n[1] Importa 2.150 pessoas');
  await p.setInputFiles('input[aria-label="Planilha de colaboradores"]', file);
  await p.waitForSelector('.imp-abas', { timeout: 60000 });
  ok(/Importar 2\.150/.test(await p.locator('.modal').innerText()), 'a conferência mostra as 2.150 pessoas');
  await p.click('.modal .btn-primary');
  await p.waitForSelector('.modal', { state: 'detached', timeout: 120000 });
  const depois = await p.evaluate(async () => (await (await fetch('/api/rh/colaboradores')).json()).collaborators.length);
  ok(depois - antes === N, `todas entraram e a lista traz todas (${depois - antes} novas, total ${depois})`);
  await p.waitForFunction((n) => new RegExp(`Pessoas\\s*${n.toLocaleString('pt-BR')}`).test(document.querySelector('.filter-seg')?.textContent ?? ''), depois, { timeout: 20000 }).catch(() => undefined);
  const aba = (await p.locator('.filter-seg').first().innerText()).replace(/\s+/g, ' ');
  ok(aba.includes(depois.toLocaleString('pt-BR')), 'o contador da aba Pessoas mostra todos: ' + aba);
  ok(/Mostrando 300 de/.test(await p.locator('.list-more').innerText()), 'a tabela desenha aos poucos, com "mostrar mais"');
  await p.fill('input[aria-label="Buscar colaboradores"]', 'PESSOA TESTE 2149');
  await p.waitForTimeout(400);
  ok((await p.locator('tr:has-text("PESSOA TESTE 2149")').count()) === 1, 'a busca acha quem está depois da 1.000ª linha');

  console.log('\n[2] Importa de novo: não duplica');
  await p.fill('input[aria-label="Buscar colaboradores"]', '');
  await p.setInputFiles('input[aria-label="Planilha de colaboradores"]', file);
  await p.waitForSelector('.imp-abas', { timeout: 60000 });
  const conf = (await p.locator('.modal').innerText()).replace(/\s+/g, ' ');
  ok(/Novos cadastros 0/.test(conf) && /Já cadastrados \(atualiza\) 2\.150/.test(conf), 'reconhece todos como já cadastrados: ' + conf.slice(0, 200));
  await p.click('.modal .btn-primary');
  await p.waitForSelector('.modal', { state: 'detached', timeout: 120000 });
  const fim = await p.evaluate(async () => (await (await fetch('/api/rh/colaboradores')).json()).collaborators.length);
  ok(fim === depois, 'ninguém duplicado: ' + fim);
} catch (e) {
  problems.push('exceção: ' + e.message);
  console.log(e);
}
await browser.close();
console.log(problems.length ? `\n${problems.length} PROBLEMA(S)` : '\nTUDO CERTO');
process.exit(problems.length ? 1 : 0);
