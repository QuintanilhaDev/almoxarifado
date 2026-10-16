/**
 * Uma nota fiscal com itens de VÁRIOS pedidos de compra do mesmo fornecedor, nas telas:
 *  1. "Receber pelo pedido": a tela oferece o outro pedido do fornecedor e o DANFE que cita
 *     o pedido já o inclui; cada linha baixa o seu pedido.
 *  2. XML com 8 camisas para dois pedidos (5 + 3): a linha é dividida entre eles sozinha.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const PDFDocument = require('pdfkit');
const B = 'http://localhost:3100';
const SHOTS = process.env.SHOTS || '/tmp/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const problems = [];
const ok = (cond, msg) => { if (!cond) { problems.push(msg); console.log('  ✗', msg); } else console.log('  ✓', msg); };

function makeKey(cnpj, series, number) {
  const base = '29' + '2610' + cnpj + '55' + String(series).padStart(3, '0') + String(number).padStart(9, '0') + '1' + '12345678';
  let w = 2, s = 0;
  for (let i = base.length - 1; i >= 0; i--) { s += Number(base[i]) * w; w = w === 9 ? 2 : w + 1; }
  return base + (s % 11 < 2 ? 0 : 11 - (s % 11));
}
async function danfePdf(key, total, lines = []) {
  const doc = new PDFDocument();
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.fontSize(14).text('DANFE');
  doc.fontSize(10).text('DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRÔNICA');
  doc.text('CHAVE DE ACESSO');
  doc.text(key.replace(/(\d{4})(?=\d)/g, '$1 '));
  doc.text('DATA DA EMISSÃO 16/10/2026');
  doc.text(`VALOR TOTAL DA NOTA ${total}`);
  for (const l of lines) doc.text(l);
  doc.end();
  await new Promise((r) => doc.on('end', r));
  return Buffer.concat(chunks);
}
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function session(user, url) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'pt-BR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { problems.push(`pageerror (${user}): ${e.message}`); console.log('  ! pageerror', user, e.message); });
  await page.goto(B + '/');
  await page.fill('#user', user);
  await page.fill('#pass', '123456');
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.endsWith('/') || u.pathname.length > 1, { timeout: 30000 });
  await page.waitForTimeout(1500);
  if (url) {
    await page.goto(B + url);
    await page.waitForTimeout(2500);
  }
  return page;
}
const api = (page, path, method = 'GET', body) => page.evaluate(async ([p, m, b]) => { const r = await fetch(p, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; }, [path, method, body]);
const nav = async (page, label) => {
  for (let i = 0; i < 3 && (await page.locator('.drawer-overlay, .overlay').count()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  await page.click(`.nav-item:has-text("${label}")`);
  await page.waitForTimeout(1200);
};
const toast = async (page, re, timeout = 12000) => { await page.waitForFunction((src) => [...document.querySelectorAll('.toast, [role=status]')].some((t) => new RegExp(src).test(t.textContent)), re.source, { timeout }); };

const lbl = (n) => 'PC ' + String(n).padStart(4, '0');
try {
  console.log('\n[0] Preparação: dois pedidos da Marvin');
  const carlos = await session('carlos', '/setor/compras');
  const mateus = await session('mateus');
  let r = await api(carlos, '/api/compras/fornecedores', 'POST', { name: 'Marvin Uniformes', cnpj: '45723174000110', category: 'uniformes' });
  const marvin = r.body.supplier;
  await api(carlos, `/api/compras/fornecedores/${marvin.id}/perfil`, 'PATCH', { homologation: 'homologado', lead_days: 5 });
  const neilton = await session('neilton', '/setor/almoxarifado#estoque');
  const items = (await api(neilton, '/api/almoxarifado/stock')).body.items;
  const cam = items.find((i) => i.name === 'Camisa social manga curta' && i.size === 'M');
  const radio = items.find((i) => i.name === 'Rádio comunicador');
  const order = async (item, name, size, qty, price) => {
    const x = await api(carlos, '/api/compras/pedidos', 'POST', { supplier_id: marvin.id, reason: 'Contrato Marvin', items: [{ item_id: item.id, name, size, qty, unit_price: price }] });
    await api(carlos, `/api/compras/pedidos/${x.body.order.id}`, 'PATCH', { action: 'submit' });
    const y = await api(mateus, `/api/compras/pedidos/${x.body.order.id}`, 'PATCH', { action: 'approve' });
    return y.body.order;
  };
  const pA = await order(cam, 'Camisa social manga curta', 'M', 5, 40);
  const pB = await order(radio, 'Rádio comunicador', null, 3, 12);
  ok(pA?.status === 'aprovado' && pB?.status === 'aprovado', `${lbl(pA.number)} (5 camisas) e ${lbl(pB.number)} (3 rádios) aprovados`);

  console.log('\n[1] Receber pelo pedido: a nota traz os dois pedidos');
  await nav(neilton, 'Compras');
  await neilton.waitForSelector(`.pc-card li:has-text("${lbl(pA.number)}")`, { timeout: 20000 });
  await neilton.click(`.pc-card li:has-text("${lbl(pA.number)}") button:has-text("Receber")`);
  await neilton.waitForSelector('text=Receber mercadoria pelo pedido', { timeout: 15000 });
  await neilton.waitForSelector(`.pc-po-chip.is-add:has-text("${lbl(pB.number)}")`, { timeout: 15000 });
  ok(/Veio mais algum pedido/.test(await neilton.locator('.pc-po-plan').textContent()), `a tela oferece o ${lbl(pB.number)} do mesmo fornecedor`);
  const key = makeKey('45723174000110', 1, 8801);
  await neilton.setInputFiles('input[aria-label="DANFE"]', { name: 'danfe.pdf', mimeType: 'application/pdf', buffer: await danfePdf(key, '236,00', ['CAMISA SOCIAL MANGA CURTA M  UN 5 40,00 200,00', 'RADIO COMUNICADOR  UN 3 12,00 36,00', `INFORMACOES COMPLEMENTARES: Seu pedido nº ${pB.number}`]) });
  await neilton.waitForSelector('text=Lido do DANFE', { timeout: 20000 });
  await neilton.waitForSelector(`text=Incluí o ${lbl(pB.number)}`, { timeout: 8000 });
  ok(true, `o DANFE cita o ${lbl(pB.number)}: incluído sozinho`);
  ok((await neilton.locator('.n-review-head').textContent()).includes(`${lbl(pA.number)} + ${lbl(pB.number)}`), 'cabeçalho mostra os dois pedidos');
  ok((await neilton.locator('.pc-lines tbody tr').count()) === 2, 'linhas dos dois pedidos na conferência');
  await neilton.waitForTimeout(300);
  ok(/bate com o total/.test(await neilton.locator('.pc-inst').textContent()), 'parcelas somam o total da nota (R$ 236,00)');
  await neilton.check('text=Conferi as parcelas com o boleto/DANFE');
  await neilton.screenshot({ path: SHOTS + '/np-receber-dois.png' });
  await neilton.click('button:has-text("Registrar e dar entrada")');
  await toast(neilton, /entrada confirmada/);
  const t1 = await neilton.evaluate(() => [...document.querySelectorAll('.toast, [role=status]')].map((t) => t.textContent).join(' | '));
  ok(t1.includes(lbl(pA.number)) && t1.includes(lbl(pB.number)), 'o aviso cita os dois pedidos: ' + t1.slice(0, 160));
  r = await api(neilton, '/api/compras/pedidos');
  ok(r.body.orders.find((o) => o.id === pA.id)?.status === 'concluido' && r.body.orders.find((o) => o.id === pB.id)?.status === 'concluido', 'os dois pedidos ficaram concluídos');
  await neilton.waitForSelector('.drawer:has-text("NF 8801")', { timeout: 15000 });
  ok((await neilton.locator('.drawer button:has-text("Ver o PC")').count()) === 2, 'a nota mostra os dois pedidos');
  ok((await neilton.locator('.drawer .n-po-tag').count()) >= 2, 'cada item mostra o seu pedido');
  await neilton.screenshot({ path: SHOTS + '/np-nota-dois.png' });
  await neilton.keyboard.press('Escape');

  console.log('\n[2] XML: 8 camisas numa linha, para dois pedidos (5 + 3)');
  const pC = await order(cam, 'Camisa social manga curta', 'M', 5, 40);
  const pD = await order(cam, 'Camisa social manga curta', 'M', 3, 40);
  const k2 = makeKey('45723174000110', 1, 8802);
  const xml = `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${k2}" versao="4.00"><ide><serie>1</serie><nNF>8802</nNF><dhEmi>2026-10-16T10:00:00-03:00</dhEmi></ide><emit><CNPJ>45723174000110</CNPJ><xNome>MARVIN UNIFORMES LTDA</xNome></emit><dest><CNPJ>11222333000144</CNPJ><xNome>MAX FORTE</xNome></dest><det nItem="1"><prod><cProd>CSMC-M</cProd><xProd>CAMISA SOCIAL MC TAM M</xProd><uCom>UN</uCom><qCom>8</qCom><vUnCom>40.00</vUnCom><vProd>320.00</vProd></prod></det><total><ICMSTot><vProd>320.00</vProd><vNF>320.00</vNF></ICMSTot></total><cobr><dup><nDup>001</nDup><dVenc>2026-11-16</dVenc><vDup>320.00</vDup></dup></cobr><infAdic><infCpl>Pedidos ${String(pC.number).padStart(4, '0')} e ${String(pD.number).padStart(4, '0')}</infCpl></infAdic></infNFe></NFe></nfeProc>`;
  await nav(neilton, 'Entradas');
  await neilton.setInputFiles('input[aria-label="Arquivo XML da nota"]', { name: 'marvin.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) });
  await neilton.waitForSelector('.modal:has-text("Nota 8802")', { timeout: 15000 });
  await neilton.waitForSelector('button:has-text("Confirmar a sugestão dos pedidos")', { timeout: 8000 });
  ok(true, 'código novo: a camisa vem sugerida porque está nos pedidos em aberto');
  await neilton.click('button:has-text("Confirmar a sugestão dos pedidos")');
  await neilton.waitForSelector('.pc-po-plan:has-text("atende 2 pedidos")', { timeout: 8000 });
  const tags = await neilton.locator('.n-line .n-po-tag').allTextContents();
  ok(tags.length === 2 && tags.some((t) => t.includes(lbl(pC.number)) && /· 5/.test(t)) && tags.some((t) => t.includes(lbl(pD.number)) && /· 3/.test(t)), 'a linha de 8 aparece dividida: 5 no primeiro pedido e 3 no segundo — ' + tags.join(' | '));
  await neilton.screenshot({ path: SHOTS + '/np-xml-dividida.png' });
  await neilton.click('.modal button:has-text("Registrar e dar entrada")');
  await toast(neilton, /NF 8802/);
  r = await api(neilton, '/api/compras/pedidos');
  ok(r.body.orders.find((o) => o.id === pC.id)?.status === 'concluido' && r.body.orders.find((o) => o.id === pD.id)?.status === 'concluido', 'os dois pedidos de camisa ficaram concluídos');
  const st = (await api(neilton, '/api/almoxarifado/stock')).body.items;
  ok(st.find((i) => i.id === cam.id).quantity === cam.quantity + 13, `estoque de camisas +13 (5 da 1ª nota + 8 desta): ${cam.quantity} → ${st.find((i) => i.id === cam.id).quantity}`);
  await neilton.waitForSelector('.drawer:has-text("NF 8802")', { timeout: 15000 });
  ok((await neilton.locator('.drawer .o-note:has-text("Parte 1 de 2")').count()) === 1, 'a nota mostra a linha dividida (parte 1 de 2, parte 2 de 2)');
  await neilton.screenshot({ path: SHOTS + '/np-nota-dividida.png' });
  // tema claro
  await neilton.evaluate(() => localStorage.setItem('maxhub-theme', 'light'));
  await neilton.reload();
  await neilton.waitForTimeout(2500);
  await nav(neilton, 'Entradas');
  await neilton.click('[aria-label="Abrir nota 8802"]');
  await neilton.waitForSelector('.drawer:has-text("NF 8802")', { timeout: 15000 });
  await neilton.screenshot({ path: SHOTS + '/np-nota-claro.png' });
} catch (e) {
  problems.push('EXCEÇÃO ' + e.message);
  console.log('EXCEÇÃO', e);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problema(s):\n- ` + problems.join('\n- ') : '\nTUDO CERTO');
process.exit(problems.length ? 1 : 0);
