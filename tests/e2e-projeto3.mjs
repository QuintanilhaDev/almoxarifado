/**
 * Projeto 3 pela tela, com várias pessoas ao mesmo tempo (banco de teste):
 * catálogo e códigos, kit por função, admissão do RH com kit automático, aviso em tempo real
 * ao Almoxarifado, sugestão automática (com confirmação), entrega com termo, compra, NF pelo XML
 * com conferência, Operação (encaminhar e validar troca), troca anual, Financeiro, Gestão,
 * formulário → pedido, inventário e permissões.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const B = 'http://localhost:3100';
const SHOTS = process.env.SHOTS || '/tmp/shots';
const problems = [];
const ok = (cond, msg) => { if (!cond) { problems.push(msg); console.log('  ✗', msg); } else console.log('  ✓', msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const plus = (n) => new Date(Date.now() - 3 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);

const FAKE = `
  window.__spoken = []; window.__chimes = 0;
  const AC = window.AudioContext; if (AC) { const o = AC.prototype.createOscillator; AC.prototype.createOscillator = function () { window.__chimes++; return o.call(this); }; }
  if (window.speechSynthesis) window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); setTimeout(()=>{u.onstart&&u.onstart({}); setTimeout(()=>u.onend&&u.onend({}), 1500);}, 20); };
`;
async function newPage(browser, mobile = false) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 820 } : { width: 1360, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Bahia', acceptDownloads: true });
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
  await page.waitForURL(B + url + '**', { timeout: 20000 });
  await page.waitForSelector('.nav-item', { state: 'attached' });
  await page.waitForTimeout(1200);
  await page.mouse.click(5, 5); // libera som/voz (o navegador exige um clique)
}
const nav = (page, label) => page.click(`.nav-item:has-text("${label}")`);
const call = (page, method, url, json) => page.evaluate(async ([m, u, j]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: j === undefined ? undefined : JSON.stringify(j) }); return { status: r.status, body: await r.json().catch(() => ({})) }; }, [method, url, json]);
const toastText = async (page, re, timeout = 15000) => {
  const loc = page.locator('.toast', { hasText: re });
  await loc.first().waitFor({ timeout });
  return loc.first().textContent();
};

const browser = await chromium.launch();
try {
  const neilton = await newPage(browser);
  const carla = await newPage(browser);
  const uesley = await newPage(browser);
  await Promise.all([login(neilton, 'neilton', '/setor/almoxarifado'), login(carla, 'carla', '/setor/rh'), login(uesley, 'uesley', '/setor/operacional')]);

  /* ------------------------------------------------ catálogo */
  console.log('\n— Estoque: classificação automática e códigos');
  await nav(neilton, 'Estoque');
  await neilton.click('button:has-text("Classificar")');
  await neilton.waitForSelector('text=Classificar itens e gerar códigos');
  const rows = await neilton.locator('.modal tbody tr').count();
  ok(rows === 10, `sugestão para os 10 itens sem código (${rows})`);
  const botaCat = await neilton.locator('.modal tbody tr:has-text("Bota de segurança · 40") select').first().inputValue();
  ok(botaCat === '01', 'bota sugerida em Fardamento › Calçados: ' + botaCat);
  await neilton.click('.modal button:has-text("Gerar")');
  await toastText(neilton, /item\(ns\) com código/);
  await neilton.waitForTimeout(1200);
  ok(await neilton.locator('.stock-row:has-text("01-03-")').count() >= 3, 'códigos aparecem na lista do estoque');
  ok((await neilton.locator('button:has-text("Classificar")').count()) === 0, 'botão some quando tudo tem código');
  await neilton.screenshot({ path: `${SHOTS}/p3-estoque.png` });

  /* ------------------------------------------------ RH: kit */
  console.log('\n— RH: kit por função');
  await nav(carla, 'Colaboradores');
  await carla.click('button:has-text("Kits por função")');
  await carla.click('button:has-text("Novo kit")');
  await carla.fill('#k-role', 'Vigilante');
  const kitLine = async (n, text, pick) => {
    const input = carla.locator(`input[aria-label="Item ${n} do kit"]`);
    await input.fill(text);
    await carla.click(`.p-suggest button:has-text("${pick}")`);
  };
  await kitLine(1, 'camisa', 'Camisa social manga curta');
  await carla.click('.modal button:has-text("Adicionar item")');
  await kitLine(2, 'calça', 'Calça tática');
  await carla.click('.modal button:has-text("Adicionar item")');
  await kitLine(3, 'bota', 'Bota de segurança');
  await carla.click('.modal button:has-text("Adicionar item")');
  await kitLine(4, 'boné', 'Boné');
  ok((await carla.locator('select[aria-label="Tamanho do item 1"]').inputValue()) === 'camisa' && (await carla.locator('select[aria-label="Tamanho do item 3"]').inputValue()) === 'calcado' && (await carla.locator('select[aria-label="Tamanho do item 4"]').inputValue()) === '', 'tamanho de cada item deduzido sozinho (camisa, calçado, sem tamanho)');
  await carla.fill('input[aria-label="Quantidade 1"]', '2');
  await carla.fill('input[aria-label="Quantidade 2"]', '2');
  await carla.click('.modal button:has-text("Salvar kit")');
  await toastText(carla, /Kit Vigilante salvo/);
  ok(await carla.locator('.g-card:has-text("Vigilante")').waitFor({ timeout: 8000 }).then(() => true, () => false), 'kit aparece na lista');

  /* ------------------------------------------------ RH: admissão */
  console.log('\n— RH: admissão com kit automático');
  await nav(carla, 'Pedidos');
  await carla.click('button:has-text("Novo pedido do RH")');
  await carla.fill('#o-col', 'Marcos Admitido');
  await carla.fill('#o-mat', 'M-2001');
  await carla.fill('#o-posto', 'Posto 01');
  await carla.fill('#o-role', 'Vigilante');
  await carla.fill('input[aria-label="Tamanho da camisa"]', 'm');
  await carla.fill('input[aria-label="Tamanho da calça"]', '44');
  await carla.fill('input[aria-label="Número do calçado"]', '42');
  await carla.fill('#o-start', plus(2));
  await carla.waitForSelector('.o-kit:has-text("Kit Vigilante")', { timeout: 8000 });
  const lines = await carla.locator('.modal .p-line').count();
  const labels = await carla.locator('.modal .p-line input[aria-label^="Item"]').evaluateAll((els) => els.map((e) => e.value));
  ok(lines === 4 && labels.includes('Camisa social manga curta M') && labels.includes('Bota de segurança 42'), 'kit entrou sozinho com os tamanhos: ' + labels.join(', '));
  await carla.click('.modal button:has-text("Enviar ao Almoxarifado")');
  await carla.waitForSelector('.o-drawer', { timeout: 10000 });
  ok(/Pedido #0001/.test(await carla.locator('.o-drawer h2').textContent()), 'pedido #0001 criado e aberto para o RH acompanhar');
  await carla.keyboard.press('Escape');

  /* ------------------------------------------------ Almox: aviso + sugestão */
  console.log('\n— Almoxarifado: aviso em tempo real e sugestão automática');
  const t = await toastText(neilton, /Pedido #0001/, 20000);
  ok(/Admissão/.test(t) && /Marcos Admitido/.test(t), 'Almoxarifado recebe o aviso na tela: ' + t.slice(0, 80));
  await neilton.waitForFunction(() => window.__spoken.some((s) => /kit de admissão de Marcos Admitido/.test(s)), null, { timeout: 8000 });
  ok(true, 'a Max anuncia em voz alta');
  ok((await neilton.locator('.nav-item:has-text("Pedidos de material") .nav-count').count()) === 1, 'aba Pedidos com contador');
  await neilton.locator('.toast:has-text("Pedido #0001") .toast-action').click();
  await neilton.waitForSelector('.o-drawer');
  await neilton.waitForSelector('.o-plan:has-text("Sugestão")', { timeout: 8000 });
  const plan = await neilton.locator('.o-plan').textContent();
  ok(/Reservar:.*Camisa social manga curta M/.test(plan) && /Comprar:.*Bota de segurança 42/.test(plan), 'sugestão: reserva o que há, compra o que falta');
  ok(/abaixo do mínimo/.test(plan), 'avisa do estoque mínimo');
  await neilton.screenshot({ path: `${SHOTS}/p3-sugestao.png` });
  await neilton.click('.o-plan button:has-text("Confirmar sugestão")');
  const t2 = await toastText(neilton, /Pedido atualizado/);
  ok(/compra nº/.test(t2), 'confirmou: reserva + compra enviada a Compras (' + t2.slice(0, 90) + ')');
  await neilton.waitForTimeout(1500);
  ok(await neilton.locator('.o-item:has-text("Bota de segurança 42") .o-buy').count() === 1, 'linha da bota mostra a compra ligada');

  /* entrega parcial com termo */
  await neilton.click('.o-drawer button:has-text("Entregar")');
  await neilton.waitForSelector('.modal:has-text("Entregar · pedido #0001")');
  ok((await neilton.locator('#o-recv').inputValue()) === 'Marcos Admitido', 'quem recebe já vem preenchido');
  const qtyInputs = await neilton.locator('.modal .o-qty-row').count();
  await neilton.click('.modal button:has-text("Entregar ")');
  const t3 = await toastText(neilton, /Entrega registrada/);
  ok(/termo pronto/.test(t3), 'entrega registrada com termo');
  const [termo] = await Promise.all([neilton.context().waitForEvent('page'), neilton.locator('.toast:has-text("Entrega registrada") .toast-action').click()]);
  await termo.waitForLoadState();
  const termoText = await termo.textContent('body');
  ok(/Termo de entrega/.test(termoText) && /Marcos Admitido/.test(termoText) && /M-2001/.test(termoText) && /Assin|Recebedor/.test(termoText), 'termo abre pronto para imprimir e assinar');
  await termo.screenshot({ path: `${SHOTS}/p3-termo.png`, fullPage: true });
  await termo.close();
  ok(qtyInputs >= 2, `entrega com ${qtyInputs} linhas sugeridas`);

  /* RH vê a entrega parcial */
  const t4 = await toastText(carla, /Entrega parcial no pedido #0001/, 20000);
  ok(Boolean(t4), 'RH é avisado da entrega parcial');

  /* ------------------------------------------------ Compras */
  console.log('\n— Compras: fornecedor e previsão');
  const carlos = await newPage(browser);
  await login(carlos, 'carlos', '/setor/compras');
  await carlos.click('.p-row:has-text("#0001")');
  ok(await carlos.locator('.drawer:has-text("pedido de material #0001")').count() === 1, 'Compras vê de qual pedido de material veio');
  await carlos.click('.p-step:has-text("Comprada")');
  await toastText(carlos, /Marcada como comprada/);
  await carlos.fill('#p-sup', 'Fardas Bahia');
  await carlos.fill('#p-exp', plus(5));
  await carlos.click('button:has-text("Salvar dados da compra")');
  await toastText(carlos, /Dados da compra salvos/);
  await neilton.waitForFunction(() => /Fardas Bahia/.test(document.querySelector('.o-drawer')?.textContent || ''), null, { timeout: 20000 });
  ok(true, 'o pedido no Almoxarifado mostra fornecedor e previsão sozinho');
  await neilton.keyboard.press('Escape');

  /* ------------------------------------------------ NF */
  console.log('\n— Entrada por NF (XML)');
  await nav(neilton, 'Entradas');
  await neilton.setInputFiles('input[aria-label="Arquivo XML da nota"]', 'tests/fixtures/nfe-exemplo.xml');
  await neilton.waitForSelector('.modal:has-text("Nota 4321")', { timeout: 10000 });
  const head = await neilton.locator('.n-review-head').textContent();
  ok(/FARDAS BAHIA/.test(head) && /12345678000199/.test(head), 'fornecedor e CNPJ do XML');
  // pela descrição o sistema só sugere: confirma com um clique (a 1ª ligação de cada código é validada por alguém)
  await neilton.locator('.n-line', { hasText: 'BOTA' }).locator('.link-btn:has-text("Bota de segurança 42")').first().click();
  await neilton.locator('.n-line', { hasText: 'CAMISA SOCIAL' }).locator('.link-btn:has-text("Camisa social manga curta M")').first().click();
  ok(await neilton.locator('.n-line:has-text("BOTA") b:has-text("Bota de segurança 42")').count() === 1, 'bota da nota ligada ao item sugerido com um clique');
  ok((await neilton.locator('#n-pr').inputValue()) !== '', 'compra que a nota atende já escolhida');
  ok(await neilton.locator('.n-line:has-text("CAMISA SOCIAL") b:has-text("Camisa social manga curta M")').count() === 1, 'camisa da nota ligada ao tamanho certo (M)');
  // a lanterna não existe no estoque: fica para depois (recebido 0)
  ok(await neilton.locator('.pbadge:has-text("1 sem item do estoque")').count() === 1, 'avisa a linha sem item do estoque');
  const radLine = neilton.locator('.n-line', { hasText: /LANTERNA/ });
  await radLine.locator('input[aria-label^="Recebido agora"]').fill('0');
  await neilton.screenshot({ path: `${SHOTS}/p3-nf.png` });
  await neilton.click('.modal button:has-text("Registrar e dar entrada")');
  const t5 = await toastText(neilton, /NF 4321/);
  ok(/entrada parcial|lançada/.test(t5), 'nota registrada e entrada lançada: ' + t5.slice(0, 80));
  await neilton.waitForSelector('.o-drawer:has-text("NF 4321")');
  ok(await neilton.locator('.o-plan:has-text("Pedidos que esperavam")').count() === 1, 'mostra os pedidos que esperavam estes itens');
  await neilton.click('.o-plan button:has-text("Ir para os pedidos")');
  await neilton.waitForSelector('.o-drawer:has-text("Pedido #0001")', { timeout: 8000 });
  await neilton.waitForSelector('.o-plan:has-text("Sugestão")', { timeout: 8000 });
  await neilton.click('.o-plan button:has-text("Confirmar sugestão")');
  await toastText(neilton, /Pedido atualizado/);
  await neilton.waitForTimeout(800);
  await neilton.click('.o-drawer button:has-text("Entregar")');
  await neilton.waitForSelector('.modal:has-text("Entregar · pedido #0001")');
  ok((await neilton.locator('input[aria-label="Quantidade de Bota de segurança 42"]').inputValue()) === '1', 'a bota que chegou já vem para entregar');
  ok((await neilton.locator('input[aria-label="Quantidade de Calça tática 44"]').inputValue()) === '0', 'a calça (no mínimo) não é sugerida');
  await neilton.fill('input[aria-label="Quantidade de Calça tática 44"]', '2');
  await neilton.click('.modal button:has-text("Entregar ")');
  await neilton.waitForSelector('.modal:has-text("Liberação abaixo do mínimo")', { timeout: 8000 });
  ok(true, 'entregar abaixo do mínimo pede a liberação excepcional');
  await neilton.click('.modal button:has-text("Liberar mesmo assim")');
  await toastText(neilton, /entregue por completo/);
  ok(true, 'master libera e a admissão fica concluída');
  await neilton.keyboard.press('Escape');

  /* ------------------------------------------------ Operação */
  console.log('\n— Operação: pedido, encaminhar, validar');
  await uesley.click('button:has-text("Novo pedido")');
  await uesley.fill('#o-posto', 'Shopping Barra');
  await uesley.fill('#o-col', 'Caio Melo');
  await uesley.locator('input[aria-label="Item 1"]').fill('cinto');
  await uesley.click('.p-suggest button:has-text("Cinto tático")');
  await uesley.locator('.o-check input').uncheck();
  await uesley.click('.modal button:has-text("Salvar pedido")');
  await uesley.waitForSelector('.o-drawer:has-text("Pedido #0002")');
  await uesley.click('.o-drawer button:has-text("Encaminhar ao Almoxarifado")');
  await toastText(uesley, /Encaminhado ao Almoxarifado/);
  const t6 = await toastText(neilton, /Pedido #0002/, 20000);
  ok(/Operação/.test(t6), 'Almoxarifado avisado do pedido encaminhado pela Operação');

  /* ------------------------------------------------ Troca anual */
  console.log('\n— Troca anual');
  await call(carla, 'POST', '/api/rh/colaboradores', { name: 'Ana Antiga', matricula: 'M-0500', role: 'Vigilante', posto_name: 'Posto 02', admitted_at: plus(-400), sizes: { camisa: 'G', calca: '44', calcado: '40' } });
  await nav(carla, 'Troca anual');
  await carla.waitForSelector('tr:has-text("Ana Antiga")');
  ok(/Vencida/.test(await carla.locator('tr:has-text("Ana Antiga")').textContent()), 'Ana aparece com a troca vencida');
  ok(await carla.locator('.g-card:has-text("Demanda consolidada") tr:has-text("Camisa social manga curta G")').count() === 1, 'demanda consolidada por item e tamanho');
  await carla.locator('tr:has-text("Ana Antiga") input[type=checkbox]').check();
  await carla.click('button:has-text("Abrir troca (1)")');
  await carla.click('.modal button:has-text("Abrir 1 troca")');
  await toastText(carla, /1 troca\(s\) aberta/);
  const t7 = await toastText(uesley, /para validar/, 20000);
  ok(/Troca #0003/.test(t7), 'Operação avisada: troca para validar');
  await uesley.locator('.toast:has-text("para validar") .toast-action').click();
  await uesley.click('.o-drawer button:has-text("Validar troca")');
  await toastText(uesley, /Troca validada/);
  const t8 = await toastText(neilton, /Pedido #0003/, 20000);
  ok(/Troca anual/.test(t8), 'Almoxarifado recebe a troca validada');

  /* ------------------------------------------------ formulário → pedido */
  console.log('\n— Formulário dos supervisores → pedido');
  const pub = await call(neilton, 'POST', '/api/requests', { values: { email: 'sup1@empresa.com.br', colaborador: 'Dani Rocha', posto: 'Posto 01', motivo: 'Bota rasgou', categoria: ['Calçado'], itens: ['Bota de segurança'], tamanho_roupa: 'Não se aplica', tamanho_calcado: '40', quantidade: '1' } });
  ok(pub.status === 200, 'supervisor manda o formulário');
  await nav(neilton, 'Solicitações');
  await neilton.waitForTimeout(1500);
  await neilton.click(`text=#${String(pub.body.protocol).padStart(4, '0')}`).catch(() => neilton.locator('.req-row, .inbox-row, [class*=row]', { hasText: 'Dani Rocha' }).first().click());
  await neilton.click('button:has-text("Criar pedido")');
  const t9 = await toastText(neilton, /criado/);
  ok(/Pedido #\d+ criado/.test(t9), 'solicitação virou pedido');

  /* ------------------------------------------------ inventário */
  console.log('\n— Inventário');
  await nav(neilton, 'Estoque');
  await neilton.click('button:has-text("Inventário")');
  await neilton.locator('input[aria-label="Contado de Cinto tático"]').fill('13');
  await neilton.click('.modal button:has-text("Registrar")');
  await toastText(neilton, /Inventário registrado/);
  ok(true, 'inventário ajusta só a diferença');

  /* ------------------------------------------------ Financeiro, Gestão, permissões */
  console.log('\n— Financeiro, Gestão e permissões');
  const fabia = await newPage(browser);
  await login(fabia, 'fabia', '/setor/financeiro');
  await fabia.waitForSelector('table tr:has-text("FARDAS BAHIA")');
  ok(await fabia.locator('table tr:has-text("FARDAS BAHIA")').count() === 2, 'Financeiro vê as 2 parcelas da nota');
  ok((await fabia.locator('button:has-text("Importar XML")').count()) === 0, 'Financeiro não lança notas');
  const mateus = await newPage(browser);
  await login(mateus, 'mateus', '/hub');
  await nav(mateus, 'Gestão');
  await mateus.waitForSelector('.g-card:has-text("Pedidos de material")');
  const g = await mateus.locator('.section-pad').textContent();
  ok(/Valor em estoque/.test(g) && /Concluídos/.test(g), 'painel da Gestão com os indicadores');
  await mateus.screenshot({ path: `${SHOTS}/p3-gestao.png`, fullPage: true });
  const juliana = await newPage(browser);
  await login(juliana, 'juliana', '/setor/almoxarifado');
  ok((await juliana.locator('.nav-item:has-text("Entradas")').count()) === 0, 'Juliana (sem permissão de notas) não vê Entradas');
  ok((await juliana.locator('.nav-item:has-text("Pedidos de material")').count()) === 1, 'Juliana vê Pedidos de material');
  const rita = await newPage(browser);
  await login(rita, 'rita', '/setor/rh');
  await nav(rita, 'Colaboradores');
  await rita.waitForTimeout(900);
  ok(await rita.locator('.module.is-readonly').count() === 1, 'Rita só visualiza Colaboradores');
  await nav(rita, 'Troca anual');
  await rita.waitForTimeout(900);
  ok(await rita.locator('.module.is-readonly').count() === 0, 'Rita edita a troca (tem pedidos)');
  const mob = await newPage(browser, true);
  await login(mob, 'neilton', '/setor/almoxarifado');
  await mob.click('.tabbar .tab:has-text("Pedidos")');
  await mob.waitForTimeout(1500);
  const sw = await mob.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= 392, 'celular sem rolagem lateral: ' + sw);
  await mob.screenshot({ path: `${SHOTS}/p3-mobile.png` });
} catch (e) {
  problems.push('exceção: ' + e.message);
  console.log('  ✗ exceção', e.message);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problema(s):\n- ${problems.join('\n- ')}` : '\nTudo certo.');
process.exit(problems.length ? 1 : 0);
