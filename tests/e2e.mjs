/**
 * Teste de ponta a ponta no navegador (Chromium), com o banco de teste.
 * Simula o reconhecimento de voz para exercitar a Max sem microfone.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const B = 'http://localhost:3100';
const SHOTS = process.env.SHOTS || '/tmp/shots';
const problems = [];
const ok = (cond, msg) => { if (!cond) { problems.push(msg); console.log('  ✗', msg); } else console.log('  ✓', msg); };

/** Reconhecimento de voz falso: window.__say("frase") entrega a frase à escuta ativa. */
const FAKE_SPEECH = `
  window.__recs = [];
  class FakeRec {
    constructor(){ this.continuous=false; window.__recs.push(this); }
    start(){ if(this._on) throw new Error('already'); this._on=true; setTimeout(()=>this.onstart&&this.onstart(),10); }
    stop(){ this._end(); } abort(){ this._end(); }
    _end(){ if(!this._on) return; this._on=false; setTimeout(()=>this.onend&&this.onend(),10); }
    _say(t){ if(!this._on) return false; const r=[{transcript:t,confidence:.9}]; r.isFinal=true; this.onresult&&this.onresult({resultIndex:0,results:[r]}); return true; }
  }
  window.webkitSpeechRecognition = FakeRec; window.SpeechRecognition = FakeRec;
  window.__say = (t) => window.__recs.some((r) => r._say(t));
  // o navegador encerra a sessão sozinho (silêncio, ruído…), como acontece de verdade
  window.__drop = () => window.__recs.forEach((r) => r._end());
  window.__live = () => window.__recs.filter((r) => r._on).length;
  window.__spoken = [];
  const realSpeak = window.speechSynthesis && window.speechSynthesis.speak.bind(window.speechSynthesis);
  if (window.speechSynthesis) window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); setTimeout(()=>{u.onstart&&u.onstart({}); setTimeout(()=>u.onend&&u.onend({}), 250);}, 20); };
`;

async function newPage(browser, { mobile = false, speech = true } = {}) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 800 } : { width: 1360, height: 860 }, deviceScaleFactor: mobile ? 2 : 1, locale: 'pt-BR', timezoneId: 'America/Bahia' });
  const page = await ctx.newPage();
  if (speech) await page.addInitScript(FAKE_SPEECH);
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|ERR_CONNECTION|Failed to load resource|fonts\.g/i.test(m.text())) { problems.push('console: ' + m.text().slice(0, 200)); console.log('  ! console', m.text().slice(0, 200)); } });
  page.on('pageerror', (e) => { problems.push('pageerror: ' + e.message); console.log('  ! pageerror', e.message); });
  return page;
}
async function login(page, user, pass = '123456') {
  await page.goto(B + '/');
  await page.fill('#user', user);
  await page.fill('#pass', pass);
  await page.click('button[type=submit]');
}
const loginIdle = async (page) => { await page.waitForSelector('.login-max .max-orb.is-idle', { timeout: 15000 }); await page.waitForTimeout(700); };
const say = (page, t) => page.evaluate((x) => window.__say(x), t);
const lastMax = async (page) => (await page.locator('.max-msg.max p').allTextContents()).pop() || '';
async function ask(page, text) {
  if (!(await page.locator('.max-panel').count())) await page.click('.max-fab');
  else if (!(await page.locator('.max-fab.is-listening').count())) await page.click('.max-fab');
  await page.waitForSelector('.max-fab.is-listening', { timeout: 4000 });
  await say(page, text);
  // a conversa guarda só as últimas mensagens: confere pelo par pergunta → resposta
  await page.waitForFunction((t) => { const m = [...document.querySelectorAll('.max-msg:not(.is-thinking):not(.is-interim)')]; const n = m.length; return n >= 2 && m[n - 1].classList.contains('max') && m[n - 2].classList.contains('you') && m[n - 2].textContent === t; }, text, { timeout: 8000 });
  await page.waitForTimeout(700);
  return lastMax(page);
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  console.log('\n[1] Tela de login');
  let page = await newPage(browser);
  await page.goto(B + '/');
  await page.waitForSelector('.login-card');
  await page.waitForTimeout(1500);
  ok(await page.locator('.max-orb canvas').count() === 1, 'esfera 3D (WebGL) desenhada no login');
  ok((await page.evaluate(() => window.__live())) === 1, 'escuta constante ligada ao abrir');
  ok(!(await page.locator('.listen-chip').count()) && !(await page.locator('.login-caption').count()), 'sem botão de escuta e sem frase de dica');
  for (let i = 0; i < 4; i++) { await page.evaluate(() => window.__drop()); await page.waitForTimeout(450); }
  ok((await page.evaluate(() => window.__live())) === 1, 'navegador encerrou a sessão 4 vezes: a escuta religou sozinha');
  ok(!(await page.locator('.login-caption').count()), 'nada pisca na tela enquanto religa');
  await page.screenshot({ path: SHOTS + '/01-login.png' });
  await say(page, 'vamos almoçar mais tarde');
  await page.waitForTimeout(500);
  ok(!(await page.locator('.login-said').count()), 'conversa sem "Max" é ignorada');
  await say(page, 'Max, apresente-se');
  await page.waitForSelector('.login-said', { state: 'attached' });
  const intro = await page.locator('.login-said').textContent();
  ok(/^(Bom dia|Boa tarde|Boa noite)! Eu sou a Max/.test(intro), 'apresentação com a saudação do horário: ' + intro.slice(0, 50) + '…');
  await loginIdle(page);
  await say(page, 'Max, apresente-se a todos da sala, por favor');
  await page.waitForFunction(() => /Olá a todos/.test(document.querySelector('.login-said')?.textContent || ''), null, { timeout: 8000 }).catch(() => undefined);
  ok(/^Olá a todos, (bom dia|boa tarde|boa noite)! Eu sou a Max/.test(await page.locator('.login-said').textContent()), '"apresente-se a todos" → "Olá a todos…"');
  await page.screenshot({ path: SHOTS + '/02-login-max.png' });
  await loginIdle(page);
  await say(page, 'Max, diga olá para Fernanda, Júnior, Suzana');
  await page.waitForFunction(() => /Fernanda/.test(document.querySelector('.login-said')?.textContent || ''), null, { timeout: 8000 }).catch(() => undefined);
  ok(/^(Bom dia|Boa tarde|Boa noite), Fernanda, Júnior e a todos que estão presentes!$/.test(await page.locator('.login-said').textContent()), '"diga olá para Fernanda, Júnior, Suzana": ' + (await page.locator('.login-said').textContent()));
  await loginIdle(page);
  await say(page, 'Max diga olá para o Carlos');
  await page.waitForFunction(() => /Carlos/.test(document.querySelector('.login-said')?.textContent || ''), null, { timeout: 8000 }).catch(() => undefined);
  ok(/^(Bom dia|Boa tarde|Boa noite), Carlos! /.test(await page.locator('.login-said').textContent()), 'um nome só: ' + (await page.locator('.login-said').textContent()));
  await loginIdle(page);
  await say(page, 'Max, bom dia');
  await page.waitForFunction(() => /Bom dia|Boa tarde|Boa noite/.test(document.querySelector('.login-said')?.textContent || ''));
  console.log('    saudação:', await page.locator('.login-said').textContent());
  ok((await page.evaluate(() => window.__spoken.length)) >= 2, 'respostas faladas em voz');
  await loginIdle(page);
  await say(page, 'Max, métricas da semana');
  await page.waitForFunction(() => /Entre com seu usuário/.test(document.querySelector('.login-said')?.textContent || ''), null, { timeout: 8000 }).catch(() => undefined);
  ok(/Entre com seu usuário/.test(await page.locator('.login-said').textContent()), 'no login, dados do sistema não são respondidos');
  await loginIdle(page);
  await say(page, 'que horas são'); // continuação da conversa, sem repetir "Max"
  await page.waitForFunction(() => /Agora são/.test(document.querySelector('.login-said')?.textContent || ''), null, { timeout: 8000 }).catch(() => undefined);
  ok(/Agora são/.test(await page.locator('.login-said').textContent()), 'conversa continua sem repetir "Max"');
  await page.fill('#user', 'mateus'); await page.fill('#pass', 'errada'); await page.click('button[type=submit]');
  await page.waitForSelector('.login-error span');
  ok(/incorretos/.test(await page.locator('.login-error').textContent()), 'senha errada mostra o erro');

  console.log('\n[2] Master → painel master');
  await page.fill('#pass', '123456'); await page.click('button[type=submit]');
  await page.waitForSelector('.greeting', { timeout: 6000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: SHOTS + '/03-saudacao.png' });
  await page.waitForURL(B + '/hub', { timeout: 15000 });
  await page.waitForSelector('.hub-card');
  await page.waitForTimeout(1800);
  ok(await page.locator('.hub-card').count() === 5, 'cinco setores no painel master');
  ok(!(await page.evaluate(() => document.documentElement.classList.contains('intro'))), 'transição de entrada terminou');
  await page.screenshot({ path: SHOTS + '/04-hub.png' });
  let r = await ask(page, 'Max, quantos usuários temos?');
  ok(/usuários ativos/.test(r), 'Max no hub: ' + r.slice(0, 70));
  await page.waitForSelector('.max-fab.is-listening', { timeout: 8000 });
  ok(true, 'depois de responder, ela volta a ouvir sozinha (conversa contínua)');
  for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__drop()); await page.waitForTimeout(400); }
  ok((await page.locator('.max-fab.is-listening').count()) === 1 && (await page.evaluate(() => window.__live())) === 1, 'sessão caiu 3 vezes: continua ouvindo (não desliga na hora)');
  await say(page, 'que dia é hoje');
  await page.waitForFunction(() => /2026/.test([...document.querySelectorAll('.max-msg.max p')].pop()?.textContent || ''), null, { timeout: 6000 });
  ok(true, 'pedido seguinte atendido sem clicar de novo');
  await page.screenshot({ path: SHOTS + '/05-hub-max.png' });
  r = await ask(page, 'Max, me apresente as métricas da última semana do almoxarifado');
  ok(/Na última semana foram 75 entradas/.test(r) && (await page.url()) === B + '/hub', 'no painel master, métricas do almoxarifado: ' + r.slice(0, 70));
  await page.screenshot({ path: SHOTS + '/05b-hub-metricas.png' });
  r = await ask(page, 'Max, o que está com estoque baixo?');
  ok(/estoque baixo/.test(r), 'no painel master, estoque baixo do almoxarifado');
  r = await ask(page, 'Max Me apresente as métricas da última semana do almoxarifado');
  ok(/Na última semana foram 75 entradas/.test(r), 'métricas do almoxarifado pedidas do painel master: ' + r.slice(0, 60));
  r = await ask(page, 'Quantos usuários temos no setor Financeiro');
  ok(/Financeiro/.test(r) && !/não sei/i.test(r), 'usuários de um setor: ' + r.slice(0, 70));
  r = await ask(page, 'Max, apresente-se');
  ok(/^(Bom dia|Boa tarde|Boa noite), Mateus! Eu sou a Max/.test(r), 'apresentação começa com a saudação do horário');
  r = await ask(page, 'Max quantos itens saíram do estoque do almoxarifado nas últimas 15 horas');
  ok(/^Nas últimas 15 horas saíram 11 unidades do almoxarifado, de 3 itens diferentes/.test(r), 'saídas em um período livre: ' + r.slice(0, 90));
  // baixar o arquivo das métricas (gráfico por padrão, planilha se pedir)
  const fs = await import('node:fs');
  let dlP = page.waitForEvent('download', { timeout: 20000 });
  r = await ask(page, 'Max, desejo baixar as métricas do almoxarifado');
  let dl = await dlP.catch(() => null);
  let size = dl ? fs.statSync(await dl.path()).size : 0;
  ok(Boolean(dl) && /\.png$/.test(dl.suggestedFilename()) && size > 20000, `gráfico .png baixado sozinho: ${dl?.suggestedFilename()} (${size} bytes)`);
  ok(/^Baixei o gráfico das métricas do Almoxarifado \(última semana\)/.test(r), 'ela confirma o que baixou: ' + r.slice(0, 80));
  if (dl) fs.copyFileSync(await dl.path(), SHOTS + '/metricas-baixadas.png');
  dlP = page.waitForEvent('download', { timeout: 20000 });
  r = await ask(page, 'Max, baixe a planilha das métricas do almoxarifado do último mês');
  dl = await dlP.catch(() => null);
  size = dl ? fs.statSync(await dl.path()).size : 0;
  const head = dl ? fs.readFileSync(await dl.path()).subarray(0, 2).toString() : '';
  ok(Boolean(dl) && /ultimo-mes.*\.xlsx$/.test(dl.suggestedFilename()) && head === 'PK' && size > 5000, `planilha .xlsx baixada: ${dl?.suggestedFilename()} (${size} bytes)`);
  dlP = page.waitForEvent('download', { timeout: 20000 });
  r = await ask(page, 'Max, desejo baixar as métricas do almoxarifado do último dia');
  dl = await dlP.catch(() => null);
  ok(Boolean(dl) && /ultimo-dia.*\.png$/.test(dl.suggestedFilename()) && /\(último dia\)/.test(r), `período falado vale no arquivo: ${dl?.suggestedFilename()}`);
  r = await ask(page, 'Max, desejo baixar as métricas do financeiro');
  ok(r === 'O setor Financeiro ainda não possui métricas. Caso queira que esse setor obtenha uma contagem de métricas, contate Mateus na sede.', 'setor sem métricas: avisa e orienta');
  r = await ask(page, 'Max, novo usuário chamado Rita Lopes no financeiro');
  await page.waitForSelector('.modal.sheet', { timeout: 5000 });
  ok((await page.inputValue('#hu-name')) === 'Rita Lopes' && (await page.inputValue('#hu-user')) === 'rita.lopes' && (await page.inputValue('#hu-sector')) === 'financeiro', 'Max abriu o cadastro já preenchido (nome, login e setor)');
  await page.fill('#hu-pass', 'segredo1');
  await page.screenshot({ path: SHOTS + '/06-novo-usuario.png' });
  await page.click('.modal.sheet button[type=submit]');
  await page.waitForSelector('.modal.sheet', { state: 'detached' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.click('.filter-chips button:has-text("Todos")');
  ok(await page.locator('.user-row:has-text("Rita Lopes")').count() === 1, 'usuário criado aparece na lista');
  await page.screenshot({ path: SHOTS + '/07-usuarios.png' });
  // editar: virar master do setor
  await page.click('.user-row:has-text("Rita Lopes")');
  await page.selectOption('#hu-role', 'master');
  await page.click('.modal.sheet button[type=submit]');
  await page.waitForSelector('.modal.sheet', { state: 'detached' });
  ok(await page.locator('.user-row:has-text("Rita Lopes") .badge:has-text("master do setor")').count() === 1, 'definido como master do setor');
  // o próprio master não consegue se rebaixar
  await page.click('.user-row:has-text("Mateus")');
  ok(await page.locator('.kind-opts input').first().isDisabled(), 'master não consegue tirar o próprio acesso');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal.sheet', { state: 'detached' });
  r = await ask(page, 'Max, abrir o setor recursos humanos');
  await page.waitForURL(B + '/setor/rh', { timeout: 8000 });
  await page.waitForSelector('.blank-tool');
  ok(true, 'Max levou o master ao setor RH');
  ok(await page.locator('.side-back').count() === 1, 'atalho de volta ao painel master');
  await page.waitForTimeout(900);
  await page.screenshot({ path: SHOTS + '/08-rh.png' });
  r = await ask(page, 'Max, desejo ver as métricas da última semana');
  ok(/em preparação/.test(r), 'setor vazio: ' + r.slice(0, 60));
  await page.goto(B + '/setor/almoxarifado');
  await page.waitForSelector('.list-pane, .inbox');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: SHOTS + '/09-almox.png' });
  r = await ask(page, 'Max, desejo ver as métricas da última semana');
  ok(/Na última semana/.test(r), 'métricas: ' + r.slice(0, 110));
  await page.waitForSelector('.mt-seg-btn.is-active[data-period="ultima-semana"]', { timeout: 5000 });
  ok(true, 'tela de Métricas aberta no período pedido');
  await page.waitForTimeout(900);
  await page.screenshot({ path: SHOTS + '/10-almox-metricas-max.png' });
  r = await ask(page, 'Max, como foi o mês?');
  await page.waitForSelector('.mt-seg-btn.is-active[data-period="ultimo-mes"]', { timeout: 5000 });
  ok(/No último mês/.test(r), 'troca de período pela voz');
  r = await ask(page, 'Max, quanto tem de bota 42?');
  ok(/3 unidades/.test(r), 'saldo de item: ' + r.slice(0, 80));
  await page.waitForSelector('.drawer-overlay', { timeout: 5000 });
  ok(true, 'gaveta do item aberta');
  await page.locator('.drawer-overlay .icon-btn[aria-label="Fechar"]').click();
  r = await ask(page, 'Max, o que está com estoque baixo?');
  ok(/estoque baixo/.test(r), 'estoque baixo: ' + r.slice(0, 90));
  await page.waitForTimeout(600);
  await page.screenshot({ path: SHOTS + '/11-almox-estoque-max.png' });
  r = await ask(page, 'Max, abrir a solicitação 12');
  ok(/Edu Santos/.test(r), 'abrir solicitação: ' + r.slice(0, 80));
  await page.waitForSelector('.detail-protocol:has-text("#0012")', { timeout: 5000 });
  ok(true, 'solicitação #0012 aberta na tela');
  r = await ask(page, 'Max, o que tem no posto 01?');
  ok(/Posto 01 tem 14 unidades/.test(r), 'posto: ' + r.slice(0, 90));
  r = await ask(page, 'Max, quanto é 15% de 2400?');
  ok(/360/.test(r), 'conta: ' + r);
  r = await ask(page, 'Max, qual a capital da Austrália?');
  ok(/Ainda não sei/.test(r), 'pergunta geral sem internet no teste → admite que não sabe');
  // digitar em vez de falar
  await page.click('.max-foot-btn:has-text("Digitar")');
  await page.fill('.max-input input', 'que dia é hoje');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /2026/.test([...document.querySelectorAll('.max-msg.max p')].pop()?.textContent || ''), null, { timeout: 5000 });
  ok(true, 'pedido digitado funciona: ' + (await lastMax(page)));
  await page.keyboard.press('Escape'); // 1º Esc fecha a gaveta do posto
  await page.waitForSelector('.drawer-overlay', { state: 'detached' });
  await page.keyboard.press('Escape'); // 2º fecha a Max
  await page.waitForSelector('.max-panel', { state: 'detached', timeout: 3000 }).catch(() => undefined);
  ok(!(await page.locator('.max-panel').count()), 'Esc fecha a Max');
  // agente (IA com ferramentas) — a IA do teste é simulada
  r = await ask(page, 'Max, cadastre o item lanterna tática com 7 unidades');
  ok(/^Vou registrar: cadastro do item Lanterna tática com 7 unidades\. Confirma\?/.test(r), 'pedido de alteração pede confirmação: ' + r.slice(0, 70));
  let stock = await page.evaluate(async () => (await (await fetch('/api/almoxarifado/stock')).json()).items.filter((i) => i.name === 'Lanterna tática').length);
  ok(stock === 0, 'nada é gravado antes do "sim"');
  r = await ask(page, 'sim');
  ok(/^Pronto: cadastro do item Lanterna tática/.test(r), 'depois do "sim": ' + r.slice(0, 60));
  stock = await page.evaluate(async () => (await (await fetch('/api/almoxarifado/stock')).json()).items.filter((i) => i.name === 'Lanterna tática' && i.quantity === 7).length);
  ok(stock === 1, 'item realmente cadastrado no sistema');
  r = await ask(page, 'Max, marque a solicitação 3 como resolvida');
  ok(/solicitação 3 \(Caio Melo\) marcada como resolvida\. Confirma\?/.test(r), 'mudar status pede confirmação');
  r = await ask(page, 'não');
  ok(/não alterei nada/.test(r), '"não" cancela');
  const st = await page.evaluate(async () => (await (await fetch('/api/almoxarifado/requests')).json()).requests.find((x) => x.protocol === 3).status);
  ok(st === 'nova', 'a solicitação continuou como estava');
  r = await ask(page, 'Max, pesquise qual é a capital da Austrália');
  ok(r === 'A capital da Austrália é Canberra.', 'pesquisa na web (resposta limpa para a voz): ' + r);
  r = await ask(page, 'Max, qual o saldo de camisa social');
  ok(/RESPOSTA: .*Camisa social manga curta G.*"saldo":40/.test(r) || /Camisa social/.test(r), 'consulta livre pelo agente ou habilidade local');
  r = await ask(page, 'Max, vai tomar no cu');
  ok(/conversa profissional/.test(r), 'palavrão é barrado');
  r = await ask(page, 'Max quantas botas saíram hoje');
  ok(/saíram 2 unidades de Bota de segurança 42/.test(r), 'saída de um item no período: ' + r.slice(0, 80));
  r = await ask(page, 'Max deslog da minha conta e me leve diretamente para a tela de login por favor');
  await page.waitForURL(B + '/', { timeout: 8000 });
  ok(true, 'Max encerrou a sessão');
  await page.context().close();

  console.log('\n[3] Juliana: só visualiza o Estoque, não vê Postos/Formulário/E-mails');
  page = await newPage(browser);
  await login(page, 'juliana');
  await page.waitForURL(B + '/setor/almoxarifado', { timeout: 15000 });
  await page.waitForSelector('.nav-item');
  await page.waitForTimeout(1600);
  const nav = await page.locator('.side .nav-item span:not(.nav-count):not(.nav-bg)').allTextContents();
  console.log('    menu:', nav.join(' | '));
  ok(!nav.includes('Postos') && !nav.includes('Formulário') && !nav.includes('Equipe') && nav.includes('Estoque'), 'menu mostra só o que ela pode ver');
  await page.click('.nav-item:has-text("Estoque")');
  await page.waitForSelector('.readonly-note');
  ok(!(await page.locator('button:has-text("Novo item")').isVisible()), 'botões de edição escondidos no modo visualização');
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOTS + '/12-juliana-estoque.png' });
  r = await ask(page, 'Max, quantos postos temos?');
  ok(/não tem acesso/.test(r), 'Max respeita a permissão: ' + r.slice(0, 60));
  r = await ask(page, 'Max, abrir o setor financeiro');
  ok(!/Abrindo o setor/.test(r), 'quem não é master não troca de setor pela Max');
  await page.goto(B + '/hub');
  await page.waitForURL(B + '/setor/almoxarifado');
  ok(true, '/hub devolve a Juliana ao setor dela');
  await page.context().close();

  console.log('\n[4] Carla (master do RH): aba Equipe · Pedro (sem setor)');
  page = await newPage(browser);
  await login(page, 'carla');
  await page.waitForURL(B + '/setor/rh', { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.click('.nav-item:has-text("Equipe")');
  await page.waitForSelector('.user-row');
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS + '/13-rh-equipe.png' });
  ok(await page.locator('.user-row').count() >= 1, 'equipe do RH listada');
  await page.context().close();
  page = await newPage(browser);
  await login(page, 'pedro');
  await page.waitForURL(B + '/sem-setor', { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: SHOTS + '/14-sem-setor.png' });
  ok(/Quase lá, Pedro/.test(await page.locator('h1').textContent()), 'pessoa sem setor vê o aviso');
  await page.context().close();

  console.log('\n[5] Neilton (master do almoxarifado) ajusta permissões · celular');
  page = await newPage(browser, { mobile: true });
  await login(page, 'neilton');
  await page.waitForURL(B + '/setor/almoxarifado', { timeout: 15000 });
  await page.waitForSelector('.tabbar .tab');
  await page.waitForTimeout(1600);
  await page.screenshot({ path: SHOTS + '/15-mobile-almox.png' });
  await page.click('.tabbar .tab:has-text("Equipe")');
  await page.click('.user-row:has-text("Juliana") button');
  await page.waitForSelector('.perm');
  await page.locator('.perm-row:has-text("Postos") .perm-opt.view').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + '/16-mobile-permissoes.png' });
  await page.click('.modal.sheet .btn-primary');
  await page.waitForSelector('.modal.sheet', { state: 'detached' });
  ok(true, 'master do setor salvou permissões');
  r = await ask(page, 'Max, tem solicitação nova?');
  ok(/2 solicitações novas/.test(r), 'Max no celular: ' + r.slice(0, 60));
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOTS + '/17-mobile-max.png' });
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!over, 'sem rolagem lateral no celular');
  await page.context().close();
  page = await newPage(browser, { mobile: true });
  await page.goto(B + '/');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: SHOTS + '/18-mobile-login.png', fullPage: true });
  await page.context().close();

  console.log('\n[6] Navegador sem reconhecimento de voz');
  page = await newPage(browser, { speech: false });
  await page.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
  await page.goto(B + '/');
  await page.waitForTimeout(1000);
  ok(/não consigo ouvir/.test(await page.locator('.login-caption').textContent()), 'login explica que a escuta não existe neste navegador');
  await page.click('.login-orb-btn');
  await page.waitForSelector('.login-said', { state: 'attached' });
  ok(true, 'toque na esfera faz a Max se apresentar');
  await page.context().close();
} catch (e) {
  problems.push('EXCEÇÃO: ' + e.message.split('\n')[0]);
  console.log('EXCEÇÃO', e.message);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problema(s):\n- ` + problems.join('\n- ') : '\nTUDO CERTO');
process.exit(problems.length ? 1 : 0);
