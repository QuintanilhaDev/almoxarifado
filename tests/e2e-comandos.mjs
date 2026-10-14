/**
 * Comandos da Max de ponta a ponta no navegador (banco de teste):
 * ela entende o pedido do jeito que se fala, corre até os botões certos (até em outro setor)
 * e só altera alguma coisa depois do "sim".
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
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
  window.__spoken = [];
  if (window.speechSynthesis) window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); setTimeout(()=>{u.onstart&&u.onstart({}); setTimeout(()=>u.onend&&u.onend({}), 300);}, 20); };
  window.__hits = [];
  const seen = new Set();
  new MutationObserver((ms) => { for (const m of ms) { const t = m.target; if (t.classList && t.classList.contains('max-hit') && !(m.oldValue || '').includes('max-hit') && !seen.has(t)) { seen.add(t); setTimeout(() => seen.delete(t), 300); window.__hits.push(t.getAttribute('data-tab') || t.getAttribute('data-max') || (t.id ? '#' + t.id : '') || t.getAttribute('href') || ''); } } })
    .observe(document, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
`;
async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Bahia' });
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
const settled = (page) => page.waitForFunction(() => !document.querySelector('.mr.is-on') && !document.documentElement.classList.contains('max-away'), null, { timeout: 25000 });
async function ask(page, text) {
  await settled(page);
  if (!(await page.locator('.max-fab.is-listening').count())) await page.click('.max-fab');
  await page.waitForSelector('.max-fab.is-listening', { timeout: 4000 });
  await page.evaluate(() => { window.__hits = []; });
  await page.evaluate((t) => window.__say(t), text);
  await page.waitForFunction((t) => { const m = [...document.querySelectorAll('.max-msg:not(.is-thinking):not(.is-interim)')]; const n = m.length; return n >= 2 && m[n - 1].classList.contains('max') && m[n - 2].classList.contains('you') && m[n - 2].textContent === t; }, text, { timeout: 10000 });
  await page.waitForTimeout(500);
  await settled(page);
  return page.evaluate(() => [...document.querySelectorAll('.max-msg.max')].pop()?.textContent || '');
}
const hits = (page) => page.evaluate(() => window.__hits);
const stockOf = (page, name, size) => page.evaluate(async ([n, s]) => (await (await fetch('/api/almoxarifado/stock')).json()).items.find((i) => i.name === n && (i.size ?? null) === s)?.quantity, [name, size]);

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  let page = await newPage(browser);
  await login(page, 'mateus', '/hub');

  console.log('\n[1] O caso do print: dentro de um setor, "cadastrar usuário no setor recursos humanos"');
  await page.goto(B + '/setor/almoxarifado');
  await page.waitForSelector('.nav-item[data-tab="estoque"]');
  await page.waitForTimeout(1500);
  let r = await ask(page, 'Max, cadastrar usuário no setor recursos humanos');
  await page.waitForURL(B + '/hub**', { timeout: 15000 });
  const said = await page.evaluate(() => window.__spoken.join(' | '));
  ok(/Abrindo o cadastro de usuário, já no setor Recursos Humanos/.test(said), 'ela entende e não explica outra coisa: ' + said.slice(0, 90));
  await page.waitForSelector('#hu-sector', { timeout: 10000 });
  ok((await page.inputValue('#hu-sector')) === 'rh', 'cadastro aberto já no setor RH');
  const h1 = await hits(page);
  ok(h1.includes('/hub') && h1.includes('usuario-novo'), 'correu: Painel master → Usuários → Novo usuário: ' + JSON.stringify(h1));
  await page.screenshot({ path: SHOTS + '/c1-usuario.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  console.log('\n[2] De outro setor direto para uma aba: "abrir o estoque do almoxarifado"');
  r = await ask(page, 'Max, me leva no estoque do almoxarifado');
  await page.waitForURL(B + '/setor/almoxarifado**', { timeout: 15000 });
  await page.waitForSelector('.nav-item[data-tab="estoque"].is-active', { timeout: 10000 });
  ok(true, 'abriu o Almoxarifado já na aba Estoque');

  console.log('\n[3] Alterações com confirmação');
  const before = await stockOf(page, 'Bota de segurança', '42');
  r = await ask(page, 'Max, chegaram dez botas 42');
  ok(/^Vou registrar: entrada de 10 unidades de Bota de segurança 42\. Confirma\?/.test(r), 'entrada entendida (dez → 10, 42 é tamanho): ' + r.slice(0, 80));
  ok((await stockOf(page, 'Bota de segurança', '42')) === before, 'nada gravado antes do "sim"');
  r = await ask(page, 'sim');
  ok(/^Pronto: entrada de 10 unidades/.test(r) && (await stockOf(page, 'Bota de segurança', '42')) === before + 10, 'depois do "sim", o saldo subiu 10');

  r = await ask(page, 'Max, saída de bota 40');
  ok(/^Quantas unidades de Bota de segurança 40\?/.test(r), 'faltou a quantidade: ela pergunta');
  const b40 = await stockOf(page, 'Bota de segurança', '40');
  r = await ask(page, 'duas');
  ok(/^Vou registrar: saída de 2 unidades de Bota de segurança 40/.test(r), '"duas" completa o pedido: ' + r.slice(0, 70));
  r = await ask(page, 'confirmo');
  ok((await stockOf(page, 'Bota de segurança', '40')) === b40 - 2, 'saldo da bota 40 caiu 2');

  r = await ask(page, 'Max, manda 3 camisas G pro posto 01');
  ok(/^Vou registrar: envio ao Posto 01 de 3 unidades de Camisa social manga curta G/.test(r), 'envio ao posto: ' + r.slice(0, 80));
  r = await ask(page, 'não');
  ok(/não alterei nada/.test(r), '"não" cancela');

  console.log('\n[4] Botões das telas');
  r = await ask(page, 'Max, classificar os itens');
  await page.waitForSelector('.modal', { timeout: 8000 });
  ok((await hits(page)).includes('estoque-classificar'), 'socou "Classificar" e a classificação abriu');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  r = await ask(page, 'Max, importar o xml da nota');
  await page.waitForSelector('.max-filepick', { timeout: 8000 });
  ok(JSON.stringify(await hits(page)) === JSON.stringify(['notas', 'nota-importar']), 'socou Entradas → Importar XML e mostrou o "Escolher arquivo"');
  await page.screenshot({ path: SHOTS + '/c2-xml.png' });
  await page.click('.max-filepick-x');
  r = await ask(page, 'Max, quero fazer um pedido de compra');
  await page.waitForSelector('.modal', { timeout: 8000 });
  ok(JSON.stringify(await hits(page)) === JSON.stringify(['compras', 'compra-nova']), 'nova solicitação de compra aberta');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  console.log('\n[5] Usuários e perguntas');
  r = await ask(page, 'Max, desativar o usuário da Juliana');
  ok(/^Vou registrar: alteração de Juliana Souza \(@juliana\): acesso DESATIVADO\. Confirma\?/.test(r), 'desativar usuário (de dentro de um setor): ' + r.slice(0, 80));
  r = await ask(page, 'não');
  r = await ask(page, 'Max, quanto tem de bota 42');
  ok(/13 unidades/.test(r), 'pergunta continua sendo pergunta: ' + r.slice(0, 60));
  r = await ask(page, 'Max, como faço inventário');
  ok(!/^Vou registrar|^Abrindo o inventário/.test(r), '"como faço" explica em vez de executar');
  await page.context().close();

  console.log('\n[6] RH');
  page = await newPage(browser);
  await login(page, 'carla', '/setor/rh');
  r = await ask(page, 'Max, nova admissão');
  await page.waitForSelector('.modal', { timeout: 8000 });
  ok((await hits(page)).includes('pedido-novo'), 'nova admissão: socou "Novo pedido do RH" e abriu o pedido');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  r = await ask(page, 'Max, cadastrar um colaborador');
  await page.waitForSelector('.modal', { timeout: 8000 });
  ok(JSON.stringify(await hits(page)) === JSON.stringify(['colaboradores', 'colab-novo']), 'novo colaborador: aba Colaboradores → Novo colaborador');
  await page.screenshot({ path: SHOTS + '/c3-rh.png' });
} catch (e) {
  problems.push('EXCEÇÃO ' + e.message);
  console.log('EXCEÇÃO', e);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problema(s):\n- ` + problems.join('\n- ') : '\nTUDO CERTO');
process.exit(problems.length ? 1 : 0);
