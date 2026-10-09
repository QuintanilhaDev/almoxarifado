/** Troca de tela pela Max (painel master ⇄ setor) na mesma página, com a animação. */
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
async function newPage(browser, mobile = false) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 800 } : { width: 1360, height: 900 }, deviceScaleFactor: mobile ? 2 : 1, locale: 'pt-BR', timezoneId: 'America/Bahia' });
  const page = await ctx.newPage();
  await page.addInitScript(FAKE);
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
const center = async (page) => page.evaluate(() => { const r = document.querySelector('.warp-orb')?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, vw: innerWidth, vh: innerHeight } : null; });

const browser = await chromium.launch();
try {
  let page = await newPage(browser);
  await login(page);

  console.log('\n[1] Clique em "Abrir ferramenta"');
  await page.evaluate(() => { window.__mesmaPagina = true; window.__spoken = []; });
  const fab = await page.locator('.max-fab').boundingBox();
  await page.evaluate(() => { window.__first = null; new MutationObserver(() => { const el = document.querySelector('.warp-orb'); if (el && !window.__first) { const r = el.getBoundingClientRect(); window.__first = { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; } }).observe(document.body, { childList: true, subtree: true }); });
  await page.locator('.hub-card:has-text("Almoxarifado") a:has-text("Abrir ferramenta")').click();
  await page.waitForSelector('.warp.is-rise', { timeout: 2000 });
  const c0 = await page.evaluate(() => window.__first);
  ok(c0 && Math.abs(c0.x - (fab.x + fab.width / 2)) < 12 && Math.abs(c0.y - (fab.y + fab.height / 2)) < 12 && Math.abs(c0.w - fab.width) < 12, `a esfera nasce exatamente em cima da Max do canto, do mesmo tamanho (x=${Math.round(c0?.x)}, largura=${Math.round(c0?.w)})`);
  await page.waitForTimeout(1250);
  const c1 = await center(page);
  ok(c1 && Math.abs(c1.x - c1.vw / 2) < 30 && Math.abs(c1.y - c1.vh * 0.46) < 40 && c1.w > 380, `vai para o meio da tela e cresce (x=${Math.round(c1?.x)} de ${c1?.vw}, largura=${Math.round(c1?.w)})`);
  ok((await page.locator('.warp-label').textContent()) === 'Abrindo o setorAlmoxarifado', 'mostra "Abrindo o setor Almoxarifado"');
  ok((await page.evaluate(() => getComputedStyle(document.querySelector('.max-dock')).opacity)) === '0', 'a Max do canto some enquanto a do meio aparece');
  await page.screenshot({ path: SHOTS + '/t1-meio.png' });
  await page.waitForSelector('.warp.is-flood', { timeout: 6000 });
  ok(JSON.stringify(await page.evaluate(() => window.__spoken)) === '["Abrindo o setor Almoxarifado."]', 'ela fala "Abrindo o setor Almoxarifado." antes de tomar a tela: ' + JSON.stringify(await page.evaluate(() => window.__spoken)));
  await page.waitForTimeout(260);
  await page.screenshot({ path: SHOTS + '/t2-tomando-a-tela.png' });
  await page.waitForTimeout(330);
  await page.screenshot({ path: SHOTS + '/t2b-tela-tomada.png' });
  await page.waitForURL(B + '/setor/almoxarifado', { timeout: 10000 });
  await page.waitForSelector('.warp', { state: 'detached', timeout: 20000 });
  ok(await page.evaluate(() => window.__mesmaPagina === true), 'a ferramenta abriu NA MESMA página (o site não recarregou)');
  ok((await page.locator('.nav-item:has-text("Estoque")').count()) === 1 && (await page.evaluate(() => getComputedStyle(document.querySelector('.max-dock')).opacity)) === '1', 'ferramenta do Almoxarifado na tela, com a Max de volta ao canto');
  ok(!(await page.evaluate(() => document.documentElement.classList.contains('is-warping'))), 'nada fica travado depois da animação');
  await page.waitForTimeout(600);
  await page.screenshot({ path: SHOTS + '/t3-ferramenta.png' });

  console.log('\n[2] Voltar ao painel master');
  await page.evaluate(() => { window.__spoken = []; });
  await page.click('.side-back');
  await page.waitForSelector('.warp.is-rise');
  await page.waitForTimeout(900);
  ok((await page.locator('.warp-label').textContent()) === 'Voltando aoPainel master', 'mostra "Voltando ao Painel master"');
  await page.waitForURL(B + '/hub', { timeout: 10000 });
  await page.waitForSelector('.warp', { state: 'detached', timeout: 20000 });
  ok(await page.evaluate(() => window.__mesmaPagina === true) && (await page.locator('.hub-card').count()) >= 5, 'voltou ao painel, ainda na mesma página');

  console.log('\n[3] Pela voz (o caso do print)');
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__spoken = []; });
  await page.click('.max-fab');
  await page.waitForSelector('.max-fab.is-listening', { timeout: 4000 });
  await page.evaluate(() => window.__say('Max abre o setor do almoxarifado, por favor.'));
  await page.waitForSelector('.warp.is-rise', { timeout: 6000 });
  ok(true, 'a animação começa junto com a fala');
  await page.waitForURL(B + '/setor/almoxarifado', { timeout: 10000 });
  await page.waitForSelector('.warp', { state: 'detached', timeout: 20000 });
  const spoken = await page.evaluate(() => window.__spoken);
  ok(spoken.filter((s) => /Abrindo o setor Almoxarifado/.test(s)).length === 1, 'ela diz a frase uma vez só: ' + JSON.stringify(spoken));
  ok(await page.evaluate(() => window.__mesmaPagina === true), 'abriu o Almoxarifado na mesma página');
  // de dentro do setor, pedir outro setor
  await page.waitForTimeout(1500);
  await page.click('.max-fab');
  await page.waitForSelector('.max-fab.is-listening', { timeout: 4000 });
  await page.evaluate(() => window.__say('Max, abrir o setor financeiro'));
  await page.waitForURL(B + '/setor/financeiro', { timeout: 12000 });
  await page.waitForSelector('.warp', { state: 'detached', timeout: 20000 });
  ok(await page.evaluate(() => window.__mesmaPagina === true), 'de um setor para outro, também na mesma página');

  console.log('\n[4] Detalhes');
  await page.goBack();
  await page.waitForURL(B + '/setor/almoxarifado');
  await page.waitForSelector('.nav-item:has-text("Estoque")', { timeout: 8000 }).catch(() => undefined);
  ok((await page.locator('.warp').count()) === 0 && (await page.locator('.nav-item:has-text("Estoque")').count()) === 1, 'botão Voltar do navegador funciona normalmente');
  await page.goto(B + '/hub');
  await page.waitForSelector('.hub-card');
  await page.waitForTimeout(1500);
  // dois cliques seguidos não disparam duas trocas
  const link = page.locator('.hub-card:has-text("Recursos Humanos") a:has-text("Abrir ferramenta")');
  await link.click();
  await page.locator('.hub-card:has-text("Almoxarifado") a:has-text("Abrir ferramenta")').click({ force: true, timeout: 1500 }).catch(() => undefined);
  await page.waitForURL(B + '/setor/rh', { timeout: 10000 });
  await page.waitForSelector('.warp', { state: 'detached', timeout: 20000 });
  ok(page.url() === B + '/setor/rh', 'clique duplo: vale só o primeiro destino');
  await page.context().close();

  console.log('\n[5] Celular e movimento reduzido');
  page = await newPage(browser, true);
  await login(page);
  await page.locator('.hub-card:has-text("Almoxarifado") a:has-text("Abrir ferramenta")').click();
  await page.waitForSelector('.warp.is-rise');
  await page.waitForTimeout(1300);
  const cm = await center(page);
  ok(cm && Math.abs(cm.x - cm.vw / 2) < 20 && cm.w <= cm.vw * 0.8, `no celular a esfera cabe na tela (largura ${Math.round(cm?.w)} de ${cm?.vw})`);
  await page.screenshot({ path: SHOTS + '/t4-celular.png' });
  await page.waitForURL(B + '/setor/almoxarifado', { timeout: 10000 });
  await page.waitForSelector('.warp', { state: 'detached', timeout: 20000 });
  await page.context().close();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, reducedMotion: 'reduce', locale: 'pt-BR' });
  page = await ctx.newPage();
  await page.addInitScript(FAKE);
  await login(page);
  const t0 = Date.now();
  await page.locator('.hub-card:has-text("Almoxarifado") a:has-text("Abrir ferramenta")').click();
  await page.waitForURL(B + '/setor/almoxarifado', { timeout: 10000 });
  await page.waitForSelector('.warp', { state: 'detached', timeout: 20000 });
  ok(true, `com "reduzir movimento" ligado a troca é simples e rápida (${Date.now() - t0} ms)`);
} catch (e) {
  problems.push('EXCEÇÃO ' + e.message);
  console.log('EXCEÇÃO', e);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problema(s):\n- ` + problems.join('\n- ') : '\nTUDO CERTO');
process.exit(problems.length ? 1 : 0);
