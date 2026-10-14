/**
 * Fornecedores (setor Compras), de ponta a ponta no banco de teste:
 * cadastro manual, planilha "bagunçada" pela leitura inteligente, Max, permissões e celular.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const ExcelJS = require('exceljs');
const B = 'http://localhost:3100';
const SHOTS = process.env.SHOTS || '/tmp/shots';
const problems = [];
const ok = (cond, msg) => { if (!cond) { problems.push(msg); console.log('  ✗', msg); } else console.log('  ✓', msg); };

const FAKE = `
  window.__recs = [];
  class FakeRec {
    constructor(){ window.__recs.push(this); }
    start(){ if(this._on) throw new Error('already'); this._on=true; setTimeout(()=>this.onstart&&this.onstart(),10); }
    stop(){ this._end(); } abort(){ this._end(); }
    _end(){ if(!this._on) return; this._on=false; setTimeout(()=>this.onend&&this.onend(),10); }
    _say(t){ if(!this._on) return false; const r=[{transcript:t,confidence:.9}]; r.isFinal=true; this.onresult&&this.onresult({resultIndex:0,results:[r]}); return true; }
  }
  window.webkitSpeechRecognition = FakeRec; window.SpeechRecognition = FakeRec;
  window.__say = (t) => window.__recs.some((r) => r._say(t));
  if (window.speechSynthesis) window.speechSynthesis.speak = (u) => { setTimeout(()=>{u.onstart&&u.onstart({}); setTimeout(()=>u.onend&&u.onend({}), 400);}, 20); };
  window.__hits = [];
  const seen = new Set();
  new MutationObserver((ms) => { for (const m of ms) { const t = m.target; if (t.classList && t.classList.contains('max-hit') && !(m.oldValue || '').includes('max-hit') && !seen.has(t)) { seen.add(t); setTimeout(() => seen.delete(t), 300); window.__hits.push(t.getAttribute('data-tab') || t.getAttribute('data-max') || (t.hasAttribute('data-max-fornecedor') ? 'linha' : '') || t.getAttribute('href') || ''); } } })
    .observe(document, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
`;
async function newPage(browser, mobile = false) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 820 } : { width: 1360, height: 900 }, deviceScaleFactor: mobile ? 2 : 1, locale: 'pt-BR', timezoneId: 'America/Bahia' });
  const page = await ctx.newPage();
  await page.addInitScript(FAKE);
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|ERR_CONNECTION|Failed to load resource|fonts\.g/i.test(m.text())) { problems.push('console: ' + m.text().slice(0, 200)); console.log('  ! console', m.text().slice(0, 200)); } });
  page.on('pageerror', (e) => { problems.push('pageerror: ' + e.message); console.log('  ! pageerror', e.message); });
  return page;
}
async function login(page, user, url) {
  await page.goto(B + '/');
  await page.fill('#user', user);
  await page.fill('#pass', '123456');
  await page.click('button[type=submit]');
  await page.waitForURL(B + url, { timeout: 20000 });
  await page.waitForSelector('.nav-item', { state: 'attached' });
  await page.waitForTimeout(1500);
}
const lastMax = (page) => page.evaluate(() => [...document.querySelectorAll('.max-msg.max')].pop()?.textContent || '');
async function ask(page, text) {
  await page.waitForFunction(() => !document.documentElement.classList.contains('max-away'), null, { timeout: 20000 });
  if (!(await page.locator('.max-fab.is-listening').count())) await page.click('.max-fab');
  await page.waitForSelector('.max-fab.is-listening', { timeout: 4000 });
  await page.evaluate(() => { window.__hits = []; });
  await page.evaluate((t) => window.__say(t), text);
  await page.waitForFunction((t) => { const m = [...document.querySelectorAll('.max-msg:not(.is-thinking):not(.is-interim)')]; const n = m.length; return n >= 2 && m[n - 1].classList.contains('max') && m[n - 2].classList.contains('you') && m[n - 2].textContent === t; }, text, { timeout: 8000 });
  await page.waitForTimeout(400);
  await page.waitForFunction(() => !document.querySelector('.mr.is-on') && !document.documentElement.classList.contains('max-away'), null, { timeout: 20000 });
  return lastMax(page);
}
const hits = (page) => page.evaluate(() => window.__hits);

/** planilha "do mundo real": título, linha vazia, cabeçalhos com outros nomes, CNPJ como número, cidade/UF juntas */
async function messySheet(file) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Cadastro');
  ws.addRow(['LISTA DE FORNECEDORES - GRUPO MAX FORTE']);
  ws.mergeCells('A1:H1');
  ws.addRow([]);
  ws.addRow(['Razão Social', 'Nome Fantasia', 'CNPJ/CPF', 'Telefone', 'E-mail', 'Nome do contato', 'Ramo', 'Cidade']);
  ws.addRow(['Malharia Bahia Ltda', 'Malharia Bahia', 11222333000181, '(71) 3333-4444', 'VENDAS@MALHARIA.COM', 'Rosa', 'Fardamento', 'Salvador/BA']);
  ws.addRow(['Couros do Sul Ind. e Com.', '', '45.678.901/0001-75', '51 3222-1000', 'contato@courosdosul.com.br', 'Paulo', 'Botas e calçados de segurança', 'Novo Hamburgo - RS']);
  ws.addRow(['Equipa EPI', '', '12.345.678/0001-00', '', 'equipa@', '', 'EPI', '']); // CNPJ e e-mail inválidos
  ws.addRow(['Malharia Bahia Ltda', '', 11222333000181, '', '', '', '', '']); // repetida
  ws.addRow(['Lanterna & Cia', '', '', '71 99999-0000', '', 'Bia', 'Lanternas', 'Lauro de Freitas']);
  ws.addRow(['TOTAL', '', '', '', '', '', '', '']);
  await wb.xlsx.writeFile(file);
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await newPage(browser);
  await login(page, 'carlos', '/setor/compras');

  console.log('\n[1] Aba Fornecedores');
  await page.click('.nav-item[data-tab="fornecedores"]');
  await page.waitForSelector('.section-head h1:has-text("Fornecedores")', { timeout: 8000 });
  await page.waitForSelector('.empty, .t-table', { timeout: 8000 });
  const before = await page.locator('.t-table tbody tr').count();
  ok(true, `aba aberta (${before} fornecedores vindos das notas de teste)`);

  console.log('\n[2] Cadastro manual');
  await page.click('[data-max="fornecedor-novo"]');
  await page.waitForSelector('.modal.sheet, .modal.sx', { timeout: 5000 });
  await page.fill('#sf-name', 'Uniformes Atlântico Ltda');
  await page.fill('#sf-trade_name', 'Atlântico Uniformes');
  await page.fill('#sf-cnpj', '11.111.111/1111-11');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.sx-error', { timeout: 5000 });
  ok(/CNPJ\/CPF inválido/.test(await page.locator('.sx-error').textContent()), 'CNPJ errado é recusado com o motivo');
  await page.fill('#sf-cnpj', '98.765.432/0001-98');
  await page.fill('#sf-category', 'Fardamento e camisas');
  await page.fill('#sf-contact', 'Joana');
  await page.fill('#sf-phone', '(71) 3456-7890');
  await page.fill('#sf-email', 'Joana@Atlantico.com.br');
  await page.fill('#sf-city', 'Salvador');
  await page.selectOption('#sf-uf', 'BA');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.drawer h2:has-text("Atlântico Uniformes")', { timeout: 8000 });
  ok((await page.locator('.drawer').textContent()).includes('98.765.432/0001-98') && (await page.locator('.drawer').textContent()).includes('joana@atlantico.com.br'), 'cadastrado: CNPJ formatado e e-mail em minúsculas');
  ok((await page.locator('.drawer a:has-text("WhatsApp")').count()) === 1 && (await page.locator('.drawer a:has-text("Ligar")').count()) === 1, 'atalhos de contato (ligar, WhatsApp, e-mail)');
  await page.screenshot({ path: SHOTS + '/f1-gaveta.png' });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.drawer', { state: 'detached' });
  // mesmo CNPJ de novo
  const dupe = await page.evaluate(async () => { const r = await fetch('/api/compras/fornecedores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Outro', cnpj: '98765432000198' }) }); return r.status; });
  ok(dupe === 409, 'mesmo CNPJ duas vezes é barrado (409)');

  console.log('\n[3] Planilha bagunçada');
  const file = path.join(os.tmpdir(), 'fornecedores-teste.xlsx');
  await messySheet(file);
  await page.click('[data-max="fornecedor-importar"]');
  await page.waitForSelector('.dz', { timeout: 5000 });
  await page.setInputFiles('.modal input[type=file]', file);
  await page.waitForSelector('.imp-sum', { timeout: 15000 });
  const sum = await page.locator('.imp-sum').textContent();
  console.log('    resumo:', sum);
  ok(/3 novos/.test(sum) && /1 com problema/.test(sum) && /1 repetido/.test(sum), 'pré-visualização: 3 novos, 1 com problema, 1 repetido (título e TOTAL ignorados)');
  const cols = await page.locator('.imp-cols').textContent();
  ok(/Razão Social\) → nome/.test(cols) && /CNPJ\/CPF\) → CNPJ\/CPF/.test(cols) && /Nome do contato\) → contato/.test(cols) && /Ramo\) → o que fornece/.test(cols), 'colunas reconhecidas pelo nome: ' + cols.slice(0, 160));
  ok((await page.locator('.imp-table').textContent()).includes('11.222.333/0001-81'), 'CNPJ guardado como número no Excel aparece certo');
  await page.screenshot({ path: SHOTS + '/f2-importacao.png' });
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.dz, .imp-sum', { state: 'detached', timeout: 10000 });
  await page.waitForTimeout(800);
  const list = await page.evaluate(async () => (await (await fetch('/api/compras/fornecedores')).json()).suppliers);
  const mal = list.find((s) => s.cnpj === '11222333000181');
  ok(mal && mal.city === 'Salvador' && mal.uf === 'BA' && mal.email === 'vendas@malharia.com' && mal.contact === 'Rosa', '"Salvador/BA" vira cidade + UF; e-mail limpo');
  ok(list.some((s) => s.name === 'Lanterna & Cia' && !s.cnpj) && !list.some((s) => s.name === 'Equipa EPI'), 'sem CNPJ entra; linha inválida fica de fora');
  // importar de novo: ninguém duplica, todos são "completados"
  await page.click('[data-max="fornecedor-importar"]');
  await page.setInputFiles('.modal input[type=file]', file);
  await page.waitForSelector('.imp-sum', { timeout: 15000 });
  ok(/0 novos/.test(await page.locator('.imp-sum').textContent()) && /3 já cadastrados/.test(await page.locator('.imp-sum').textContent()), 'a mesma planilha de novo não duplica nada');
  await page.click('.modal .btn-ghost:has-text("Escolher outro")');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  console.log('\n[4] Max');
  let r = await ask(page, 'Max, quem fornece botas?');
  ok(/Couros do Sul/.test(r), 'quem fornece botas: ' + r);
  ok((await hits(page)).includes('linha'), 'ela correu até a linha do fornecedor');
  await page.waitForSelector('.drawer', { timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.drawer', { state: 'detached' });
  r = await ask(page, 'Max, qual o telefone do fornecedor Malharia Bahia?');
  ok(/Malharia Bahia: contato Rosa, telefone \(71\) 3333-4444/.test(r), 'contato do fornecedor: ' + r);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.click('.nav-item[data-tab="solicitacoes"]');
  await page.waitForTimeout(800);
  r = await ask(page, 'Max, cadastrar novo fornecedor Bota Brasil, telefone 71 98888-7777');
  const h = await hits(page);
  ok(JSON.stringify(h) === JSON.stringify(['fornecedores', 'fornecedor-novo']), 'socou a aba Fornecedores e o botão Novo fornecedor: ' + JSON.stringify(h));
  await page.waitForSelector('#sf-name', { timeout: 5000 });
  ok((await page.inputValue('#sf-name')) === 'Bota Brasil' && /98888-7777/.test(await page.inputValue('#sf-phone')), 'cadastro aberto já preenchido (nome e telefone)');
  ok(!(await page.evaluate(async () => (await (await fetch('/api/compras/fornecedores')).json()).suppliers.some((s) => s.name === 'Bota Brasil'))), 'nada gravado sem a pessoa confirmar');
  await page.click('.modal .btn-ghost:has-text("Cancelar")');
  r = await ask(page, 'Max, quantos fornecedores temos?');
  ok(/^Temos 5 fornecedores ativos/.test(r) || /^Temos \d+ fornecedores ativos/.test(r), 'contagem: ' + r);

  console.log('\n[5] Desativar');
  await page.click('.t-table tbody tr:has-text("Lanterna & Cia")');
  await page.click('.drawer button:has-text("Desativar")');
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.click('.filter-seg button:has-text("Inativos")');
  ok((await page.locator('.t-table tbody tr:has-text("Lanterna & Cia")').count()) === 1, 'desativado vai para Inativos (nada é apagado)');
  await page.screenshot({ path: SHOTS + '/f3-lista.png' });
  await page.context().close();

  console.log('\n[6] Permissões');
  const lucas = await newPage(browser);
  await login(lucas, 'lucas', '/setor/compras');
  ok((await lucas.locator('.nav-item[data-tab="fornecedores"]').count()) === 0, 'sem a permissão, a aba não aparece');
  const st = await lucas.evaluate(async () => (await fetch('/api/compras/fornecedores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'X' }) })).status);
  ok(st === 403, 'e a API recusa o cadastro (403)');
  await lucas.context().close();

  console.log('\n[7] Celular');
  const m = await newPage(browser, true);
  await login(m, 'carlos', '/setor/compras');
  await m.click('.tab[data-tab="fornecedores"]');
  await m.waitForSelector('.t-table', { timeout: 8000 });
  await m.waitForTimeout(600);
  const extra = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(extra <= 0, `sem rolagem lateral no celular (sobra ${extra}px)`);
  await m.screenshot({ path: SHOTS + '/f4-celular.png' });
  await m.context().close();
} catch (e) {
  problems.push('EXCEÇÃO ' + e.message);
  console.log('EXCEÇÃO', e);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problema(s):\n- ` + problems.join('\n- ') : '\nTUDO CERTO');
process.exit(problems.length ? 1 : 0);
