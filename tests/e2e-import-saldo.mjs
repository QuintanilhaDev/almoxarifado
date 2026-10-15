/**
 * Importar a planilha do estoque ATUALIZA os itens que já existem:
 *  - saldo vira ajuste no histórico ("Atualizado pela planilha");
 *  - mínimo e custo são trocados;
 *  - saldo calculado por fórmula que dá 0 é lido como 0 (antes vinha vazio);
 *  - item igual à planilha não muda; item novo entra.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const ExcelJS = require('exceljs');
const B = 'http://localhost:3100';
const SHOTS = process.env.SHOTS || '/tmp/shots';
const problems = [];
const ok = (cond, msg) => { if (!cond) { problems.push(msg); console.log('  ✗', msg); } else console.log('  ✓', msg); };

// planilha no formato da do Almoxarifado: SALDO = ENTRADA + QUANT − SAÍDA (fórmula)
const file = `${SHOTS}/estoque-atual.xlsx`;
fs.mkdirSync(SHOTS, { recursive: true });
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Folha1');
ws.addRow(['ESTOQUE ATUAL']);
ws.addRow([]);
ws.addRow(['ITEN', 'Descrição Produto', 'TAM.', 'UNID.', 'ENTRADA', 'SAÍDA', 'QUANT', 'SALDO', 'ESTOQUE MÍN.', 'CUSTO']);
const rows = [
  ['0001', 'Bota de segurança', '40', 'Cada', 0, 12, 12, 0, 5, 25], // saldo 12 → 0 (fórmula que dá zero)
  ['0002', 'Bota de segurança', '42', 'Cada', 5, 0, 3, 8, 5, 25], // saldo 3 → 8
  ['0003', 'Calça tática', '44', 'Cada', 0, 0, 9, 9, 12, 25], // só o mínimo muda (10 → 12)
  ['0004', 'Boné', null, 'Cada', 0, 0, 70, 70, 0, 25], // igual: não muda
  ['0005', 'Rádio comunicador', null, 'Cada', 0, 1, 6, 5, 0, 510], // saldo 6 → 5 e custo 480 → 510
  ['0006', 'Lanterna tática', null, 'Cada', 4, 0, 0, 4, 1, 60], // novo
];
rows.forEach((r, i) => {
  const n = i + 4;
  const row = ws.addRow(r);
  row.getCell(8).value = { formula: `E${n}+G${n}-F${n}`, result: r[7] };
});
await wb.xlsx.writeFile(file);

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'pt-BR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { problems.push('pageerror: ' + e.message); console.log('  ! pageerror', e.message); });
  await page.goto(B + '/');
  await page.fill('#user', 'neilton');
  await page.fill('#pass', '123456');
  await page.click('button[type=submit]');
  await page.waitForURL(B + '/setor/almoxarifado**', { timeout: 20000 });
  await page.goto(B + '/setor/almoxarifado#estoque');
  await page.waitForSelector('[data-max="estoque-importar"]', { timeout: 20000 });
  await page.waitForTimeout(800);

  console.log('\n[1] Pré-visualização');
  await page.click('[data-max="estoque-importar"]');
  await page.setInputFiles('.modal input[type=file], input[type=file]', file);
  await page.waitForSelector('.imp-table', { timeout: 20000 });
  const sum = await page.locator('.imp-sum').textContent();
  ok(/1 novo/.test(sum), 'mostra 1 item novo: ' + sum);
  ok(/4 já cadastrados: serão atualizados/.test(sum), 'mostra 4 itens que serão atualizados');
  ok(/1 já está igual à planilha/.test(sum), 'mostra 1 item igual');
  const diffs = await page.locator('.imp-diff').allTextContents();
  ok(diffs.some((d) => /12\s*→\s*0/.test(d)), 'Bota 40: saldo 12 → 0 (zero da fórmula lido certo)');
  ok(diffs.some((d) => /3\s*→\s*8/.test(d)), 'Bota 42: saldo 3 → 8');
  ok(diffs.some((d) => /10\s*→\s*12/.test(d)), 'Calça: mínimo 10 → 12');
  ok(diffs.some((d) => /480.*→.*510/.test(d)), 'Rádio: custo 480 → 510');
  const btn = (await page.locator('.modal-actions .btn-primary').textContent()).trim();
  ok(/Adicionar 1 e atualizar 4 itens/.test(btn), 'botão: ' + btn);
  await page.screenshot({ path: SHOTS + '/imp-saldo.png' });

  console.log('\n[2] Gravar');
  await page.click('.modal-actions .btn-primary');
  await page.waitForSelector('.imp-table', { state: 'detached', timeout: 20000 });
  await page.waitForTimeout(1200);
  const stock = await page.evaluate(async () => (await (await fetch('/api/almoxarifado/stock')).json()).items);
  const find = (name, size) => stock.find((i) => i.name === name && (i.size ?? null) === size);
  ok(find('Bota de segurança', '40')?.quantity === 0, 'Bota 40 ficou com 0');
  ok(find('Bota de segurança', '42')?.quantity === 8, 'Bota 42 ficou com 8');
  ok(find('Calça tática', '44')?.min_quantity === 12 && find('Calça tática', '44')?.quantity === 9, 'Calça: mínimo 12, saldo mantido');
  ok(find('Rádio comunicador', null)?.quantity === 5 && Number(find('Rádio comunicador', null)?.cost) === 510, 'Rádio: saldo 5 e custo 510');
  ok(find('Boné', null)?.quantity === 70, 'Boné continua com 70');
  ok(find('Lanterna tática', null)?.quantity === 4, 'Lanterna nova entrou com 4');
  ok(find('Camisa social manga curta', 'G')?.quantity === 40, 'item fora da planilha não mudou');

  const b40 = find('Bota de segurança', '40');
  const det = await page.evaluate(async (id) => (await (await fetch('/api/almoxarifado/stock/' + id)).json()), b40.id);
  const adj = det.movements.find((m) => m.kind === 'ajuste' && /planilha/i.test(m.note ?? ''));
  ok(adj && adj.before_qty === 12 && adj.after_qty === 0, 'histórico: ajuste 12 → 0 "Atualizado pela planilha"');
  ok(det.movements.length >= 2, 'movimentações anteriores continuam no histórico');

  console.log('\n[3] Importar de novo: nada muda');
  await page.click('[data-max="estoque-importar"]');
  await page.setInputFiles('input[type=file]', file);
  await page.waitForSelector('.imp-table', { timeout: 20000 });
  const sum2 = await page.locator('.imp-sum').textContent();
  ok(/6 já estão iguais à planilha/.test(sum2), 'segunda vez: tudo igual (' + sum2 + ')');
  const btn2 = (await page.locator('.modal-actions .btn-primary').textContent()).trim();
  ok(/Tudo já está igual/.test(btn2), 'botão: ' + btn2);
} catch (e) {
  problems.push('EXCEÇÃO ' + e.message);
  console.log('EXCEÇÃO', e);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problema(s):\n- ` + problems.join('\n- ') : '\nTUDO CERTO');
process.exit(problems.length ? 1 : 0);
