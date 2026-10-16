/** Troca de tela: pelo clique (direto) e pela Max (ela corre até o botão e dá um soquinho). */
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
  if (window.speechSynthesis) window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); setTimeout(()=>{u.onstart&&u.onstart({}); setTimeout(()=>u.onend&&u.onend({}), 900);}, 20); };
`;
const HITS = `
  window.__hits = [];
  const seen = new Set();
  new MutationObserver((ms) => { for (const m of ms) { const t = m.target; if (t.classList && t.classList.contains('max-hit') && !(m.oldValue || '').includes('max-hit') && !seen.has(t)) { seen.add(t); setTimeout(() => seen.delete(t), 300); window.__hits.push(t.getAttribute('data-tab') || t.getAttribute('data-max') || t.getAttribute('data-testid') || t.getAttribute('href') || ''); } } })
    .observe(document, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
`;
async function newPage(browser, mobile = false) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 800 } : { width: 1360, height: 900 }, deviceScaleFactor: mobile ? 2 : 1, locale: 'pt-BR', timezoneId: 'America/Bahia' });
  const page = await ctx.newPage();
  await page.addInitScript(FAKE);
  await page.addInitScript(HITS);
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|ERR_CONNECTION|Failed to load resource|fonts\.g/i.test(m.text())) { problems.push('console: ' + m.text().slice(0, 200)); console.log('  ! console', m.text().slice(0, 200)); } });
  page.on('pageerror', (e) => { problems.push('pageerror: ' + e.message); console.log('  ! pageerror', e.message); });
  return page;
}
async function login(page) {
  await page.goto(B + '/');
  await page.fill('#user', 'mateus');
  await page.fill('#pass', '123456');
  await page.click('button[type=submit]');
  await page.waitForURL(B + '/hub', { timeout: 20000 });
  await page.waitForSelector('.hub-card');
  await page.waitForTimeout(1800);
}
const hits = (page) => page.evaluate(() => { const h = window.__hits; window.__hits = []; return h; });
const settled = async (page) => {
  await page.waitForFunction(() => !document.querySelector('.mr.is-on') && !document.documentElement.classList.contains('max-away'), null, { timeout: 20000 });
};
async function say(page, text) {
  await page.waitForFunction(() => !document.documentElement.classList.contains('max-away'), null, { timeout: 20000 });
  if (!(await page.locator('.max-fab.is-listening').count())) await page.click('.max-fab');
  await page.waitForSelector('.max-fab.is-listening', { timeout: 4000 });
  await page.evaluate((t) => window.__say(t), text);
}

const browser = await chromium.launch();
try {
  let page = await newPage(browser);
  await login(page);

  console.log('\n[1] Clique em "Abrir ferramenta" troca direto');
  await page.evaluate(() => { window.__mesmaPagina = true; });
  await page.locator('.hub-card:has-text("Almoxarifado") a:has-text("Abrir ferramenta")').click();
  await page.waitForURL(B + '/setor/almoxarifado', { timeout: 10000 });
  await page.waitForSelector('.nav-item:has-text("Estoque")', { timeout: 8000 });
  ok(await page.evaluate(() => window.__mesmaPagina === true), 'a ferramenta abriu na mesma página (o site não recarregou)');
  ok((await page.locator('.mr.is-on').count()) === 0, 'no clique a Max não sai correndo');
  await page.click('.side-back');
  await page.waitForURL(B + '/hub', { timeout: 10000 });
  await page.waitForSelector('.hub-card');
  ok(await page.evaluate(() => window.__mesmaPagina === true), 'voltou ao painel, ainda na mesma página');

  console.log('\n[2] Pela voz: ela corre até o card e dá um soquinho');
  await page.waitForTimeout(1200);
  await hits(page);
  await page.evaluate(() => { window.__spoken = []; });
  await say(page, 'Max abre o setor do almoxarifado, por favor.');
  await page.waitForSelector('.mr.is-on', { state: 'attached', timeout: 6000 });
  ok(true, 'bracinhos e perninhas aparecem e ela sai do canto');
  ok(await page.evaluate(() => document.documentElement.classList.contains('max-away')), 'a Max do canto fica escondida enquanto ela corre');
  await page.waitForTimeout(700);
  await page.screenshot({ path: SHOTS + '/t1-correndo.png' });
  ok(page.url() === B + '/hub', 'a tela só troca depois do soquinho');
  await page.waitForURL(B + '/setor/almoxarifado', { timeout: 12000 });
  await settled(page);
  let h = await hits(page);
  ok(JSON.stringify(h) === '["/setor/almoxarifado"]', 'socou exatamente o botão do Almoxarifado: ' + JSON.stringify(h));
  const spoken = await page.evaluate(() => window.__spoken);
  ok(spoken.filter((s) => /Abrindo o setor Almoxarifado/.test(s)).length === 1, 'ela diz a frase uma vez só: ' + JSON.stringify(spoken));
  ok(await page.evaluate(() => window.__mesmaPagina === true), 'abriu o Almoxarifado na mesma página');
  ok((await page.locator('.max-fab').isVisible()), 'depois ela volta para o canto');
  await page.screenshot({ path: SHOTS + '/t2-depois.png' });

  console.log('\n[3] De um setor para outro: dois botões');
  await page.waitForTimeout(1200);
  await say(page, 'Max, abrir o setor financeiro');
  await page.waitForURL(B + '/setor/financeiro', { timeout: 15000 });
  await settled(page);
  h = await hits(page);
  ok(JSON.stringify(h) === '["/hub","/setor/financeiro"]', 'socou "Painel master" e depois o card do Financeiro: ' + JSON.stringify(h));
  ok(await page.evaluate(() => window.__mesmaPagina === true), 'de um setor para outro, também na mesma página');

  console.log('\n[4] Abas: ela soca o item do menu');
  await page.goto(B + '/setor/almoxarifado');
  await page.waitForSelector('.nav-item[data-tab="estoque"]');
  await page.waitForTimeout(1500);
  await hits(page);
  await say(page, 'Max, abrir o estoque');
  await page.waitForSelector('.nav-item[data-tab="estoque"].is-active', { timeout: 12000 });
  await settled(page);
  h = await hits(page);
  ok(JSON.stringify(h) === '["estoque"]', 'socou o item Estoque do menu: ' + JSON.stringify(h));

  console.log('\n[4b] Downloads: ela soca a aba e o botão de baixar');
  await page.goto(B + '/hub');
  await page.waitForSelector('.hub-card');
  await page.waitForTimeout(1500);
  await hits(page);
  let dlP = page.waitForEvent('download', { timeout: 25000 });
  await say(page, 'Max, baixar o PDF da Gestão');
  let dl = await dlP.catch(() => null);
  await settled(page);
  h = await hits(page);
  ok(Boolean(dl) && /\.pdf$/.test(dl.suggestedFilename()), 'PDF da Gestão baixado: ' + dl?.suggestedFilename());
  ok(h.length === 2 && h[0] === 'gestao' && h[1] === 'gestao-pdf', 'socou a aba Gestão e depois o botão PDF: ' + JSON.stringify(h));
  dlP = page.waitForEvent('download', { timeout: 25000 });
  await say(page, 'Max, baixar a planilha da gestão');
  dl = await dlP.catch(() => null);
  await settled(page);
  h = await hits(page);
  ok(Boolean(dl) && /\.xlsx$/.test(dl.suggestedFilename()) && JSON.stringify(h) === JSON.stringify(['gestao-xlsx']), 'aba já aberta: socou só o botão Excel: ' + JSON.stringify(h) + ' ' + dl?.suggestedFilename());
  dlP = page.waitForEvent('download', { timeout: 30000 });
  await say(page, 'Max, baixar a planilha das métricas do almoxarifado');
  dl = await dlP.catch(() => null);
  await settled(page);
  h = await hits(page);
  ok(Boolean(dl) && /\.xlsx$/.test(dl.suggestedFilename()), 'planilha das métricas baixada: ' + dl?.suggestedFilename());
  ok(JSON.stringify(h) === JSON.stringify(['setores', '/setor/almoxarifado', 'metricas', 'dl-xlsx']), 'do painel (aba Gestão aberta): aba Setores, card do Almoxarifado, aba Métricas e o botão: ' + JSON.stringify(h));
  await page.waitForTimeout(800);
  dlP = page.waitForEvent('download', { timeout: 12000 });
  await say(page, 'Max, baixar a planilha dos pedidos de material');
  dl = await dlP.catch(() => null);
  await settled(page);
  h = await hits(page);
  const last = await page.evaluate(() => [...document.querySelectorAll('.max-msg.max')].pop()?.textContent || '');
  if (/não há pedidos/.test(last)) ok(h.length === 0 && !dl, 'sem pedidos: ela avisa e não sai correndo à toa');
  else ok(Boolean(dl) && /\.xlsx$/.test(dl.suggestedFilename()) && JSON.stringify(h) === JSON.stringify(['pedidos', 'pedidos-xlsx']), 'planilha dos pedidos: socou a aba Pedidos e o botão: ' + JSON.stringify(h) + ' ' + dl?.suggestedFilename());

  console.log('\n[5] Detalhes');
  await page.goBack();
  await page.waitForTimeout(800);
  ok((await page.locator('.mr.is-on').count()) === 0, 'botão Voltar do navegador funciona normalmente');
  await page.goto(B + '/hub');
  await page.waitForSelector('.hub-card');
  await page.waitForTimeout(1500);
  await page.locator('.hub-card:has-text("Recursos Humanos") a:has-text("Abrir ferramenta")').click();
  await page.locator('.hub-card:has-text("Almoxarifado") a:has-text("Abrir ferramenta")').click({ force: true, timeout: 1500 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  ok(/\/setor\/(rh|almoxarifado)$/.test(page.url()), 'clique duplo não quebra a troca: ' + page.url());
  await page.context().close();

  console.log('\n[6] Setor Compras');
  page = await newPage(browser);
  await login(page);
  ok((await page.locator('.hub-card').count()) === 6 && (await page.locator('.hub-card:has-text("Compras")').count()) === 1, 'o painel master mostra o setor Compras (6 setores)');
  await page.locator('.hub-card:has-text("Compras") a:has-text("Abrir ferramenta")').click();
  await page.waitForURL(B + '/setor/compras', { timeout: 10000 });
  await page.waitForSelector('.section-head h1:has-text("Painel de Compras")', { timeout: 8000 });
  ok(true, 'a ferramenta do setor Compras abre no Painel de Compras');
  await page.context().close();

  console.log('\n[7] Celular');
  page = await newPage(browser, true);
  await login(page);
  await page.waitForTimeout(800);
  await say(page, 'Max, abrir o almoxarifado');
  await page.waitForSelector('.mr.is-on', { state: 'attached', timeout: 6000 });
  await page.waitForTimeout(600);
  const box = await page.evaluate(() => { const r = document.querySelector('.mr-body').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; });
  ok(box.l > -40 && box.r < box.w + 40, `no celular ela corre dentro da tela (${Math.round(box.l)}–${Math.round(box.r)} de ${box.w})`);
  await page.screenshot({ path: SHOTS + '/t3-celular.png' });
  await page.waitForURL(B + '/setor/almoxarifado', { timeout: 15000 });
  await settled(page);
  h = await hits(page);
  ok(h.includes('/setor/almoxarifado'), 'no celular também soca o card certo: ' + JSON.stringify(h));
} catch (e) {
  problems.push('EXCEÇÃO ' + e.message);
  console.log('EXCEÇÃO', e);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problema(s):\n- ` + problems.join('\n- ') : '\nTUDO CERTO');
process.exit(problems.length ? 1 : 0);
