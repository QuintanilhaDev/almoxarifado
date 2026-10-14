/**
 * Almoxarifado ⇄ Compras, de ponta a ponta, com duas pessoas ao mesmo tempo (banco de teste).
 * NOCOMPRAS=1: banco sem o supabase/compras.sql — nada pode quebrar.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const B = 'http://localhost:3100';
const SHOTS = process.env.SHOTS || '/tmp/shots';
const NOCOMPRAS = process.env.NOCOMPRAS === '1';
const problems = [];
const ok = (cond, msg) => { if (!cond) { problems.push(msg); console.log('  ✗', msg); } else console.log('  ✓', msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
  window.__spoken = []; window.__chimes = 0;
  const AC = window.AudioContext; if (AC) { const o = AC.prototype.createOscillator; AC.prototype.createOscillator = function () { window.__chimes++; return o.call(this); }; }
  if (window.speechSynthesis) window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); setTimeout(()=>{u.onstart&&u.onstart({}); setTimeout(()=>u.onend&&u.onend({}), 2600);}, 20); };
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
const call = (page, method, url, json) => page.evaluate(async ([m, u, j]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: j === undefined ? undefined : JSON.stringify(j) }); return { status: r.status, body: await r.json().catch(() => ({})) }; }, [method, url, json]);

const browser = await chromium.launch();
try {
  // ---------- quem atende: Carlos (master de Compras) ----------
  const carlos = await newPage(browser);
  await login(carlos, 'carlos', '/setor/compras');
  console.log('\n[1] Carlos (Compras) abre a ferramenta');
  const nav = await carlos.locator('.side .nav-item span:not(.nav-count):not(.nav-bg)').allTextContents();
  ok(nav.join('|') === 'Solicitações|Fornecedores|Equipe|Minha conta', 'menu de Compras: ' + nav.join(' | '));
  if (NOCOMPRAS) {
    await carlos.waitForSelector('.empty:has-text("compras.sql")', { timeout: 8000 });
    ok(true, 'sem o SQL: a tela explica que falta rodar o compras.sql');
  } else {
    await carlos.waitForSelector('.empty:has-text("Nenhuma solicitação de compra ainda")', { timeout: 8000 });
    ok(true, 'lista vazia com explicação');
  }
  ok((await carlos.locator('.sound-note').count()) <= 1, 'antes do primeiro clique, a tela pede um clique para ligar som e voz');
  await carlos.click('.max-fab'); // um clique na página
  await carlos.waitForSelector('.sound-note', { state: 'detached', timeout: 3000 }).then(() => ok(true, 'o aviso some depois do clique')).catch(() => ok(false, 'aviso de som não sumiu')); // o navegador libera som e voz para os avisos
  await carlos.waitForTimeout(400);
  await carlos.click('.max-panel .icon-btn[aria-label="Fechar a Max"]');
  await carlos.evaluate(() => { window.__marker = 'sem-recarregar'; window.__spoken = []; window.__chimes = 0; });

  // ---------- quem pede: Neilton (master do Almoxarifado) ----------
  const neilton = await newPage(browser);
  await login(neilton, 'neilton', '/setor/almoxarifado');
  console.log('\n[2] Neilton (Almoxarifado) pede uma compra');
  await neilton.click('.nav-item:has-text("Compras")');
  // nada de consultas em excesso (laço de recarga): no máximo ~2 a cada 12 s parado
  let hits = 0;
  const count = (rq) => { if (rq.url().includes('/api/compras/requests')) hits++; };
  neilton.on('request', count);
  await wait(13000);
  neilton.off('request', count);
  ok(hits <= 3, `Almoxarifado parado: ${hits} consultas de compras em 13 s (sem laço)`);
  hits = 0;
  carlos.on('request', count);
  await wait(9000);
  carlos.off('request', count);
  ok(hits <= 3, `Compras parado: ${hits} consultas em 9 s (consulta periódica de 8 s)`);
  if (NOCOMPRAS) {
    await neilton.waitForSelector('.empty:has-text("compras.sql")', { timeout: 8000 });
    ok(true, 'Almoxarifado sem o SQL: explica, sem quebrar');
    await neilton.click('button:has-text("Nova solicitação de compra")');
    await neilton.fill('.p-line-item input', 'Lanterna');
    await neilton.click('button[type=submit]:has-text("Enviar para Compras")');
    await neilton.waitForSelector('.sx-error:has-text("compras.sql")', { timeout: 6000 });
    ok(true, 'enviar sem o SQL mostra o aviso de configuração');
    await neilton.keyboard.press('Escape');
    // o resto do Almoxarifado continua de pé
    await neilton.click('.nav-item:has-text("Estoque")');
    await neilton.waitForSelector('.stock-row:not(.head)');
    ok(true, 'o Estoque continua funcionando normalmente');
  } else {
    await neilton.click('button:has-text("Nova solicitação de compra")');
    await neilton.waitForSelector('.p-low');
    ok(/4 itens estão com estoque baixo/.test(await neilton.locator('.p-low').textContent()), 'o formulário sugere os itens com estoque baixo');
    // busca no estoque
    await neilton.fill('.p-line-item input', 'bota 42');
    await neilton.waitForSelector('.p-suggest button');
    ok((await neilton.locator('.p-suggest button').count()) === 1, 'busca "bota 42" acha só a Bota 42');
    await neilton.keyboard.press('Enter');
    ok((await neilton.locator('.p-line-hint').first().textContent()).startsWith('Do estoque · saldo 3'), 'item do estoque escolhido, com o saldo');
    ok((await neilton.locator('.p-line-qty').first().inputValue()) === '7', 'quantidade sugerida: o que falta para 2× o mínimo (7)');
    await neilton.locator('.p-line-qty').first().fill('20');
    // item novo, fora do estoque
    await neilton.click('button:has-text("Adicionar item")');
    await neilton.locator('.p-line-item input').nth(1).fill('Lanterna recarregável');
    await neilton.locator('.p-line-size').nth(1).fill('');
    await neilton.locator('.p-line-qty').nth(1).fill('5');
    ok((await neilton.locator('.p-line-hint').nth(1).textContent()) === 'Item novo (fora do estoque)', 'item novo é indicado como fora do estoque');
    // um item baixo pelo atalho
    await neilton.locator('.p-low-chips button:has-text("Colete refletivo")').click();
    ok((await neilton.locator('.p-line').count()) === 3, 'atalho de estoque baixo adiciona uma linha');
    await neilton.click('.filter-seg button:has-text("Urgente")');
    await neilton.fill('#p-reason', 'Reposição do estoque mínimo e novo posto.');
    await neilton.screenshot({ path: SHOTS + '/c1-nova-compra.png' });
    // validação: quantidade vazia
    await neilton.locator('.p-line-qty').nth(1).fill('');
    await neilton.click('button[type=submit]:has-text("Enviar para Compras")');
    await neilton.waitForSelector('.sx-error:has-text("Item 2")', { timeout: 5000 });
    ok(true, 'quantidade vazia é recusada, dizendo qual linha');
    await neilton.locator('.p-line-qty').nth(1).fill('5');
    const sentAt = Date.now();
    await neilton.click('button[type=submit]:has-text("Enviar para Compras")');
    await neilton.waitForSelector('.drawer:has-text("Solicitação #0001")', { timeout: 8000 });
    ok(true, 'enviada: abre o detalhe da #0001');
    ok((await neilton.locator('.drawer .p-item').count()) === 3 && /Saldo no pedido: 3 · mín\. 5/.test(await neilton.locator('.drawer').textContent()), 'detalhe com os 3 itens e o saldo na hora do pedido');

    console.log('\n[3] Compras recebe na hora, sem recarregar');
    await carlos.waitForSelector('.toast:has-text("Nova solicitação de compra #0001")', { timeout: 15000 });
    const took = Date.now() - sentAt;
    ok(took < 12000, `aviso na tela em ${(took / 1000).toFixed(1)} s (sem Realtime no teste; no ar o Supabase entrega em ~1 s)`);
    ok(/URGENTE/.test(await carlos.locator('.toast').first().textContent()) && /Neilton \(Almoxarifado\)/.test(await carlos.locator('.toast').first().textContent()), 'o aviso diz quem pediu e que é urgente');
    await carlos.waitForSelector('.max-fab.is-alert', { timeout: 3000 });
    ok(true, 'a Max pisca em amarelo enquanto fala');
    await carlos.screenshot({ path: SHOTS + '/c2-aviso-compras.png' });
    const filt = await carlos.evaluate(() => getComputedStyle(document.querySelector('.max-fab')).filter);
    ok(/hue-rotate/.test(filt), 'cor amarela aplicada na esfera: ' + filt.slice(0, 40));
    await carlos.waitForFunction(() => window.__spoken.length > 0, null, { timeout: 6000 }).catch(() => undefined);
    const spoken = await carlos.evaluate(() => window.__spoken);
    ok(spoken.length === 1 && /^Equipe de Compras, Neilton do Almoxarifado enviou uma nova solicitação de compra, número 1, com 3 itens\. É urgente\.$/.test(spoken[0]), 'a Max fala: ' + spoken[0]);
    ok((await carlos.evaluate(() => window.__chimes)) >= 2, 'som de notificação tocou');
    ok((await carlos.evaluate(() => window.__marker)) === 'sem-recarregar', 'a página não recarregou');
    ok((await carlos.locator('.nav-item:has-text("Solicitações") .nav-count').textContent()) === '1', 'contador de novas no menu');
    ok(/^\(1\) Compras/.test(await carlos.title()), 'título da aba do navegador mostra (1)');
    await carlos.waitForSelector('.max-fab:not(.is-alert)', { timeout: 8000 });
    ok(true, 'depois de falar, a Max volta ao normal');
    await wait(9000); // mais uma consulta periódica: não pode avisar de novo
    ok((await carlos.evaluate(() => window.__spoken.length)) === 1 && (await carlos.locator('.toast:has-text("Nova solicitação")').count()) <= 1, 'o mesmo pedido não é anunciado duas vezes');

    console.log('\n[4] Compras atende');
    await carlos.locator('.toast:has-text("Nova solicitação") .toast-action').click().catch(async () => carlos.click('.p-row:has-text("#0001")'));
    await carlos.waitForSelector('.drawer:has-text("Solicitação #0001")');
    await carlos.fill('#p-resp', 'Cotando com 3 fornecedores.');
    await carlos.click('.p-step:has-text("Em cotação")');
    await carlos.waitForSelector('.p-step.is-on:has-text("Em cotação")', { timeout: 6000 });
    ok(true, 'Carlos marca "Em cotação" com resposta');
    await carlos.screenshot({ path: SHOTS + '/c3-compras-detalhe.png' });

    console.log('\n[5] O Almoxarifado vê o andamento sem recarregar');
    await neilton.waitForSelector('.toast:has-text("Compras marcou #0001 como em cotação")', { timeout: 16000 });
    ok(/Cotando com 3 fornecedores/.test(await neilton.locator('.toast:has-text("Compras marcou")').textContent()), 'aviso traz a resposta de Compras');
    await neilton.waitForSelector('.drawer .pbadge:has-text("Em cotação")', { timeout: 4000 });
    ok(/Resposta de Compras/.test(await neilton.locator('.drawer').textContent()) && !(await neilton.locator('.drawer button:has-text("Cancelar solicitação")').count()), 'detalhe aberto atualiza sozinho; cancelar some depois que Compras começou');
    await neilton.keyboard.press('Escape');

    console.log('\n[6] Regras e segurança');
    const id1 = (await call(neilton, 'GET', '/api/compras/requests')).body.requests[0].id;
    let r = await call(neilton, 'PATCH', `/api/compras/requests/${id1}`, { status: 'comprada' });
    ok(r.status === 403, 'Almoxarifado não muda o andamento (403)');
    r = await call(neilton, 'PATCH', `/api/compras/requests/${id1}`, { status: 'cancelada' });
    ok(r.status === 409, 'Almoxarifado não cancela o que Compras já está cuidando (409)');
    r = await call(carlos, 'POST', '/api/compras/requests', { items: [{ name: 'X', quantity: 1 }] });
    ok(r.status === 403, 'Compras não cria pedido pelo Almoxarifado (403)');
    r = await call(carlos, 'GET', '/api/almoxarifado/stock');
    ok(r.status === 403, 'Compras não enxerga o estoque do Almoxarifado (403)');
    r = await call(carlos, 'PATCH', `/api/compras/requests/${id1}`, { status: 'comprada', expected: 'nova' });
    ok(r.status === 409 && /acabou de ser marcada/.test(r.body.error), 'duas pessoas mexendo ao mesmo tempo: a segunda é avisada (409)');
    const bad = [
      [{ items: [] }, 'nenhum item'],
      [{ items: [{ name: 'Bota', quantity: 0 }] }, 'quantidade 0'],
      [{ items: [{ name: 'Bota', quantity: 1.5 }] }, 'quantidade quebrada'],
      [{ items: [{ name: 'Bota', quantity: 999999 }] }, 'quantidade absurda'],
      [{ items: [{ name: '', quantity: 1 }] }, 'item sem nome'],
      [{ items: Array.from({ length: 41 }, (_, i) => ({ name: 'Item ' + i, quantity: 1 })) }, '41 itens'],
      [{ items: [{ item_id: '00000000-0000-0000-0000-000000000000', quantity: 1 }] }, 'item que não existe'],
      [{ items: [{ item_id: 'xpto', quantity: 1 }] }, 'id inválido'],
      [{ items: [{ name: 'Bota', quantity: 1 }, { name: 'bota', quantity: 2 }] }, 'item repetido'],
      [{ items: [{ name: 'Bota', quantity: 1 }], needed_by: '2020-01-01' }, 'data no passado'],
      [{ items: [{ name: 'Bota', quantity: 1 }], needed_by: '31/12/2026' }, 'data em formato errado'],
      ['texto', 'corpo inválido'],
    ];
    for (const [body, what] of bad) {
      r = await call(neilton, 'POST', '/api/compras/requests', body);
      ok(r.status === 400 || r.status === 409, `recusa ${what} (${r.status}: ${r.body.error ?? ''})`);
    }
    r = await call(neilton, 'POST', '/api/compras/requests', { items: [{ name: 'Bota', quantity: 1 }], needed_by: '2026-02-31' });
    ok(r.status === 400, 'recusa data que não existe (31/02)');
    r = await call(neilton, 'POST', '/api/compras/requests', { items: [{ name: '  Fita   isolante  ', size: '', quantity: '3', note: '<b>x</b>' }], reason: 'a'.repeat(5000), priority: 'xpto' });
    ok(r.status === 200 && r.body.request.items[0].name === 'Fita isolante' && r.body.request.reason.length === 600 && r.body.request.priority === 'normal' && r.body.request.number === 2, 'limpa espaços, corta texto longo e ignora prioridade inválida');
    const id2 = r.body.request.id;

    console.log('\n[7] Cancelamento pelo Almoxarifado');
    await neilton.click('.p-row:has-text("#0002")').catch(async () => { await neilton.click('.filter-seg button:has-text("Todas")'); await neilton.click('.p-row:has-text("#0002")'); });
    await neilton.click('.drawer button:has-text("Cancelar solicitação")');
    await neilton.click('.modal button:has-text("Cancelar solicitação")');
    await neilton.waitForSelector('.drawer .pbadge:has-text("Cancelada")', { timeout: 6000 });
    ok(true, 'Neilton cancela a #0002 (ainda nova)');
    await carlos.waitForSelector('.toast:has-text("O Almoxarifado cancelou a solicitação #0002")', { timeout: 16000 });
    ok(true, 'Compras é avisado do cancelamento');
    r = await call(carlos, 'PATCH', `/api/compras/requests/${id2}`, { status: 'comprada' });
    ok(r.status === 409, 'pedido cancelado não pode mais ser mexido (409)');
    await neilton.keyboard.press('Escape');

    console.log('\n[8] "Pedir compra" direto do Estoque');
    await neilton.click('.nav-item:has-text("Estoque")');
    await neilton.click('.stock-row:has-text("Calça tática")');
    await neilton.click('.drawer button:has-text("Pedir compra deste item")');
    await neilton.waitForSelector('.modal:has-text("Nova solicitação de compra")');
    ok((await neilton.locator('.p-line-item input').first().inputValue()) === 'Calça tática · 44' && (await neilton.locator('.p-line-qty').first().inputValue()) === '11', 'abre o pedido já com a Calça tática 44 e a quantidade sugerida');
    await neilton.keyboard.press('Escape');

    console.log('\n[9] Max nos dois setores');
    const ask = async (page, text) => {
      if (!(await page.locator('.max-panel').count())) await page.click('.max-fab');
      else if (!(await page.locator('.max-fab.is-listening').count())) await page.click('.max-fab');
      await page.waitForSelector('.max-fab.is-listening', { timeout: 5000 });
      await page.evaluate((x) => window.__say(x), text);
      await page.waitForFunction((t) => { const m = [...document.querySelectorAll('.max-msg:not(.is-thinking):not(.is-interim)')]; const n = m.length; return n >= 2 && m[n - 1].classList.contains('max') && m[n - 2].classList.contains('you') && m[n - 2].textContent === t; }, text, { timeout: 9000 });
      await page.waitForTimeout(600);
      return (await page.locator('.max-msg.max > p').allTextContents()).pop() || '';
    };
    let a = await ask(carlos, 'Max, quantos pedidos de compra em aberto?');
    ok(/^Há 1 solicitação de compra em aberto: 1 em cotação\. 1 é urgente\.$/.test(a), 'Compras: ' + a);
    a = await ask(neilton, 'Max, como está a solicitação de compra 1?');
    ok(a === '#0001 · Em cotação · Bota de segurança 42 (20), Lanterna recarregável (5), Colete refletivo (4)', 'Almoxarifado (texto na tela): ' + a);
    await neilton.waitForFunction(() => window.__spoken.some((x) => x.startsWith('Solicitação de compra 1')), null, { timeout: 6000 }).catch(() => undefined);
    const said = await neilton.evaluate(() => { const i = window.__spoken.findIndex((x) => x.startsWith('Solicitação de compra 1')); return window.__spoken.slice(i).join(' '); });
    ok(said === 'Solicitação de compra 1, pedida por Neilton: 20 de Bota de segurança 42, 5 de Lanterna recarregável e 4 de Colete refletivo. Está em cotação. Compras respondeu: Cotando com 3 fornecedores.', 'Almoxarifado (fala): ' + said);
    await neilton.waitForSelector('.drawer:has-text("Solicitação #0001")', { timeout: 4000 });
    ok(true, 'a Max abre o pedido na tela');
    await neilton.keyboard.press('Escape');
  }

  // ---------- quem não tem permissão ----------
  console.log('\n[10] Permissões');
  const juliana = await newPage(browser);
  await login(juliana, 'juliana', '/setor/almoxarifado');
  ok(!(await juliana.locator('.nav-item:has-text("Compras")').count()), 'Juliana (sem permissão em Compras) não vê a aba');
  let r = await call(juliana, 'POST', '/api/compras/requests', { items: [{ name: 'X', quantity: 1 }] });
  ok(r.status === 403, 'nem consegue pedir pela API (403)');
  r = await call(juliana, 'GET', '/api/compras/requests');
  ok(r.status === 403, 'nem listar (403)');
  await juliana.context().close();
  const lucas = await newPage(browser);
  await login(lucas, 'lucas', '/setor/compras');
  if (!NOCOMPRAS) {
    await lucas.waitForSelector('.p-row', { timeout: 8000 });
    await lucas.click('.p-row:has-text("#0001")');
    await lucas.waitForSelector('.drawer');
    const dbg = [await lucas.locator('.p-step').count(), await lucas.locator('.readonly-note').allTextContents()];
    ok(dbg[0] === 0 && dbg[1].some((t) => /só visualizando/.test(t)), 'Lucas (Compras, só visualiza) não tem botões de andamento ' + JSON.stringify(dbg));
    const id = (await call(lucas, 'GET', '/api/compras/requests')).body.requests.find((x) => x.number === 1).id;
    r = await call(lucas, 'PATCH', `/api/compras/requests/${id}`, { status: 'entregue' });
    ok(r.status === 403, 'nem pela API (403)');
  }
  await lucas.context().close();

  // ---------- celular ----------
  if (!NOCOMPRAS) {
    console.log('\n[11] Celular');
    const m = await newPage(browser, true);
    await login(m, 'carlos', '/setor/compras');
    await m.waitForSelector('.p-row');
    let over = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(over <= 1, `lista sem rolagem lateral (${over}px)`);
    await m.screenshot({ path: SHOTS + '/c4-celular-lista.png' });
    await m.click('.p-row:has-text("#0001")');
    await m.waitForSelector('.drawer');
    await m.waitForTimeout(500);
    await m.screenshot({ path: SHOTS + '/c5-celular-detalhe.png' });
    await m.context().close();
    const m2 = await newPage(browser, true);
    await login(m2, 'neilton', '/setor/almoxarifado');
    await m2.click('.tabbar .tab:has-text("Compras")').catch(async () => { await m2.goto(B + '/setor/almoxarifado#compras'); });
    await m2.waitForSelector('button:has-text("Nova solicitação de compra")');
    await m2.click('button:has-text("Nova solicitação de compra")');
    await m2.fill('.p-line-item input', 'bota');
    await m2.waitForTimeout(400);
    over = await m2.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(over <= 1, `formulário no celular sem rolagem lateral (${over}px)`);
    await m2.screenshot({ path: SHOTS + '/c6-celular-form.png' });
    await m2.context().close();
  }
} catch (e) {
  problems.push('EXCEÇÃO ' + e.message);
  console.log('EXCEÇÃO', e);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problema(s):\n- ` + problems.join('\n- ') : '\nTUDO CERTO');
process.exit(problems.length ? 1 : 0);
