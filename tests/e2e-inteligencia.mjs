/**
 * Inteligência e aprendizado da Max, de ponta a ponta no navegador (banco e IA de teste).
 * NOMEM=1: confere que tudo funciona ANTES de rodar o supabase/max_aprendizado.sql.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const B = 'http://localhost:3100';
const DB = 'http://localhost:54321/rest/v1/';
const SHOTS = process.env.SHOTS || '/tmp/shots';
const NOMEM = process.env.NOMEM === '1';
const problems = [];
const ok = (cond, msg) => { if (!cond) { problems.push(msg); console.log('  ✗', msg); } else console.log('  ✓', msg); };
const llmCalls = async () => (await (await fetch('http://localhost:54322/')).json()).calls;
const table = async (t) => { const r = await fetch(DB + t + '?select=*'); return r.ok ? r.json() : null; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FAKE_SPEECH = `
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
  if (window.speechSynthesis) window.speechSynthesis.speak = (u) => { setTimeout(()=>{u.onstart&&u.onstart({}); setTimeout(()=>u.onend&&u.onend({}), 200);}, 20); };
`;
async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Bahia' });
  const page = await ctx.newPage();
  await page.addInitScript(FAKE_SPEECH);
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
  await page.waitForSelector('.nav-item');
  await page.waitForTimeout(1800);
}
async function ask(page, text) {
  if (!(await page.locator('.max-panel').count())) await page.click('.max-fab');
  else if (!(await page.locator('.max-fab.is-listening').count())) await page.click('.max-fab');
  await page.waitForSelector('.max-fab.is-listening', { timeout: 4000 });
  await page.evaluate((x) => window.__say(x), text);
  await page.waitForFunction((t) => { const m = [...document.querySelectorAll('.max-msg:not(.is-thinking):not(.is-interim)')]; const n = m.length; return n >= 2 && m[n - 1].classList.contains('max') && m[n - 2].classList.contains('you') && m[n - 2].textContent === t; }, text, { timeout: 12000 });
  await page.waitForTimeout(700);
  return (await page.locator('.max-msg.max > p').allTextContents()).pop() || '';
}
const lastSource = async (page) => (await page.locator('.max-msg.max').last().locator('.max-source').textContent().catch(() => '')) || '';

const browser = await chromium.launch();
try {
  let page = await newPage(browser);
  await login(page, 'neilton', '/setor/almoxarifado');

  console.log('\n[1] O caso do print: a IA diz que "não existe", mas a Max sabe responder');
  let before = await llmCalls();
  let r = await ask(page, 'Max, por favor, fale para mim qual o valor total que tem no estoque do almoxarifado?');
  ok(/^O estoque do almoxarifado vale 7\.155 reais, somando 177 unidades de 10 itens\./.test(r) && !/não existe/.test(r), r.slice(0, 100));
  ok((await page.locator('.max-msg.max').last().locator('.max-card').count()) === 1 && /R\$\s?[\d.]+,\d\d/.test(await page.locator('.max-msg.max').last().textContent()), 'o cartão mostra o valor em reais');
  ok((await llmCalls()) - before >= 2, 'a IA foi consultada e ganhou uma segunda chance antes de a resposta local valer');
  await page.screenshot({ path: SHOTS + '/i1-valor-total.png' });

  console.log('\n[2] Aprender com o uso');
  before = await llmCalls();
  r = await ask(page, 'Max, me diz quanta grana parada a gente tem em material');
  ok(/^O estoque do almoxarifado vale/.test(r) && (await llmCalls()) === before + 1, '1ª vez: a IA traduz o pedido para um comando da tela (1 chamada)');
  await wait(2500); // a memória é recarregada logo depois
  before = await llmCalls();
  r = await ask(page, 'Max, por favor, quanta grana parada temos em materiais?');
  if (NOMEM) {
    ok(/^O estoque do almoxarifado vale/.test(r) && (await llmCalls()) === before + 1, 'sem as tabelas de memória: funciona igual, só consulta a IA de novo');
  } else {
    ok(/^O estoque do almoxarifado vale/.test(r) && (await llmCalls()) === before, '2ª vez, dita de outro jeito: respondeu na hora, SEM chamar a IA');
    ok(/aprendido com o uso/.test(await lastSource(page)), 'a resposta indica que veio do aprendizado');
    let learned = await table('max_learned');
    ok(learned.some((l) => l.route === 'Max, qual o valor do estoque?' && /grana parada/.test(l.phrase) && l.sector === 'almoxarifado'), 'o aprendizado está gravado no banco');
    await page.screenshot({ path: SHOTS + '/i2-aprendido.png' });

    console.log('\n[3] 👍 / 👎');
    await page.locator('.max-msg.max').last().locator('.max-rate button[aria-label="Resposta errada"]').click();
    await page.waitForSelector('.max-rate.is-rated small:has-text("Anotado")');
    await wait(600);
    learned = await table('max_learned');
    const misses = await table('max_misses');
    ok(learned.some((l) => /grana parada/.test(l.phrase) && l.bad === 1), '👎 conta contra o aprendizado');
    ok(misses.some((m) => m.reason === 'negativo' && /grana parada temos/.test(m.phrase) && m.user_name === 'Neilton'), '👎 entra na lista do master');
    before = await llmCalls();
    r = await ask(page, 'Max, por favor, quanta grana parada temos em materiais?');
    ok((await llmCalls()) === before + 1, 'depois do 👎 a memória não é mais usada para esse pedido (volta a perguntar à IA)');
    await page.locator('.max-msg.max').last().locator('.max-rate button[aria-label="Resposta certa"]').click();
    await page.waitForSelector('.max-rate.is-rated small:has-text("Obrigada")');
    ok(true, '👍 registrado');

    console.log('\n[4] Ensinar uma anotação');
    r = await ask(page, 'Max, lembre que o fornecedor de botas é a Casa do Vigilante');
    ok(/^Vou registrar: anotação na minha memória: "O fornecedor de botas é a Casa do Vigilante\."\. Confirma\?/.test(r), r.slice(0, 110));
    ok((await table('max_notes')).length === 0, 'nada é guardado antes do "sim"');
    r = await ask(page, 'sim');
    ok(/^Pronto: anotação na minha memória/.test(r), r.slice(0, 70));
    const notes = await table('max_notes');
    ok(notes.length === 1 && notes[0].sector === 'almoxarifado' && notes[0].created_by === 'Neilton', 'anotação gravada para o setor');
    await wait(300);
    r = await ask(page, 'Max, quem fornece as botas para a gente?');
    ok(/Casa do Vigilante/.test(r), 'a IA passa a usar a anotação: ' + r.slice(0, 70));
  }
  r = await ask(page, 'Max, zzz qwerty asdfgh');
  ok(/Ainda não sei responder/.test(r), 'pedido sem sentido: admite e oferece ajuda');
  await page.context().close();

  console.log('\n[5] Juliana não pode ensinar nem ver o painel');
  page = await newPage(browser);
  await login(page, 'juliana', '/setor/almoxarifado');
  let res = await page.evaluate(async () => { const r = await fetch('/api/max/memoria', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'nota', text: 'Informação falsa plantada', sector: 'almoxarifado' }) }); return r.status; });
  ok(res === 403, 'anotação direta pela API é recusada (403)');
  res = await page.evaluate(async () => (await fetch('/api/max/memoria?painel=1')).status);
  ok(res === 403, 'painel de aprendizado é só do master (403)');
  res = await page.evaluate(async () => (await fetch('/api/max/memoria', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'aprendido', id: 'todas' }) })).status);
  ok(res === 403, 'apagar aprendizado é só do master (403)');
  res = await page.evaluate(async () => { const r = await fetch('/api/max/memoria?scope=hub&sector=rh'); return r.json(); });
  ok(Array.isArray(res.learned) && (NOMEM || res.learned.every((l) => !/usuario/.test(l.route || ''))), 'pedir a memória de outra tela devolve só a do próprio setor');
  await page.context().close();

  console.log('\n[6] Painel master: Aprendizado da Max');
  page = await newPage(browser);
  await login(page, 'mateus', '/hub');
  await page.click('.nav-item:has-text("Aprendizado da Max")');
  await page.waitForSelector('.learn-block');
  await page.waitForTimeout(800);
  if (NOMEM) {
    ok(await page.locator('.banner:has-text("max_aprendizado.sql")').isVisible(), 'sem as tabelas: o painel explica como ativar, sem erro');
  } else {
    ok(/“.*zzz qwerty asdfgh.*”/.test(await page.locator('.learn-block').first().textContent()), 'lista o pedido que ela não entendeu');
    ok(/marcada como errada/.test(await page.locator('.learn-block').first().textContent()), 'lista o 👎');
    ok(/Casa do Vigilante/.test(await page.locator('.learn-block').nth(1).textContent()), 'lista a anotação ensinada');
    ok(/grana parada/.test(await page.locator('.learn-block').nth(2).textContent()) && /comando “Max, qual o valor do estoque\?”/.test(await page.locator('.learn-block').nth(2).textContent()), 'lista o que ela aprendeu');
    await page.screenshot({ path: SHOTS + '/i3-painel-aprendizado.png', fullPage: true });
    const n0 = await page.locator('.learn-block').nth(1).locator('.learn-row').count();
    await page.locator('.learn-block').nth(1).locator('.learn-row .icon-btn').first().click();
    await page.waitForFunction((n) => document.querySelectorAll('.learn-block')[1].querySelectorAll('.learn-row').length === n - 1, n0, { timeout: 5000 });
    ok((await table('max_notes')).length === 0, 'master apaga a anotação');
    await page.click('button:has-text("Limpar lista")');
    await page.waitForSelector('.learn-block >> nth=0 >> .empty-line', { timeout: 5000 });
    ok((await table('max_misses')).length === 0, 'master limpa a lista de não atendidos');
    await page.click('.nav-item:has-text("Setores")');
    r = await ask(page, 'Max, abrir aprendizado da Max');
    ok(/Abrindo Aprendizado/.test(r), 'a Max abre a aba pelo nome: ' + r);
  }
} catch (e) {
  problems.push('EXCEÇÃO ' + e.message);
  console.log('EXCEÇÃO', e);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problema(s):\n- ` + problems.join('\n- ') : '\nTUDO CERTO');
process.exit(problems.length ? 1 : 0);
