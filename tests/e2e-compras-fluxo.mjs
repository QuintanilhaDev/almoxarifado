/**
 * Fluxo completo nas telas: solicitação → cotação (mapa) → pedido de compra → aprovação →
 * envio → recebimento pelo pedido com DANFE (PDF e foto do código de barras) → divergência
 * tratada por Compras → entrada no estoque.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
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
async function danfePdf(key, total) {
  const doc = new PDFDocument();
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.fontSize(14).text('DANFE');
  doc.fontSize(10).text('DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRÔNICA');
  doc.text('CHAVE DE ACESSO');
  doc.text(key.replace(/(\d{4})(?=\d)/g, '$1 '));
  doc.text('DATA DA EMISSÃO 16/10/2026');
  doc.text(`VALOR TOTAL DA NOTA ${total}`);
  doc.end();
  await new Promise((r) => doc.on('end', r));
  return Buffer.concat(chunks);
}
/** PNG (sem dependências) com o código de barras CODE-128 da chave, como numa foto do DANFE */
function barcodePng(text) {
  // CODE-128 conjunto C (pares de dígitos), como o DANFE: início 105, pares, dígito verificador, fim 106
  const P = require('@zxing/library/cjs/core/oned/Code128Reader').default.CODE_PATTERNS;
  const codes = [105];
  for (let i = 0; i < text.length; i += 2) codes.push(Number(text.slice(i, i + 2)));
  codes.push(codes.reduce((t, c, i) => t + c * (i || 1), 0) % 103, 106);
  const bars = [];
  for (const c of codes) [...P[c]].forEach((w, k) => { for (let j = 0; j < w; j++) bars.push(k % 2 === 0); });
  const mod = 3;
  const m = { getWidth: () => bars.length * mod, getHeight: () => 140, get: (x) => bars[Math.floor(x / mod)] };
  const W = m.getWidth() + 80, H = m.getHeight() + 80;
  const raw = Buffer.alloc((W * 3 + 1) * H, 255);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const bx = x - 40, by = y - 40;
      const black = bx >= 0 && by >= 0 && bx < m.getWidth() && by < m.getHeight() && m.get(bx, by);
      if (black) raw.fill(0, y * (W * 3 + 1) + 1 + x * 3, y * (W * 3 + 1) + 4 + x * 3);
    }
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
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

try {
  /* ------------------------------------------------ preparação (pela API) */
  console.log('\n[0] Preparação');
  const carlos = await session('carlos', '/setor/compras');
  let r = await api(carlos, '/api/compras/fornecedores', 'POST', { name: 'Fardas Bahia Ltda', cnpj: '11222333000181', email: 'vendas@fardas.com', category: 'fardamento, calças, botas' });
  const fardas = r.body.supplier;
  await api(carlos, `/api/compras/fornecedores/${fardas.id}/perfil`, 'PATCH', { homologation: 'homologado', lead_days: 5 });
  r = await api(carlos, '/api/compras/fornecedores', 'POST', { name: 'Calçados Norte', cnpj: '11444777000161', category: 'botas e calçados' });
  const norte = r.body.supplier;
  await api(carlos, `/api/compras/fornecedores/${norte.id}/perfil`, 'PATCH', { homologation: 'homologado' });
  const neilton = await session('neilton', '/setor/almoxarifado#estoque');
  const items = (await api(neilton, '/api/almoxarifado/stock')).body.items;
  const bota = items.find((i) => i.name === 'Bota de segurança' && i.size === '42');
  const calca = items.find((i) => i.name === 'Calça tática' && i.size === '44');
  r = await api(neilton, '/api/compras/requests', 'POST', { items: [{ item_id: bota.id, quantity: 10 }, { item_id: calca.id, quantity: 6 }], reason: 'Reposição', priority: 'urgente' });
  ok(r.status === 200, 'Almoxarifado pediu compra (bota 42 × 10, calça 44 × 6)');

  /* ------------------------------------------------ Compras: painel → cotação */
  console.log('\n[1] Compras: painel, cotação e mapa');
  await carlos.goto(B + '/setor/compras#painel');
  await carlos.reload(); // a sessão abriu antes da solicitação existir
  await carlos.waitForSelector('.pc-todo', { timeout: 20000 });
  ok(/1 solicitação nova/.test(await carlos.locator('.pc-card').first().textContent()), 'painel mostra a solicitação nova em "Precisa de você"');
  await carlos.screenshot({ path: SHOTS + '/pc-painel.png' });
  await carlos.click('.pc-todo button:has-text("Cotar")');
  await carlos.waitForSelector('text=Nova cotação');
  await carlos.click('button:has-text("Abrir cotação")');
  await carlos.waitForSelector('.pc-sups', { timeout: 15000 });
  const sups = await carlos.locator('.pc-sup b').allTextContents();
  ok(sups.some((s) => /Fardas/.test(s)) && sups.some((s) => /Norte/.test(s)), 'os fornecedores do ramo entraram sozinhos: ' + sups.join(', '));
  // proposta da Fardas pela tela
  await carlos.locator('.pc-sup', { hasText: 'Fardas' }).locator('button:has-text("Registrar resposta")').click();
  await carlos.waitForSelector('text=Proposta · Fardas');
  await carlos.fill('input[aria-label="Preço de Bota de segurança"]', '100');
  await carlos.fill('input[aria-label="Primeiro preço de Bota de segurança"]', '108');
  await carlos.fill('input[aria-label="Preço de Calça tática"]', '80');
  await carlos.fill('#pp-fr', '20');
  await carlos.fill('input[aria-label="Prazo em dias"]', '5');
  await carlos.click('button:has-text("Salvar proposta")');
  await carlos.waitForSelector('text=Proposta · Fardas', { state: 'detached' });
  // proposta da Norte (só bota, mais cara) pela API
  const quotes = (await api(carlos, '/api/compras/cotacoes')).body.quotes;
  const q = quotes[0];
  const pN = q.proposals.find((p) => p.supplier_id === norte.id);
  const kB = q.items.find((i) => i.item_id === bota.id).key;
  await api(carlos, `/api/compras/cotacoes/${q.id}`, 'PATCH', { action: 'proposal', proposal: { id: pN.id, status: 'recebida', valid_until: '2026-12-31', lines: [{ key: kB, unit_price: 115 }], delivery: { days: 2 } } });
  await carlos.waitForFunction(() => document.querySelectorAll('.pc-map th.n').length >= 2, null, { timeout: 45000 });
  ok((await carlos.locator('.pc-cell.is-best.is-chosen').count()) === 2, 'o mapa já vem com a melhor opção marcada em cada item');
  ok(/menor custo de cada item/.test(await carlos.locator('.pc-decide').textContent()), 'sem justificativa quando segue a recomendação');
  await carlos.screenshot({ path: SHOTS + '/pc-mapa.png' });
  await carlos.click('button:has-text("Decidir e gerar pedido de compra")');
  await toast(carlos, /PC 0001 gerado/);
  await carlos.waitForSelector('.drawer h2:has-text("PC 0001")', { timeout: 15000 });
  ok(/Rascunho/.test(await carlos.locator('.drawer .p-title').textContent()), 'pedido de compra gerado em rascunho, já aberto');
  await carlos.click('.drawer button:has-text("Mandar para aprovação")');
  await toast(carlos, /Enviado para aprovação/);
  await carlos.waitForSelector('.drawer .p-title:has-text("Aguardando aprovação")', { timeout: 10000 });
  ok(true, 'aguardando aprovação');
  ok((await carlos.locator('.drawer button:has-text("Aprovar")').count()) === 1, 'Carlos vê o botão, mas o sistema não deixa aprovar o próprio pedido');
  await carlos.click('.drawer button:has-text("Aprovar")');
  await carlos.waitForSelector('.drawer .sx-error:has-text("próprio")');

  /* ------------------------------------------------ aprovação */
  console.log('\n[2] Aprovação (master geral)');
  const mateus = await session('mateus', '/setor/compras#pedidos-compra');
  await mateus.click('[role=tablist] button:has-text("Para aprovar")');
  await mateus.click('[data-max-pc="1"]');
  await mateus.click('.drawer button:has-text("Aprovar")');
  await toast(mateus, /Pedido aprovado/);
  await mateus.waitForSelector('.drawer :text("Aprovado por Mateus")', { timeout: 10000 });
  ok(true, 'aprovado pelo master geral');
  await mateus.context().close();

  console.log('\n[3] Envio ao fornecedor');
  await carlos.reload();
  await carlos.waitForTimeout(2500);
  await carlos.click('[data-max-pc="1"]');
  await carlos.click('.drawer button:has-text("Enviar ao fornecedor")');
  await carlos.click('button:has-text("Marcar como enviado")');
  await toast(carlos, /enviado ao fornecedor/i);
  await carlos.waitForSelector('.drawer .p-title:has-text("Enviado ao fornecedor")', { timeout: 10000 });
  ok(/Previsão/.test(await carlos.locator('.drawer .mini-stats').textContent()), 'pedido enviado; previsão calculada');

  /* ------------------------------------------------ recebimento (DANFE em PDF) */
  console.log('\n[4] Almoxarifado: painel do recebimento e recebimento com DANFE');
  await nav(neilton, 'Compras');
  await neilton.waitForSelector('text=Painel do recebimento', { timeout: 20000 });
  await neilton.waitForSelector('.pc-card li:has-text("PC 0001")', { timeout: 20000 });
  ok(true, 'painel do recebimento mostra o PC 0001 chegando');
  await neilton.screenshot({ path: SHOTS + '/pc-recebimento.png' });
  await neilton.click('.pc-card li:has-text("PC 0001") button:has-text("Receber")');
  await neilton.waitForSelector('text=Receber mercadoria pelo pedido', { timeout: 15000 });
  const key = makeKey('11222333000181', 1, 7001);
  await neilton.setInputFiles('input[aria-label="DANFE"]', { name: 'danfe.pdf', mimeType: 'application/pdf', buffer: await danfePdf(key, '1.512,00') });
  await neilton.waitForSelector('text=Lido do DANFE', { timeout: 20000 });
  ok((await neilton.inputValue('#rv-num')) === '7001' && (await neilton.inputValue('#rv-key')).replace(/\D/g, '') === key, 'PDF do DANFE: chave lida, número e série preenchidos sozinhos');
  ok((await neilton.inputValue('#rv-total')) === '1512', 'valor total lido do DANFE');
  // calça veio a 82 na nota (pedido 80)
  await neilton.fill('input[aria-label="Preço na nota de Calça tática · 44"]', '82');
  await neilton.fill('#rv-total', '1512');
  await neilton.waitForTimeout(300);
  const instText = await neilton.locator('.pc-inst').textContent();
  ok(/bate com o total/.test(instText), 'parcelas sugeridas pela condição do pedido já somam o total');
  await neilton.check('text=Conferi as parcelas com o boleto/DANFE');
  await neilton.screenshot({ path: SHOTS + '/pc-receber.png' });
  await neilton.click('button:has-text("Registrar e dar entrada")');
  await toast(neilton, /aguardando Compras/);
  ok(true, 'com preço diferente, a nota fica registrada esperando Compras (sem entrada)');
  let stock = (await api(neilton, '/api/almoxarifado/stock')).body.items;
  ok(stock.find((i) => i.id === calca.id).quantity === calca.quantity, 'estoque não mudou ainda');
  await neilton.waitForSelector('.drawer .pc-div.is-block', { timeout: 15000 });
  ok(/Preço diferente do pedido/.test(await neilton.locator('.drawer .pc-divs').textContent()), 'a nota aberta mostra a divergência de preço');

  /* ------------------------------------------------ Compras trata a divergência */
  console.log('\n[5] Compras trata a divergência pelo painel');
  await nav(carlos, 'Painel');
  await carlos.waitForSelector('.pc-todo li.is-red:has-text("NF 7001")', { timeout: 20000 });
  await carlos.click('.pc-todo li.is-red:has-text("NF 7001") button:has-text("Abrir")');
  await carlos.fill('#dv-text', 'Reajuste de R$ 2 autorizado pela gestão');
  await carlos.click('button:has-text("Registrar")');
  await toast(carlos, /autorizada/);
  ok(true, 'divergência autorizada por Compras');

  /* ------------------------------------------------ entrada */
  console.log('\n[6] Almoxarifado confirma a entrada');
  await neilton.keyboard.press('Escape');
  await nav(neilton, 'Entradas');
  await neilton.waitForSelector('[aria-label="Abrir nota 7001"]', { timeout: 20000 });
  await neilton.click('[aria-label="Abrir nota 7001"]');
  await neilton.waitForSelector('.drawer button:has-text("Conferir e dar entrada")');
  await neilton.click('.drawer button:has-text("Conferir e dar entrada")');
  await toast(neilton, /Entrada confirmada/);
  stock = (await api(neilton, '/api/almoxarifado/stock')).body.items;
  ok(stock.find((i) => i.id === calca.id).quantity === calca.quantity + 6 && stock.find((i) => i.id === bota.id).quantity === bota.quantity + 10, 'estoque recebeu +6 calças e +10 botas');
  r = await api(neilton, '/api/compras/pedidos');
  ok(r.body.orders[0].status === 'concluido', 'pedido de compra concluído sozinho');
  r = await api(carlos, '/api/compras/requests');
  ok(r.body.requests[0].status === 'entregue', 'solicitação de compra virou "Entregue"');

  /* ------------------------------------------------ foto do DANFE (código de barras) */
  console.log('\n[7] Foto do DANFE: leitura do código de barras');
  r = await api(carlos, '/api/compras/pedidos', 'POST', { supplier_id: fardas.id, reason: 'teste da foto', items: [{ item_id: bota.id, name: 'Bota de segurança', size: '42', qty: 4, unit_price: 100 }] });
  const po2 = r.body.order;
  await api(carlos, `/api/compras/pedidos/${po2.id}`, 'PATCH', { action: 'submit' });
  const m2 = await session('mateus');
  r = await api(m2, `/api/compras/pedidos/${po2.id}`, 'PATCH', { action: 'approve' });
  ok(r.status === 200, 'segundo pedido aprovado');
  await neilton.keyboard.press('Escape');
  await neilton.waitForTimeout(500);
  await neilton.waitForSelector('button:has-text("Receber pelo pedido")');
  await neilton.click('button:has-text("Receber pelo pedido")');
  await neilton.click('.pc-pick-row:has-text("PC 0002")');
  const key2 = makeKey('11222333000181', 1, 7002);
  await neilton.setInputFiles('input[aria-label="DANFE"]', { name: 'foto-danfe.png', mimeType: 'image/png', buffer: barcodePng(key2) });
  await neilton.waitForSelector('text=Chave lida do código de barras', { timeout: 30000 });
  ok((await neilton.inputValue('#rv-num')) === '7002', 'foto: chave lida do código de barras, número 7002 preenchido');
  await neilton.screenshot({ path: SHOTS + '/pc-foto.png' });

  /* ------------------------------------------------ tema claro */
  console.log('\n[8] Tela no tema claro');
  await carlos.evaluate(() => { localStorage.setItem('maxhub-theme', 'light'); });
  await carlos.reload();
  await carlos.waitForTimeout(2500);
  await nav(carlos, 'Cotações');
  await carlos.click('[role=tablist] button:has-text("Decididas")');
  await carlos.click('.p-row');
  await carlos.waitForSelector('.pc-map');
  await carlos.screenshot({ path: SHOTS + '/pc-mapa-claro.png' });
  ok(true, 'mapa no tema claro');
} catch (e) {
  problems.push('EXCEÇÃO ' + e.message);
  console.log('EXCEÇÃO', e);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problema(s):\n- ` + problems.join('\n- ') : '\nTUDO CERTO');
process.exit(problems.length ? 1 : 0);
