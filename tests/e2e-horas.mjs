/**
 * Apurador de horas extras (RH): planilha lida direto, foto/escaneado lidos pela IA (de teste),
 * cálculo pela regra 44h/9h, resultado por mês e o .zip com o PDF e a planilha.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const JSZip = require('jszip');
const B = 'http://localhost:3100';
const SHOTS = process.env.SHOTS || '/tmp/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const problems = [];
const ok = (cond, msg) => { if (!cond) { problems.push(msg); console.log('  ✗', msg); } else console.log('  ✓', msg); };

/* ---------- folha em Excel: 19 a 25/10 (sábado depois das 44h + domingo) e 28 a 30/09 */
const T = (h, m) => new Date(Date.UTC(1899, 11, 30, h, m));
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Ponto');
ws.addRow(['FOLHA DE PONTO']);
ws.addRow(['Funcionário:', 'PEDRO ALVES', '', 'Matrícula:', '5001']);
ws.addRow(['Data', 'Entrada', 'Saída', 'Entrada', 'Saída']);
const linha = (y, mo, d, ...h) => {
  const r = ws.addRow([new Date(Date.UTC(y, mo - 1, d)), ...h.map(([a, b]) => T(a, b))]);
  r.getCell(1).numFmt = 'dd/mm/yyyy';
  for (let c = 2; c <= 5; c++) r.getCell(c).numFmt = 'hh:mm';
};
linha(2026, 9, 28, [7, 0], [12, 0], [13, 0], [18, 0]); // 10h → 1h (setembro)
linha(2026, 9, 29, [8, 0], [12, 0], [13, 0], [17, 0]);
for (const d of [19, 20, 21, 22]) linha(2026, 10, d, [8, 0], [12, 0], [13, 0], [18, 0]); // 4 × 9h
linha(2026, 10, 23, [8, 0], [12, 0], [13, 0], [17, 0]); // 8h → 44h
linha(2026, 10, 24, [8, 0], [12, 0]); // sábado: 4h extras
linha(2026, 10, 25, [8, 0], [14, 0]); // domingo: 6h a 100%
const xlsx = `${SHOTS}/folha-horas.xlsx`;
await wb.xlsx.writeFile(xlsx);

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function session(user) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'pt-BR', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { problems.push(`pageerror (${user}): ${e.message}`); console.log('  ! pageerror', user, e.message); });
  await page.goto(B + '/');
  await page.fill('#user', user);
  await page.fill('#pass', '123456');
  await page.click('button[type=submit]');
  await page.waitForURL((u) => u.pathname.length > 1, { timeout: 30000 });
  await page.waitForTimeout(1000);
  return page;
}
const statsTxt = async (p) => (await p.locator('.stat-grid').textContent()).replace(/\s+/g, ' ');

try {
  console.log('\n[1] Permissão');
  const rita = await session('rita');
  await rita.goto(B + '/setor/rh');
  await rita.waitForSelector('.nav-item', { timeout: 20000 });
  ok((await rita.locator('.nav-item[data-tab="horas"]').count()) === 0, 'a Rita (RH sem o módulo) não vê "Horas extras"');
  const r = await rita.evaluate(async () => (await fetch('/api/rh/horas-extras/ler', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: 'x' }) })).status);
  ok(r === 403, 'nem pela API (403): ' + r);
  await rita.context().close();

  const p = await session('carla');
  await p.goto(B + '/setor/rh');
  await p.waitForSelector('.nav-item[data-tab="horas"]', { timeout: 20000 });
  await p.locator('.nav-item[data-tab="horas"]').click();
  await p.waitForSelector('.pt-drop', { timeout: 15000 });
  ok(/Jogue aqui/.test(await p.locator('.pt-drop').textContent()), 'a Carla (master do RH) abre a aba e vê a área de envio');
  await p.screenshot({ path: SHOTS + '/hx-inicio.png' });

  console.log('\n[2] Planilha: lida direto e calculada pela regra');
  await p.setInputFiles('input[aria-label="Arquivo de ponto para horas extras"]', xlsx);
  await p.waitForSelector('.hx-table', { timeout: 30000 });
  let st = await statsTxt(p);
  ok(/Horas extras\s*11h00/.test(st), '1h (28/09) + 4h (sábado) + 6h (domingo) = 11h00: ' + st);
  ok(/6h00\s*extras a 100%/.test(st) && /5h00\s*extras a 50%/.test(st), '5h a 50% e 6h a 100%');
  const meses = (await p.locator('.hx-meses').textContent()).replace(/\s+/g, ' ');
  ok(/set\/2026|setembro/i.test(meses) && /out\/2026|outubro/i.test(meses), 'separado por mês: ' + meses);
  await p.locator('.hx-row:has-text("PEDRO ALVES")').click();
  const det = (await p.locator('.hx-detail').textContent()).replace(/\s+/g, ' ');
  ok(/24\/10.*\+4h00/.test(det) && /25\/10.*\+6h00/.test(det), 'detalhe por dia mostra sábado e domingo: ' + det.slice(0, 220));
  await p.screenshot({ path: SHOTS + '/hx-planilha.png', fullPage: true });

  console.log('\n[3] Relatório .zip');
  const dl = p.waitForEvent('download', { timeout: 60000 });
  await p.click('[data-max="horas-zip"]');
  const d = await dl;
  const zipPath = `${SHOTS}/horas.zip`;
  await d.saveAs(zipPath);
  ok(/^Horas Extras .*\.zip$/.test(d.suggestedFilename()), 'nome do .zip: ' + d.suggestedFilename());
  const z = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const names = Object.keys(z.files).sort();
  ok(JSON.stringify(names) === JSON.stringify(['PLANILHA DE HORAS EXTRAS.xlsx', 'RELATÓRIO DE HORAS EXTRAS.pdf']), 'PDF e planilha dentro: ' + names.join(', '));
  const pdf = await z.file('RELATÓRIO DE HORAS EXTRAS.pdf').async('nodebuffer');
  fs.writeFileSync(`${SHOTS}/hx.pdf`, pdf);
  ok(pdf.subarray(0, 4).toString() === '%PDF' && pdf.length > 3000, `PDF: ${Math.round(pdf.length / 1024)} KB`);
  const xw = new ExcelJS.Workbook();
  await xw.xlsx.load(await z.file('PLANILHA DE HORAS EXTRAS.xlsx').async('nodebuffer'));
  ok(xw.worksheets.map((w) => w.name).join(',') === 'Resumo,Por mês,Dias', 'planilha com Resumo, Por mês e Dias');

  console.log('\n[4] Foto (manuscrito) lida pela IA');
  await p.click('[data-max="horas-novo"]');
  const png = await p.screenshot({ clip: { x: 0, y: 0, width: 600, height: 400 } });
  fs.writeFileSync(`${SHOTS}/folha-foto.png`, png);
  await p.setInputFiles('input[aria-label="Arquivo de ponto para horas extras"]', `${SHOTS}/folha-foto.png`);
  await p.waitForSelector('.hx-row:has-text("MARIA MANUSCRITA")', { timeout: 30000 });
  st = await statsTxt(p);
  ok(/Horas extras\s*5h00/.test(st), '1h (10h no dia) + 4h de domingo = 5h00: ' + st);
  ok(/Imagem lida com IA/.test(await p.locator('.pt-bar').textContent()), 'diz que foi lida com IA');
  ok(/dúvida em 1 dia/.test(await p.locator('.pt-aviso').allTextContents().then((a) => a.join(' '))), 'avisa o dia em que a leitura ficou em dúvida');
  await p.screenshot({ path: SHOTS + '/hx-foto.png', fullPage: true });

  console.log('\n[5] PDF escaneado (sem texto): páginas viram imagem e vão para a IA');
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const ch = [];
  doc.on('data', (c) => ch.push(c));
  doc.image(png, 20, 20, { width: 500 });
  doc.addPage().image(png, 20, 20, { width: 500 });
  doc.end();
  await new Promise((res) => doc.on('end', res));
  fs.writeFileSync(`${SHOTS}/escaneado.pdf`, Buffer.concat(ch));
  await p.click('[data-max="horas-novo"]');
  await p.setInputFiles('input[aria-label="Arquivo de ponto para horas extras"]', `${SHOTS}/escaneado.pdf`);
  await p.waitForSelector('.hx-row:has-text("MARIA MANUSCRITA")', { timeout: 45000 });
  st = await statsTxt(p);
  ok(/Funcionários\s*1/.test(st) && /Horas extras\s*5h00/.test(st), 'duas páginas da mesma pessoa juntadas sem duplicar: ' + st);

  console.log('\n[6] Mudar a regra recalcula sem reler');
  await p.locator('.pt-bar button:has-text("Regras")').click();
  await p.fill('#hx-dia', '08:00');
  await p.locator('#hx-tol').click();
  await p.locator('button:has-text("Recalcular")').click();
  await p.waitForFunction(() => /Horas extras\s*6h00/.test(document.querySelector('.stat-grid')?.textContent?.replace(/\s+/g, ' ') ?? ''), null, { timeout: 15000 }).catch(() => undefined);
  st = await statsTxt(p);
  ok(/Horas extras\s*6h00/.test(st), 'limite diário 8h: 2h (14/09) + 4h de domingo = 6h00: ' + st);
  await p.locator('.link-btn:has-text("voltar ao padrão")').click();

  console.log('\n[7] Uma pasta inteira de uma vez');
  const pasta = `${SHOTS}/pasta-ponto`;
  fs.rmSync(pasta, { recursive: true, force: true });
  fs.mkdirSync(`${pasta}/setembro`, { recursive: true });
  fs.copyFileSync(xlsx, `${pasta}/pedro.xlsx`);
  fs.copyFileSync(xlsx, `${pasta}/setembro/pedro-copia.xlsx`); // o mesmo arquivo duas vezes não dobra as horas
  fs.copyFileSync(`${SHOTS}/folha-foto.png`, `${pasta}/setembro/maria.png`);
  fs.writeFileSync(`${pasta}/.DS_Store`, 'lixo');
  fs.writeFileSync(`${pasta}/quebrado.pdf`, 'isto não é um pdf');
  await p.click('[data-max="horas-novo"]');
  await p.setInputFiles('input[aria-label="Pasta com arquivos de ponto"]', pasta);
  await p.waitForSelector('.hx-files', { timeout: 60000 });
  st = await statsTxt(p);
  ok(/Funcionários\s*2/.test(st) && /Horas extras\s*16h00/.test(st), 'Pedro (11h, sem dobrar) + Maria (5h) = 16h00: ' + st);
  ok(/3 arquivos juntados/.test(await p.locator('.hx-files').textContent()), 'lista os 3 arquivos lidos (o .DS_Store é ignorado)');
  const avs = (await p.locator('.pt-aviso').allTextContents()).join(' ');
  ok(/quebrado\.pdf/.test(avs), 'o arquivo que não abriu aparece em "ficaram de fora"');
  ok(/mais de um arquivo/.test(avs), 'avisa os dias repetidos');
  await p.screenshot({ path: SHOTS + '/hx-pasta.png', fullPage: true });
  const dl2 = p.waitForEvent('download', { timeout: 60000 });
  await p.click('[data-max="horas-zip"]');
  ok(/\.zip$/.test((await dl2).suggestedFilename()), 'relatório da pasta baixa em .zip');

  console.log('\n[8] IA recusa a chave (401): usa o leitor simples e avisa');
  const txt = `${SHOTS}/relatorio-sistema.txt`;
  fs.writeFileSync(txt, ['CHAVE_INVALIDA Registro manual de horários - setembro/2026', 'JOSÉ CARLOS PEREIRA', 'dia 14/09/2026 entrou 07:00 almoço 12:00 volta 13:00 saiu 18:00', 'dia 20/09/2026 entrou 08:00 saiu 12:00', 'ANA LIMA', 'dia 15/09/2026 entrou 08:00 almoço 12:00 volta 13:00 saiu 17:00'].join('\n'));
  await p.click('[data-max="horas-novo"]');
  await p.setInputFiles('input[aria-label="Arquivo de ponto para horas extras"]', txt);
  await p.waitForSelector('.hx-row:has-text("JOSÉ CARLOS PEREIRA")', { timeout: 30000 });
  st = await statsTxt(p);
  ok(/Funcionários\s*2/.test(st) && /Horas extras\s*5h00/.test(st), 'leu os 2 funcionários sem a IA: 1h + 4h de domingo = 5h00: ' + st);
  const av8 = (await p.locator('.pt-aviso').allTextContents()).join(' ');
  ok(/chave de acesso/.test(av8) && /leitor simples/.test(av8), 'avisa que a chave foi recusada e que é para conferir: ' + av8.slice(0, 200));

  console.log('\n[9] Folha de papel sem o mês (só dias 1 a 31) + cota da IA cheia');
  const papel = `${SHOTS}/folha-papel.txt`;
  fs.writeFileSync(papel, ['COTA_CHEIA SO_DIA FOLHA DE PONTO INDIVIDUAL DE TRABALHO', 'EMPREGADO(A) Felipe Gabriel Reis dos Santos   FUNÇÃO AAOP   ANO 2026', 'DIAS ENTRADA SAIDA RETORNO SAIDA', '1 07:00 12:00 13:00 17:00'].join('\n'));
  await p.click('[data-max="horas-novo"]');
  await p.setInputFiles('input[aria-label="Arquivo de ponto para horas extras"]', papel);
  await p.waitForSelector('.hx-row:has-text("FELIPE GABRIEL")', { timeout: 60000 });
  ok(/01\/09\/2026/.test(await p.locator('.pt-bar').textContent()), 'mês deduzido: setembro/2026 (período começa em 01/09/2026)');
  ok((await p.locator('#hx-mesfolha').inputValue()) === '2026-09', 'mostra "Mês das folhas" com setembro marcado');
  st = await statsTxt(p);
  ok(/Horas extras\s*12h00/.test(st), '3 sábados de 4h depois das 44h (4 × 8h + 3 × 4h… ) — cálculo: ' + st);
  await p.selectOption('#hx-mesfolha', '2026-08');
  await p.waitForFunction(() => /01\/08\/2026/.test(document.querySelector('.pt-bar')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => undefined);
  ok(/01\/08\/2026/.test(await p.locator('.pt-bar').textContent()), 'trocar o mês recalcula sem ler de novo');
  await p.screenshot({ path: SHOTS + '/hx-papel.png', fullPage: true });
} catch (e) {
  problems.push('exceção: ' + e.message);
  console.log(e);
}
await browser.close();
console.log(problems.length ? `\n${problems.length} PROBLEMA(S)` : '\nTUDO CERTO');
process.exit(problems.length ? 1 : 0);
