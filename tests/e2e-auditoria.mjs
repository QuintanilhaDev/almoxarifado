/**
 * Auditoria ao vivo + modo claro/escuro.
 * O master deixa a aba Auditoria aberta; outra pessoa entra, abre telas e faz alterações;
 * tudo aparece na tela do master sozinho (sem apertar nada).
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
  class FakeRec { constructor(){ window.__recs.push(this); } start(){ this._on=true; setTimeout(()=>this.onstart&&this.onstart(),10); } stop(){ this._end(); } abort(){ this._end(); }
    _end(){ if(!this._on) return; this._on=false; setTimeout(()=>this.onend&&this.onend(),10); }
    _say(t){ if(!this._on) return false; const r=[{transcript:t,confidence:.9}]; r.isFinal=true; this.onresult&&this.onresult({resultIndex:0,results:[r]}); return true; } }
  window.webkitSpeechRecognition = FakeRec; window.SpeechRecognition = FakeRec;
  window.__say = (t) => window.__recs.some((r) => r._say(t));
  if (window.speechSynthesis) window.speechSynthesis.speak = (u) => { setTimeout(()=>{u.onstart&&u.onstart({}); setTimeout(()=>u.onend&&u.onend({}), 200);}, 20); };
`;
async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Bahia' });
  const page = await ctx.newPage();
  await page.addInitScript(FAKE);
  page.on('pageerror', (e) => { problems.push('pageerror: ' + e.message); console.log('  ! pageerror', e.message); });
  return page;
}
async function login(page, user, url, pass = '123456') {
  await page.goto(B + '/');
  await page.fill('#user', user);
  await page.fill('#pass', pass);
  await page.click('button[type=submit]');
  if (url) {
    await page.waitForURL(B + url + '**', { timeout: 20000 });
    await page.waitForTimeout(1500);
  }
}
async function ask(page, text) {
  await page.waitForFunction(() => !document.querySelector('.mr.is-on') && !document.documentElement.classList.contains('max-away'), null, { timeout: 20000 });
  if (!(await page.locator('.max-fab.is-listening').count())) await page.click('.max-fab');
  await page.waitForSelector('.max-fab.is-listening', { timeout: 4000 });
  await page.evaluate((t) => window.__say(t), text);
  await page.waitForFunction((t) => { const m = [...document.querySelectorAll('.max-msg:not(.is-thinking):not(.is-interim)')]; const n = m.length; return n >= 2 && m[n - 1].classList.contains('max') && m[n - 2].classList.contains('you') && m[n - 2].textContent === t; }, text, { timeout: 10000 });
  await page.waitForTimeout(500);
}
const seen = (page, re) => page.waitForFunction((src) => [...document.querySelectorAll('.au-row')].some((r) => new RegExp(src).test(r.textContent)), re.source, { timeout: 15000 }).then(() => true, () => false);

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  console.log('\n[1] Master com a Auditoria aberta');
  const master = await newPage(browser);
  await login(master, 'mateus', '/hub');
  await master.click('.nav-item[data-tab="auditoria"]');
  await master.waitForSelector('.au-stats', { timeout: 10000 });
  ok(await seen(master, /Mateus Quintanilha.*Entrou no Max Hub/), 'o próprio login do master já aparece');

  console.log('\n[2] Outra pessoa usa a plataforma (o master não toca em nada)');
  const other = await newPage(browser);
  await login(other, 'neilton', null, 'senhaerrada');
  await other.waitForTimeout(800);
  ok(await seen(master, /Tentou entrar com a senha errada/), 'senha errada aparece sozinha');
  await login(other, 'neilton', '/setor/almoxarifado');
  ok(await seen(master, /Neilton.*Entrou no Max Hub/), 'login do Neilton aparece sozinho');
  await other.click('.nav-item[data-tab="estoque"]');
  ok(await seen(master, /Neilton.*Abriu Estoque/), 'tela aberta aparece (Abriu Estoque)');
  await ask(other, 'Max, entrada de 2 bonés');
  ok(await seen(master, /Pediu à Max: “entrada de 2 bonés”/), 'pedido à Max aparece');
  await ask(other, 'sim');
  ok(await seen(master, /Registrou uma entrada no estoque.*qtd\. 2/), 'a alteração aparece com o detalhe (entrada, qtd. 2)');
  const before = await master.locator('.au-row').count();
  await master.click('.au-kinds button:has-text("Alterações")');
  await master.waitForTimeout(700);
  ok((await master.locator('.au-row').count()) < before && (await master.locator('.au-row').first().textContent()).includes('Registrou'), 'filtro "Alterações" mostra só alterações');
  await master.screenshot({ path: SHOTS + '/au1-auditoria.png' });
  await master.click('.au-kinds button:has-text("Tudo")');

  console.log('\n[3] Modo claro / escuro');
  ok((await master.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'começa no escuro');
  await master.click('.side-foot .theme-btn');
  await master.waitForTimeout(1500);
  await master.screenshot({ path: SHOTS + '/au2-onda.png' });
  await master.waitForTimeout(3200);
  ok((await master.evaluate(() => document.documentElement.dataset.theme)) === 'light' && (await master.evaluate(() => localStorage.getItem('maxhub-theme'))) === 'light', 'mudou para o claro e guardou a escolha');
  await master.reload();
  await master.waitForTimeout(1200);
  ok((await master.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'recarregando, continua claro');
  await master.screenshot({ path: SHOTS + '/au3-claro.png' });
  await master.click('.side-foot .theme-btn');
  await master.waitForTimeout(4600);
  ok((await master.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'e volta para o escuro');
} catch (e) {
  problems.push('EXCEÇÃO ' + e.message);
  console.log('EXCEÇÃO', e);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problema(s):\n- ` + problems.join('\n- ') : '\nTUDO CERTO');
process.exit(problems.length ? 1 : 0);
