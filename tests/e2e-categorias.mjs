/**
 * Categorias do estoque, de ponta a ponta no navegador (banco de teste).
 * NOCAT=1: confere que tudo segue funcionando ANTES de rodar o supabase/categorias.sql.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const B = 'http://localhost:3100';
const SHOTS = process.env.SHOTS || '/tmp/shots';
const NOCAT = process.env.NOCAT === '1';
const problems = [];
const ok = (cond, msg) => { if (!cond) { problems.push(msg); console.log('  ✗', msg); } else console.log('  ✓', msg); };

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
async function newPage(browser, mobile = false) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 800 } : { width: 1360, height: 900 }, deviceScaleFactor: mobile ? 2 : 1, locale: 'pt-BR', timezoneId: 'America/Bahia' });
  const page = await ctx.newPage();
  await page.addInitScript(FAKE_SPEECH);
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|ERR_CONNECTION|Failed to load resource|fonts\.g/i.test(m.text())) { problems.push('console: ' + m.text().slice(0, 200)); console.log('  ! console', m.text().slice(0, 200)); } });
  page.on('pageerror', (e) => { problems.push('pageerror: ' + e.message); console.log('  ! pageerror', e.message); });
  return page;
}
async function login(page, user) {
  await page.goto(B + '/');
  await page.fill('#user', user);
  await page.fill('#pass', '123456');
  await page.click('button[type=submit]');
  await page.waitForURL(B + '/setor/almoxarifado', { timeout: 20000 });
  await page.waitForSelector('.nav-item');
  await page.waitForTimeout(1500);
  await page.click('.nav-item:has-text("Estoque")');
  await page.waitForSelector('.stock-row:not(.head)', { timeout: 10000 });
}
const stock = (page) => page.evaluate(async () => (await (await fetch('/api/almoxarifado/stock')).json()).items);
const patch = (page, id, json) => page.evaluate(async ([i, j]) => { const r = await fetch('/api/almoxarifado/stock/' + i, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(j) }); return { status: r.status, body: await r.json().catch(() => ({})) }; }, [id, json]);
const rows = (page) => page.locator('.stock-row:not(.head)').count();
const chips = async (page) => (await page.locator('.cat-bar .cat-chip').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
async function ask(page, text) {
  if (!(await page.locator('.max-panel').count())) await page.click('.max-fab');
  else if (!(await page.locator('.max-fab.is-listening').count())) await page.click('.max-fab');
  await page.waitForSelector('.max-fab.is-listening', { timeout: 4000 });
  await page.evaluate((x) => window.__say(x), text);
  await page.waitForFunction((t) => { const m = [...document.querySelectorAll('.max-msg:not(.is-thinking):not(.is-interim)')]; const n = m.length; return n >= 2 && m[n - 1].classList.contains('max') && m[n - 2].classList.contains('you') && m[n - 2].textContent === t; }, text, { timeout: 8000 });
  await page.waitForTimeout(700);
  return (await page.locator('.max-msg.max p').allTextContents()).pop() || '';
}

const browser = await chromium.launch();
try {
  let page = await newPage(browser);
  await login(page, 'neilton');

  if (NOCAT) {
    console.log('\n[banco SEM o categorias.sql] o estoque não pode parar');
    ok((await rows(page)) === 10, 'os 10 itens aparecem normalmente');
    ok(!(await page.locator('.cat-bar').count()), 'sem barra de categorias (ainda não há nenhuma)');
    const before = await stock(page);
    ok(before.every((i) => Array.isArray(i.categories) && i.categories.length === 0), 'API devolve categories: [] para todos');
    const cinto = before.find((i) => i.name === 'Cinto tático');
    let r = await patch(page, cinto.id, { categories: ['Max Forte'] });
    ok(r.status === 409 && /categorias\.sql/.test(r.body.error || ''), 'tentar categorizar avisa para rodar o SQL: ' + r.status + ' ' + (r.body.error || ''));
    r = await patch(page, cinto.id, { min_quantity: 3 });
    ok(r.status === 200, 'editar o mínimo continua funcionando');
    // entrada pelo sistema
    await page.click('.stock-row:has-text("Cinto tático")');
    await page.waitForSelector('.drawer');
    await page.click('.drawer .cat-chip:has-text("EPI")');
    await page.waitForSelector('.toast:has-text("Não foi possível salvar a categoria")', { timeout: 5000 }).then(() => ok(true, 'na tela, o erro aparece como aviso (sem quebrar)')).catch(() => ok(false, 'aviso de erro ao categorizar sem o SQL'));
    ok(!(await page.locator('.drawer .cat-chip.is-on').count()), 'a marcação volta atrás');
    await page.keyboard.press('Escape');
    await page.click('button:has-text("Novo item")');
    await page.fill('#it-name', 'Apito de teste');
    await page.click('button[type=submit]:has-text("Cadastrar item")');
    await page.waitForSelector('.modal', { state: 'detached', timeout: 6000 });
    ok((await stock(page)).some((i) => i.name === 'Apito de teste'), 'cadastrar item (sem categoria) funciona');
  } else {
    console.log('\n[1] Neilton: filtro por categoria');
    await page.waitForSelector('.cat-bar');
    let c = await chips(page);
    console.log('    ', c.join(' | '));
    ok(c.includes('Todas 10') && c.includes('Max Forte 5') && c.includes('Max Serviços 3') && c.includes('EPI 4') && c.includes('Acessório 1') && c.includes('Sem categoria 1'), 'chips com a contagem certa (um item conta em cada categoria que tem)');
    ok((await page.locator('.stock-row:has-text("Bota de segurança") .cat-tag').first().textContent()) === 'Max Forte', 'etiquetas aparecem na linha do item');
    await page.screenshot({ path: SHOTS + '/c1-estoque-categorias.png' });
    await page.click('.cat-bar .cat-chip:has-text("EPI")');
    ok((await rows(page)) === 4, 'EPI mostra 4 itens');
    ok(/Itens · EPI/.test(await page.locator('.stat small').first().textContent()) && (await page.locator('.stat b').first().textContent()) === '4', 'os números do topo acompanham a categoria');
    ok(/Estoque baixo\s*3/.test((await page.locator('.filter-seg button:has-text("Estoque baixo")').textContent()).replace(/\s+/g, ' ')), 'filtro de estoque baixo conta só dentro da categoria');
    await page.click('.filter-seg button:has-text("Sem saldo")');
    ok((await rows(page)) === 2, 'categoria + sem saldo combinam (2 itens)');
    await page.screenshot({ path: SHOTS + '/c2-epi-sem-saldo.png' });
    await page.click('.filter-seg button:has-text("Todos")');
    await page.click('.cat-bar .cat-chip:has-text("Sem categoria")');
    ok((await rows(page)) === 1 && /Rádio/.test(await page.locator('.stock-row:not(.head) b').first().textContent()), '"Sem categoria" mostra o que falta classificar');
    await page.click('.cat-bar .cat-chip:has-text("Todas")');
    await page.fill('.search input', 'acessorio');
    ok((await rows(page)) === 1, 'a busca também acha pela categoria');
    await page.fill('.search input', '');

    console.log('\n[2] Um item em duas categorias (o caso da Juliana)');
    const before = await stock(page);
    const cinto0 = before.find((i) => i.name === 'Cinto tático');
    const movs0 = await page.evaluate(async (id) => (await (await fetch('/api/almoxarifado/stock/' + id)).json()).movements.length, cinto0.id);
    await page.click('.stock-row:has-text("Cinto tático")');
    await page.waitForSelector('.drawer .cat-picker');
    ok((await page.locator('.drawer .cat-chip.is-on').allTextContents()).join() === 'Acessório', 'gaveta mostra a categoria atual marcada');
    await page.click('.drawer .cat-chip:has-text("Max Forte")');
    await page.waitForFunction(() => document.querySelectorAll('.stock-row .cat-tag').length && [...document.querySelectorAll('.stock-row')].find((r) => /Cinto/.test(r.textContent))?.querySelectorAll('.cat-tag').length === 2, null, { timeout: 6000 });
    let cinto = (await stock(page)).find((i) => i.name === 'Cinto tático');
    ok(cinto.categories.join() === 'Max Forte,Acessório', 'salvou as duas: ' + cinto.categories.join(' + '));
    ok(cinto.quantity === cinto0.quantity && cinto.min_quantity === cinto0.min_quantity && cinto.cost === cinto0.cost, 'saldo, mínimo e custo intocados');
    const movs1 = await page.evaluate(async (id) => (await (await fetch('/api/almoxarifado/stock/' + id)).json()).movements.length, cinto0.id);
    ok(movs1 === movs0, 'nenhuma movimentação criada no histórico');
    await page.fill('#drawer-cat-new', 'motociclista');
    await page.click('.drawer .cat-new button');
    await page.waitForSelector('.cat-bar .cat-chip:has-text("Motociclista")', { timeout: 6000 });
    ok(true, 'categoria nova criada na hora e já vira filtro');
    await page.waitForTimeout(400);
    await page.screenshot({ path: SHOTS + '/c3-gaveta-categorias.png' });
    await page.click('.drawer .cat-chip:has-text("Motociclista")');
    await page.waitForSelector('.cat-bar .cat-chip:has-text("Motociclista")', { state: 'detached', timeout: 6000 });
    ok(true, 'desmarcar remove; categoria sem itens some do filtro');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.drawer-overlay', { state: 'detached' });
    c = await chips(page);
    ok(c.includes('Max Forte 6') && c.includes('Acessório 1'), 'contagens atualizadas: ' + c.join(' | '));

    console.log('\n[3] Cadastro e validação');
    await page.click('.cat-bar .cat-chip:has-text("Max Confiável")').catch(() => undefined);
    await page.click('.cat-bar .cat-chip:has-text("Max Forte")');
    await page.click('button:has-text("Novo item")');
    await page.waitForSelector('.modal .cat-picker');
    ok((await page.locator('.modal .cat-chip.is-on').allTextContents()).join() === 'Max Forte', 'item novo já nasce na categoria filtrada');
    await page.fill('#it-name', 'Tonfa de teste');
    await page.click('.modal .cat-chip:has-text("Acessório")');
    await page.fill('#it-cat-new', 'Max forte'); // repetida com outra grafia: não duplica
    await page.keyboard.press('Enter');
    ok((await page.locator('.modal').count()) === 1, 'Enter no campo de categoria não envia o formulário');
    await page.screenshot({ path: SHOTS + '/c4-novo-item.png' });
    await page.click('button[type=submit]:has-text("Cadastrar item")');
    await page.waitForSelector('.modal', { state: 'detached', timeout: 6000 });
    const tonfa = (await stock(page)).find((i) => i.name === 'Tonfa de teste');
    ok(tonfa && tonfa.categories.join() === 'Max Forte,Acessório', 'cadastrado com as duas categorias, sem duplicar: ' + tonfa?.categories.join(' + '));
    let r = await patch(page, tonfa.id, { categories: ' epis ; MAX SERVIÇO / acessórios, acessorio' });
    const t2 = (await stock(page)).find((i) => i.id === tonfa.id);
    ok(r.status === 200 && t2.categories.join() === 'Max Serviços,EPI,Acessório', 'API normaliza grafias: ' + t2.categories.join(' + '));
    r = await patch(page, tonfa.id, { categories: 42 });
    ok(r.status === 400, 'categorias inválidas são recusadas');
    r = await patch(page, tonfa.id, { categories: [...Array.from({ length: 30 }, (_, i) => 'cat ' + i), 'y'.repeat(90)] });
    const t3 = (await stock(page)).find((i) => i.id === tonfa.id);
    ok(t3.categories.length === 8, 'no máximo 8 categorias por item');
    r = await patch(page, tonfa.id, { categories: ['y'.repeat(90)] });
    ok((await stock(page)).find((i) => i.id === tonfa.id).categories[0].length === 40, 'nome de categoria limitado a 40 letras');
    await patch(page, tonfa.id, { categories: [] });
    await page.reload();
    await page.waitForSelector('.nav-item');
    await page.waitForTimeout(1500);
    await page.click('.nav-item:has-text("Estoque")');
    await page.waitForSelector('.cat-bar');

    console.log('\n[4] Max');
    let a = await ask(page, 'Max, quanto temos de EPI?');
    ok(/^EPI tem 4 itens, com 15 unidades/.test(a), a.slice(0, 110));
    ok((await page.locator('.cat-bar .cat-chip.is-on').textContent()).startsWith('EPI'), 'a tela filtra a categoria pedida');
    a = await ask(page, 'Max, quais categorias existem no estoque?');
    ok(/dividido em 4 categorias: Max Forte com 6/.test(a), a.slice(0, 120));
    a = await ask(page, 'Max, o que está com estoque baixo na Max Forte?');
    ok(/estoque baixo em Max Forte/.test(a), a.slice(0, 110));
    ok((await page.locator('.cat-bar .cat-chip.is-on').textContent()).startsWith('Max Forte') && (await page.locator('.filter-seg button.is-active').last().textContent()).startsWith('Estoque baixo'), 'tela: Max Forte + estoque baixo');
    a = await ask(page, 'Max, resumo do estoque');
    ok(/11 itens cadastrados/.test(a) && (await page.locator('.cat-bar .cat-chip.is-on').textContent()).startsWith('Todas'), 'resumo geral volta para "Todas": ' + a.slice(0, 60));
    await page.keyboard.press('Escape');

    console.log('\n[5] Exportação');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Exportar")')]);
    const csv = require('node:fs').readFileSync(await dl.path(), 'utf8');
    ok(/Ref;Item;Tamanho;Categorias;Unidade/.test(csv) && /Cinto tático;;Max Forte, Acessório;Cada/.test(csv), 'CSV com a coluna Categorias');
    await page.context().close();

    console.log('\n[6] Juliana (só visualiza)');
    page = await newPage(browser);
    await login(page, 'juliana');
    ok((await page.locator('.cat-bar .cat-chip').count()) >= 5 && (await page.locator('.stock-row .cat-tag').count()) > 5, 'vê os filtros e as etiquetas');
    await page.click('.stock-row:has-text("Cinto tático")');
    await page.waitForSelector('.drawer');
    ok(!(await page.locator('.drawer .cat-picker').isVisible()) && (await page.locator('.drawer .readonly-only .cat-tag').allTextContents()).join() === 'Max Forte,Acessório', 'na gaveta só lê as categorias, sem botões');
    await page.screenshot({ path: SHOTS + '/c5-juliana.png' });
    const cid = (await stock(page)).find((i) => i.name === 'Cinto tático').id;
    r = await patch(page, cid, { categories: [] });
    ok(r.status === 403, 'servidor recusa a alteração dela (403)');
    await page.context().close();

    console.log('\n[7] Celular');
    page = await newPage(browser, true);
    await page.goto(B + '/');
    await page.fill('#user', 'neilton');
    await page.fill('#pass', '123456');
    await page.click('button[type=submit]');
    await page.waitForURL(B + '/setor/almoxarifado', { timeout: 20000 });
    await page.waitForTimeout(1800);
    await page.goto(B + '/setor/almoxarifado');
    await page.waitForTimeout(1500);
    await page.click('.tabbar .tab:has-text("Estoque")');
    await page.waitForSelector('.cat-bar', { timeout: 8000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(overflow <= 1, 'sem rolagem lateral no celular (sobra ' + overflow + 'px)');
    await page.screenshot({ path: SHOTS + '/c6-celular.png' });
    await page.click('.stock-row:has-text("Cinto tático")');
    await page.waitForSelector('.drawer .cat-picker');
    await page.waitForTimeout(500);
    await page.screenshot({ path: SHOTS + '/c7-celular-gaveta.png' });
  }
} catch (e) {
  problems.push('EXCEÇÃO ' + e.message);
  console.log('EXCEÇÃO', e);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problema(s):\n- ` + problems.join('\n- ') : '\nTUDO CERTO');
process.exit(problems.length ? 1 : 0);
