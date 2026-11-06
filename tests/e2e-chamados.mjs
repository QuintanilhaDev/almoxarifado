/**
 * Chamados para o desenvolvedor (aba em todos os setores; só o @mateus responde) e atualização
 * automática do site quando sai uma versão nova. Nomes e textos inventados.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const B = 'http://localhost:3100';
const SHOTS = process.env.SHOTS || '/tmp/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const problems = [];
const ok = (cond, msg) => { if (!cond) { problems.push(msg); console.log('  ✗', msg); } else console.log('  ✓', msg); };

const browser = await chromium.launch();
async function session(user) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'pt-BR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { problems.push(`pageerror (${user}): ${e.message}`); console.log('  ! pageerror', e.message); });
  page.on('dialog', (d) => d.accept());
  await page.goto(B + '/');
  await page.fill('#user', user);
  await page.fill('#pass', '123456');
  await page.click('button[type=submit]');
  await page.waitForURL((u) => u.pathname.length > 1, { timeout: 30000 });
  await page.waitForTimeout(800);
  return page;
}
const api = (p, url, method = 'GET', body) => p.evaluate(async ([u, m, b]) => { const r = await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; }, [url, method, body]);
const tick = (p) => p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

// print de tela inventado (PNG 1x1)
const png = path.join(SHOTS, 'print-chamado.png');
fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const VFILE = path.join(process.cwd(), 'public', 'version.json');
const versaoOriginal = fs.existsSync(VFILE) ? fs.readFileSync(VFILE, 'utf8') : null;

try {
  console.log('\n[1] RH: aba Chamados, abrir um chamado com print');
  const rh = await session('carla');
  await rh.goto(B + '/setor/rh#chamados');
  await rh.reload();
  await rh.waitForSelector('.ch-side h1:has-text("Chamados")', { timeout: 20000 });
  ok((await rh.locator('.nav-item:has-text("Responder chamados")').count()) === 0, 'quem não é o desenvolvedor não vê "Responder chamados"');
  ok((await rh.locator('.modal').count()) === 0 && (await rh.locator('.ch-pane').count()) === 1, 'tela de chat (lista + conversa), sem janela por cima');
  await rh.click('.ch-blank button:has-text("Abrir chamado")');
  await rh.waitForSelector('#ch-t');
  await rh.fill('#ch-t', 'Botão de salvar não responde (teste)');
  await rh.fill('#ch-d', 'Cliquei em salvar no cadastro de teste e nada aconteceu.');
  await rh.setInputFiles('.ch-new input[type=file]', png);
  await rh.waitForSelector('.ch-chip:has-text("print-chamado")', { timeout: 10000 });
  await rh.click('.ch-new .btn-primary:has-text("Enviar chamado")');
  await rh.waitForSelector('.ch-msgs .ch-bubble.mine', { timeout: 10000 });
  const head = await rh.locator('.ch-head-main small').innerText().catch(() => '');
  ok(/setor\/rh#chamados/.test(head), `chamado guarda a tela em que foi aberto (${head})`);
  ok((await rh.locator('.ch-bubble.mine .ch-img img').count()) === 1, 'print aparece na conversa como bolha minha');
  await rh.screenshot({ path: SHOTS + '/ch-usuario.png' });
  let r = await api(rh, '/api/chamados');
  const t = r.body.tickets?.[0];
  ok(r.status === 200 && r.body.tickets.length === 1 && t.sector === 'rh' && t.opened_by_user === 'carla', 'chamado gravado com setor e quem abriu');
  const anexo = t.messages[0].attachments?.[0]?.path;
  ok(/^chamados\/[0-9a-f-]{36}\//.test(anexo ?? ''), 'anexo guardado na pasta de quem enviou');
  // sai da conversa e vai para outra aba: o aviso precisa chegar mesmo fora dos Chamados
  await rh.click('.nav-item:has-text("Colaboradores")');
  await rh.waitForTimeout(1500);
  await rh.evaluate(() => {
    window.__sons = 0;
    const C = window.AudioContext;
    if (C) {
      const orig = C.prototype.createOscillator;
      C.prototype.createOscillator = function () { window.__sons++; return orig.call(this); };
    }
  });

  console.log('\n[2] Permissões');
  r = await api(rh, '/api/chamados?todos=1');
  ok(r.body.tickets.length === 1 && r.body.dev === false, 'só o desenvolvedor vê todos os chamados');
  r = await api(rh, `/api/chamados?id=${t.id}`, 'PATCH', { status: 'em_andamento' });
  ok(r.status === 403, 'quem abriu não muda a situação para "em andamento"');
  r = await api(rh, `/api/chamados?id=${t.id}`, 'PATCH', { priority: 'urgente' });
  ok(r.status === 403, 'quem abriu não muda a prioridade depois de aberto');
  r = await api(rh, '/api/chamados', 'POST', { title: 'x', description: 'y', attachments: [{ path: 'chamados/00000000-0000-0000-0000-000000000000/a.png', name: 'a.png' }] });
  ok(r.status === 400, 'não aceita anexo de outra pessoa');
  const outro = await session('lucas');
  r = await api(outro, `/api/chamados?id=${t.id}`, 'PATCH', { text: 'intrometido' });
  ok(r.status === 404, 'outra pessoa não mexe no chamado');
  const dl = await outro.evaluate(async (u) => (await fetch(u)).status, `/api/chamados/anexo?path=${encodeURIComponent(anexo)}`);
  ok(dl === 404, 'outra pessoa não baixa o anexo');
  const dlOwn = await rh.evaluate(async (u) => (await fetch(u)).status, `/api/chamados/anexo?path=${encodeURIComponent(anexo)}`);
  ok(dlOwn === 200, 'quem abriu baixa o próprio anexo');
  r = await api(outro, '/api/chamados');
  ok(r.body.tickets.length === 0, 'cada pessoa só vê os próprios chamados');
  await outro.goto(B + '/setor/compras#chamados');
  await outro.reload();
  await outro.waitForSelector('.ch-side h1:has-text("Chamados")', { timeout: 20000 });
  ok(true, 'aba Chamados também no setor de Compras');
  await outro.context().close();

  console.log('\n[3] Desenvolvedor: chat "Responder chamados"');
  const dev = await session('mateus');
  await dev.goto(B + '/hub#responder');
  await dev.reload();
  await dev.waitForSelector('.ch-side h1:has-text("Responder chamados")', { timeout: 20000 });
  await dev.waitForSelector('.ch-conv:has-text("Botão de salvar")', { timeout: 10000 });
  ok(/1/.test(await dev.locator('.nav-item:has-text("Responder") .nav-count').innerText().catch(() => '')), 'menu mostra 1 chamado esperando resposta');
  ok((await dev.locator('.ch-conv:has-text("Botão de salvar")').innerText()).includes('Recursos Humanos'), 'lista mostra o setor de quem abriu');
  await dev.click('.ch-conv:has-text("Botão de salvar")');
  await dev.waitForSelector('.ch-input');
  ok((await dev.locator('.ch-bubble:not(.mine) .ch-img img').count()) === 1, 'desenvolvedor vê o print anexado na bolha de quem abriu');
  await dev.fill('.ch-input', 'Corrigido na versão de hoje. Pode testar de novo?');
  await dev.press('.ch-input', 'Enter');
  await dev.waitForSelector('.ch-bubble.mine:has-text("Corrigido na versão de hoje"):not(.is-pending)', { timeout: 10000 });
  ok((await dev.inputValue('.ch-input')) === '', 'Enter envia e limpa a caixa');
  await dev.waitForFunction(() => document.querySelector('.ch-head select[aria-label="Situação"]')?.value === 'respondido', null, { timeout: 8000 }).then(() => ok(true, 'responder deixa o chamado como "Respondido"')).catch(() => ok(false, 'responder deixa o chamado como "Respondido"'));
  await dev.screenshot({ path: SHOTS + '/ch-dev.png' });

  console.log('\n[4] Quem abriu recebe o aviso com som, o texto e a Max em amarelo');
  await tick(rh);
  await rh.waitForSelector('.toast:has-text("Corrigido na versão de hoje")', { timeout: 15000 }).then(() => ok(true, 'aviso mostra o conteúdo da mensagem')).catch(() => ok(false, 'aviso mostra o conteúdo da mensagem'));
  ok((await rh.evaluate(() => window.__sons)) > 0, 'aviso toca som');
  ok((await rh.locator('.max-fab.is-alert').count()) === 1, 'Max pisca em amarelo');
  await rh.screenshot({ path: SHOTS + '/ch-aviso.png' });
  ok(/1/.test(await rh.locator('.nav-item:has-text("Chamados") .nav-count').innerText().catch(() => '')), 'menu Chamados mostra 1 resposta nova');
  await rh.click('.toast button:has-text("Abrir chat")');
  await rh.waitForSelector('.ch-bubble:not(.mine):has-text("Corrigido na versão de hoje")', { timeout: 10000 });
  ok(true, '"Abrir chat" leva direto à conversa');
  await rh.waitForTimeout(1200);
  r = await api(rh, '/api/chamados');
  ok(r.body.tickets[0].owner_seen_at >= r.body.tickets[0].messages[1].at, 'resposta marcada como vista');
  // chat aberto dos dois lados: a mensagem chega sem recarregar
  await rh.fill('.ch-input', 'Testei agora e funcionou, obrigada!');
  await rh.press('.ch-input', 'Enter');
  await rh.waitForSelector('.ch-bubble.mine:has-text("funcionou"):not(.is-pending)', { timeout: 10000 });
  await tick(dev);
  await dev.waitForSelector('.ch-bubble:not(.mine):has-text("funcionou")', { timeout: 15000 }).then(() => ok(true, 'mensagem nova aparece no chat do desenvolvedor sem recarregar')).catch(() => ok(false, 'mensagem nova aparece no chat do desenvolvedor sem recarregar'));
  await rh.click('.ch-head button:has-text("Resolvido")');
  await rh.waitForSelector('.ch-sys:has-text("resolvido")', { timeout: 10000 });
  r = await api(rh, '/api/chamados');
  ok(r.body.tickets[0].status === 'resolvido', 'quem abriu marca como resolvido');
  r = await api(rh, `/api/chamados?id=${t.id}`, 'PATCH', { text: 'Voltou a acontecer.' });
  ok(r.status === 200 && r.body.ticket.status === 'aberto', 'escrever num chamado resolvido reabre');
  // resolvido some sozinho (aqui o servidor de teste usa 20 s no lugar de 10 min)
  r = await api(rh, `/api/chamados?id=${t.id}`, 'PATCH', { status: 'resolvido' });
  ok(r.status === 200 && r.body.ticket.resolved_at, 'resolvido de novo: o relógio para apagar começa');
  await rh.waitForSelector('.ch-warn:has-text("será apagada")', { timeout: 10000 }).then(() => ok(true, 'conversa avisa a hora em que será apagada')).catch(() => ok(false, 'conversa avisa a hora em que será apagada'));
  await rh.waitForTimeout(23000);
  r = await api(rh, '/api/chamados');
  ok(r.body.tickets.length === 0, 'chamado resolvido foi apagado depois do prazo');
  const dlDepois = await rh.evaluate(async (u) => (await fetch(u, { cache: 'no-store' })).status, `/api/chamados/anexo?path=${encodeURIComponent(anexo)}`);
  ok(dlDepois === 404, 'anexos do chamado apagado também somem');
  await tick(rh);
  await rh.waitForSelector('.ch-blank', { timeout: 15000 }).then(() => ok(true, 'conversa apagada sai da tela sozinha')).catch(() => ok(false, 'conversa apagada sai da tela sozinha'));
  // um chamado aberto para o resto do teste (celular)
  r = await api(rh, '/api/chamados', 'POST', { title: 'Outro teste de layout', description: 'Mensagem de teste.' });
  await tick(rh);
  await rh.click('.ch-conv:has-text("Outro teste de layout")');
  await rh.waitForSelector('.ch-input');

  await rh.setViewportSize({ width: 390, height: 800 });
  await rh.waitForTimeout(500);
  ok(await rh.locator('.ch-side').isHidden(), 'no celular a conversa ocupa a tela toda');
  await rh.screenshot({ path: SHOTS + '/ch-celular.png' });
  await rh.click('.ch-back');
  ok(await rh.locator('.ch-side').isVisible(), 'botão voltar mostra a lista no celular');
  await rh.setViewportSize({ width: 1360, height: 900 });

  console.log('\n[4b] Menu lateral rola quando há muitas abas');
  await dev.setViewportSize({ width: 1280, height: 600 });
  await dev.goto(B + '/setor/almoxarifado#solicitacoes');
  await dev.reload();
  await dev.waitForSelector('.side .nav-item');
  const rola = await dev.evaluate(() => { const n = document.querySelector('.side .nav'); return n.scrollHeight > n.clientHeight; });
  ok(rola, 'com a janela baixa o menu do Almoxarifado tem rolagem');
  await dev.locator('.side .nav-item[data-tab="chamados"]').scrollIntoViewIfNeeded();
  await dev.click('.side .nav-item[data-tab="chamados"]');
  await dev.waitForSelector('.ch-side h1:has-text("Chamados")', { timeout: 15000 }).then(() => ok(true, 'aba Chamados alcançável no Almoxarifado')).catch(() => ok(false, 'aba Chamados alcançável no Almoxarifado'));
  ok(await dev.locator('.side-foot').isVisible(), 'rodapé com a conta continua visível');
  await dev.screenshot({ path: SHOTS + '/ch-menu-baixo.png' });

  console.log('\n[5] Versão nova: a tela se atualiza sozinha');
  if (versaoOriginal) {
    // janela aberta: não recarrega, mostra o aviso
    await rh.click('.ch-side button:has-text("Novo")');
    await rh.waitForSelector('#ch-t');
    await rh.fill('#ch-t', 'rascunho');
    fs.writeFileSync(VFILE, JSON.stringify({ version: 'teste-nova' }));
    await rh.evaluate(() => window.dispatchEvent(new Event('focus')));
    await rh.waitForSelector('.version-bar', { timeout: 10000 });
    ok((await rh.inputValue('#ch-t')) === 'rascunho', 'digitando, só mostra o aviso e não perde o que foi digitado');
    await rh.screenshot({ path: SHOTS + '/ch-versao.png' });
    // fechou a janela e parou de mexer: recarrega sozinha
    await rh.evaluate(() => (document.activeElement)?.blur?.());
    const nav = rh.waitForEvent('framenavigated', { timeout: 45000 }).then(() => true).catch(() => false);
    ok(await nav, 'sem nada aberto, a página recarrega sozinha com a versão nova');
    fs.writeFileSync(VFILE, versaoOriginal);
  } else {
    ok(false, 'public/version.json não existe (rode next build)');
  }
} catch (e) {
  problems.push('exceção: ' + e.message);
  console.log(e);
} finally {
  if (versaoOriginal) fs.writeFileSync(VFILE, versaoOriginal);
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problema(s):\n- ${problems.join('\n- ')}` : '\nTudo certo.');
process.exit(problems.length ? 1 : 0);
