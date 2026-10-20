/**
 * Aba Pontos (só da Evelyn): anexa o espelho do GesOper (Excel com datas e horas de verdade,
 * e também em PDF), a análise aparece na tela e o relatório em PDF baixa sozinho.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const B = 'http://localhost:3100';
const SHOTS = process.env.SHOTS || '/tmp/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const problems = [];
const ok = (cond, msg) => { if (!cond) { problems.push(msg); console.log('  ✗', msg); } else console.log('  ✓', msg); };

/* ---------- espelho em Excel, como o GesOper exporta (datas e horas como valores do Excel) */
const T = (h, m) => new Date(Date.UTC(1899, 11, 30, h, m)); // hora do Excel
const day = (i) => new Date(Date.UTC(2026, 8, 21 + i));
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Espelho');
ws.addRow(['ESPELHO DE PONTO']);
ws.addRow(['Empresa: GRUPO MAX FORTE', '', '', 'Período: 21/09/2026 a 20/10/2026']);
const block = (nome, mat, posto, fn) => {
  ws.addRow([]);
  ws.addRow(['Funcionário:', nome, '', 'Matrícula:', mat]);
  ws.addRow(['Posto:', posto]);
  ws.addRow(['Data', 'Dia', 'Ent. 1', 'Saí. 1', 'Ent. 2', 'Saí. 2', 'Horas Trab.', 'H. Extras', 'Ocorrência']);
  for (let i = 0; i < 30; i++) {
    const [p, obs] = fn(i);
    const row = ws.addRow([day(i), ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'][day(i).getUTCDay()], ...[0, 1, 2, 3].map((k) => (p[k] ? T(...p[k]) : null)), 0.5, 0, obs ?? '']);
    row.getCell(1).numFmt = 'dd/mm/yyyy';
    for (let c = 3; c <= 6; c++) row.getCell(c).numFmt = 'hh:mm';
    row.getCell(7).numFmt = '[h]:mm';
    row.getCell(8).numFmt = '[h]:mm';
  }
};
// 12x36 diurno nos dias pares; esqueceu a saída em 23/09; não bateu em 29/09
block('ANA PAULA SOUZA', '1001', 'POSTO 01 - SHOPPING BARRA', (i) => (i % 2 ? [[], 'FOLGA'] : i === 2 ? [[[6, 58]]] : i === 8 ? [[]] : [[[6, 55], [19, 1]]]));
// 12x36 noturno nos ímpares, tudo certo
block('BRUNO LIMA', '1002', 'POSTO 01 - SHOPPING BARRA', (i) => (i % 2 === 0 ? [[], 'FOLGA'] : [[[18, 57], [7, 2]]]));
// diária seg–sex; atraso de 40 min em 24/09
block('CARLA DIAS', '1003', 'POSTO 02 - AGÊNCIA', (i) => {
  const w = day(i).getUTCDay();
  if (w === 0 || w === 6) return [[], 'DSR'];
  return [i === 3 ? [[8, 40], [12, 0], [13, 0], [17, 48]] : [[8, 0], [12, 0], [13, 0], [17, 48]]];
});
const xlsx = `${SHOTS}/espelho-gesoper.xlsx`;
await wb.xlsx.writeFile(xlsx);

/* ---------- espelho em PDF no layout do GesOper (uma página por funcionário, "21/08-Sex",
   "Folga", 00:00 no que não foi batido, cliente/posto na linha e Hr. Dia / Horas Dif.) */
async function gesoperPdf() {
  const doc = new PDFDocument({ size: 'A4', margin: 20, autoFirstPage: false });
  const ch = [];
  doc.on('data', (c) => ch.push(c));
  const sem = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const pessoas = [
    // 12x36 diurno (dias pares), posto 01; 25/08 só a entrada; 31/08 escalado e 00:00 em tudo
    { nome: 'HELENA PRATES', mat: '9001', funcao: 'VIGILANTE', posto: 'CLIENTEX PORTARIA01 - PIER', dia: (i) => (i % 2 ? null : i === 4 ? ['06:58', '00:00', '00:00', '00:00'] : i === 10 ? ['00:00', '00:00', '00:00', '00:00'] : ['06:58', '12:01', '12:59', '19:00']) },
    // 12x36 noturno (ímpares), posto 02, intervalo não batido (00:00) em 22/08
    { nome: 'IGOR NASCIMENTO', mat: '9002', funcao: 'VIGILANTE', posto: 'CLIENTEX PORTARIA02 - MARITIMO', dia: (i) => (i % 2 === 0 ? null : i === 1 ? ['19:00', '00:00', '00:00', '07:00'] : ['18:58', '22:00', '23:00', '07:01']) },
    // 5x2 de 8h40, supervisor, tudo certo
    { nome: 'JULIA FONTES', mat: '9003', funcao: 'SUPERVISOR', posto: 'CLIENTEX PORTARIA02 - MARITIMO', dia: (i) => ([0, 6].includes(new Date(Date.UTC(2026, 7, 21 + i)).getUTCDay()) ? null : ['07:50', '12:00', '13:00', '17:30']) },
  ];
  const mm = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const hh = (m) => `${m < 0 ? '-' : ''}${String(Math.floor(Math.abs(m) / 60)).padStart(2, '0')},${String(Math.abs(m) % 60).padStart(2, '0')}`;
  for (const p of pessoas) {
    doc.addPage();
    doc.fontSize(8);
    doc.text('Empresa:', 120, 20, { lineBreak: false }).text('MAX FORTE SERVICOS DE SEGURANCA LTDA', 160, 20, { lineBreak: false }).text('CNPJ: 03.195.862/0001-05', 400, 20, { lineBreak: false });
    doc.fontSize(11).text('Funcionário:', 120, 44, { lineBreak: false }).text(p.nome, 200, 44, { lineBreak: false });
    doc.fontSize(8).text('CTPS:', 140, 60, { lineBreak: false }).text('Série:', 220, 60, { lineBreak: false }).text('Matrícula:', 330, 60, { lineBreak: false }).text(p.mat, 400, 60, { lineBreak: false });
    doc.text('Função:', 140, 72, { lineBreak: false }).text(p.funcao, 180, 72, { lineBreak: false });
    doc.text('Período:', 140, 84, { lineBreak: false }).text('21/08/2026', 180, 84, { lineBreak: false }).text('a', 225, 84, { lineBreak: false }).text('20/09/2026', 240, 84, { lineBreak: false });
    doc.text('Horário Realizado no Posto', 70, 104, { lineBreak: false }).text('Hr.', 300, 104, { lineBreak: false }).text('Horas', 325, 104, { lineBreak: false });
    doc.text('Dia', 25, 112, { lineBreak: false });
    doc.text('Ent. Interv. Saída', 70, 120, { lineBreak: false }).text('Dia', 300, 120, { lineBreak: false }).text('Dif.', 325, 120, { lineBreak: false });
    for (let i = 0; i < 31; i++) {
      const y = 134 + i * 12;
      const d = new Date(Date.UTC(2026, 7, 21 + i));
      doc.text(`${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}-${sem[d.getUTCDay()]}`, 22, y, { lineBreak: false });
      const b = p.dia(i);
      if (!b) {
        doc.text('Folga', 62, y, { lineBreak: false });
        continue;
      }
      b.slice(0, 3).forEach((t, k) => doc.text(t, 62 + k * 22, y, { lineBreak: false })); // a 4ª batida sai colada no posto, como no GesOper
      const real = b.filter((t) => t !== '00:00').map(mm);
      let trab = 0;
      if (real.length >= 2) {
        const r2 = real.map((x, k) => (k && x < real[k - 1] ? x + 1440 : x));
        for (let k = 1; k < r2.length; k += 2) trab += r2[k] - r2[k - 1];
      }
      const prev = p.funcao === 'SUPERVISOR' ? 520 : 660;
      doc.text(`${b[3]} ${p.posto}`, 150, y, { lineBreak: false }).text(hh(trab), 300, y, { lineBreak: false }).text(hh(trab - prev), 325, y, { lineBreak: false });
      if (trab) doc.text('Ponto Eletrônico', 360, y, { lineBreak: false });
    }
    doc.text('Declaro que o horário acima registrado, foi o', 22, 520).text('SALVADOR , 2 de Outubro de 2026', 350, 520);
  }
  doc.end();
  await new Promise((r) => doc.on('end', r));
  return Buffer.concat(ch);
}

/* ---------- o mesmo espelho em PDF (texto em colunas) */
async function espelhoPdf() {
  const doc = new PDFDocument({ size: 'A4', margin: 30 });
  const ch = [];
  doc.on('data', (c) => ch.push(c));
  doc.fontSize(9).text('ESPELHO DE PONTO   Período: 21/09/2026 a 20/10/2026', 30, 30);
  doc.text('Funcionário: DIEGO ROCHA', 30, 50);
  doc.text('Matrícula: 2001', 300, 50);
  const X = [30, 110, 170, 230, 290, 350, 420];
  ['Data', 'Entrada', 'Saída', 'Entrada', 'Saída', 'Trab.', 'Extras'].forEach((h, k) => doc.text(h, X[k], 70, { lineBreak: false }));
  for (let i = 0; i < 10; i++) {
    const y = 86 + i * 14;
    const d = day(i);
    doc.text(`${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/2026`, X[0], y, { lineBreak: false });
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const cells = i === 2 ? ['08:00', '', '', '17:00', '08:00'] : ['08:00', '12:00', '13:00', '17:00', '08:00']; // 23/09: intervalo não batido
    cells.forEach((c, k) => c && doc.text(c, X[k + 1], y, { lineBreak: false }));
  }
  doc.end();
  await new Promise((r) => doc.on('end', r));
  return Buffer.concat(ch);
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function session(user, mobile = false) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1360, height: 900 }, locale: 'pt-BR', acceptDownloads: true, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { problems.push(`pageerror (${user}): ${e.message}`); console.log('  ! pageerror', user, e.message); });
  await page.goto(B + '/');
  await page.fill('#user', user);
  await page.fill('#pass', '123456');
  await page.click('button[type=submit]');
  await page.waitForURL((u) => u.pathname.length > 1, { timeout: 30000 });
  await page.waitForSelector('.nav-item', { state: 'attached', timeout: 20000 });
  await page.waitForTimeout(1200);
  return page;
}
const api = (page, path, method = 'GET', body) => page.evaluate(async ([p, m, b]) => { const r = await fetch(p, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }); return { status: r.status }; }, [path, method, body]);
const upload = (page, buf, name, type) => page.evaluate(async ([b64, n, t]) => {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const fd = new FormData();
  fd.append('file', new Blob([bin], { type: t }), n);
  const r = await fetch('/api/pontos/analisar', { method: 'POST', body: fd });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}, [buf.toString('base64'), name, type]);

try {
  console.log('\n[1] Só a Evelyn vê a aba');
  const uesley = await session('uesley');
  ok((await uesley.locator('.nav-item:has-text("Pontos")').count()) === 0, 'Uesley (master do Operacional) não vê a aba Pontos');
  let r = await upload(uesley, fs.readFileSync(xlsx), 'espelho.xlsx', 'application/octet-stream');
  ok(r.status === 403, 'nem pela API (403)');
  await uesley.context().close();
  const mateus = await session('mateus');
  r = await upload(mateus, fs.readFileSync(xlsx), 'espelho.xlsx', 'application/octet-stream');
  ok(r.status === 403, 'nem o master geral (a aba é só dela)');
  await mateus.context().close();

  const ev = await session('evelyn');
  await ev.waitForSelector('.nav-item:has-text("Pontos")', { timeout: 15000 });
  ok(true, 'a Evelyn vê a aba Pontos');
  ok(/Anexe o espelho/.test(await ev.locator('.pt-drop').textContent()), 'a aba abre direto no envio do espelho');
  await ev.screenshot({ path: SHOTS + '/pt-inicio.png' });

  console.log('\n[2] Anexa o espelho em Excel: análise + .zip automático');
  const dl = ev.waitForEvent('download', { timeout: 60000 });
  await ev.setInputFiles('input[aria-label="Arquivo do espelho de ponto"]', xlsx);
  const d = await dl;
  const zipPath = `${SHOTS}/relatorios.zip`;
  await d.saveAs(zipPath);
  const JSZip = require('jszip');
  const z = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const names = Object.keys(z.files).sort();
  ok(d.suggestedFilename() === 'Relatório de Ponto 21-09-2026 a 20-10-2026.zip', 'o .zip baixou sozinho: ' + d.suggestedFilename());
  ok(JSON.stringify(names) === JSON.stringify(['RELATÓRIO COMPLETO.pdf', 'RELATÓRIO PARA DIRETORIA.pdf']), 'com os dois PDFs: ' + names.join(', '));
  for (const n of names) {
    const b = await z.file(n).async('nodebuffer');
    fs.writeFileSync(`${SHOTS}/${n}`, b);
    ok(b.subarray(0, 4).toString() === '%PDF' && b.length > 3000, `${n}: ${Math.round(b.length / 1024)} KB`);
  }
  await ev.waitForSelector('.pt-func', { timeout: 15000 });
  const stats = await ev.locator('.stat-grid').textContent();
  ok(/Funcionários\s*3/.test(stats), 'três funcionários: ' + stats.replace(/\s+/g, ' ').slice(0, 120));
  const tipos = await ev.locator('.pt-tipo').allTextContents();
  ok(tipos.some((t) => /Parcialmente sem registro\s*1/.test(t)) && tipos.some((t) => /^\s*Sem registro\s*1/.test(t)) && tipos.some((t) => /Atraso\s*1/.test(t)), 'acha o registro parcial, o dia sem registro e o atraso: ' + tipos.join(' | '));
  const reg = await ev.locator('.pt-reg-row').allTextContents();
  ok(reg.length === 1 && /ANA PAULA/.test(reg[0]) && /1 sem registro\s*29\/09/.test(reg[0]) && /1 parcial\s*23\/09/.test(reg[0]), 'lista "precisam de atenção": a Ana, sem registro em 29/09 e parcial em 23/09 (folgas não contam): ' + reg.join(' | '));
  const first = await ev.locator('.pt-func').first().textContent();
  ok(/ANA PAULA/.test(first) && /Crítico|Atenção/.test(first), 'quem tem mais problema vem primeiro (Ana)');
  const bruno = await ev.locator('.pt-func', { hasText: 'BRUNO' }).textContent();
  ok(/Regular/.test(bruno) && /12x36/.test(bruno), 'Bruno (noturno 12x36, tudo certo) está regular');
  await ev.locator('.pt-func', { hasText: 'ANA PAULA' }).locator('.pt-func-row').click();
  await ev.waitForSelector('.pt-days');
  const rows = await ev.locator('.pt-days tbody tr').allTextContents();
  ok(rows.some((t) => /23\/09/.test(t) && /falta a saída/.test(t)) && rows.some((t) => /29\/09/.test(t) && /sem nenhuma batida/.test(t)), 'os dias da Ana mostram o que aconteceu: ' + rows.join(' | ').slice(0, 160));
  ok((await ev.locator('.pt-day').count()) >= 30, 'calendário do período');
  await ev.screenshot({ path: SHOTS + '/pt-resultado.png' });
  // filtro por situação
  await ev.click('.pt-tipo:has-text("Atraso")');
  ok((await ev.locator('.pt-func').count()) === 1 && /CARLA/.test(await ev.locator('.pt-func').first().textContent()), 'filtrar "Atraso" mostra só a Carla');
  await ev.click('.pt-tipo:has-text("Atraso")');
  // planilha de controle
  const dl2 = ev.waitForEvent('download', { timeout: 30000 });
  await ev.click('[data-max="pontos-planilha"]');
  const x = await dl2;
  await x.saveAs(`${SHOTS}/controle.xlsx`);
  const cw = new ExcelJS.Workbook();
  await cw.xlsx.readFile(`${SHOTS}/controle.xlsx`);
  ok(cw.worksheets.map((w) => w.name).join(',') === 'Resumo,Ocorrências,Dias' && cw.getWorksheet('Resumo').rowCount === 4, 'planilha de controle: resumo, ocorrências e dias');

  console.log('\n[3] Espelho em PDF do GesOper');
  const g = await gesoperPdf();
  fs.writeFileSync(`${SHOTS}/espelho-gesoper.pdf`, g);
  const dl4 = ev.waitForEvent('download', { timeout: 60000 });
  await ev.click('[data-max="pontos-novo"]');
  await ev.setInputFiles('input[aria-label="Arquivo do espelho de ponto"]', `${SHOTS}/espelho-gesoper.pdf`);
  await dl4;
  await ev.waitForSelector('.pt-reg-row', { timeout: 20000 });
  const reg2 = await ev.locator('.pt-reg-row').allTextContents();
  ok(reg2.some((t) => /HELENA/.test(t) && /1 sem registro\s*31\/08/.test(t) && /1 parcial\s*25\/08/.test(t)), 'Helena (12x36): 00:00 em tudo = sem registro; só a entrada = parcial; folgas da escala não contam');
  ok(reg2.some((t) => /IGOR/.test(t) && /1 parcial\s*22\/08/.test(t)) && !reg2.some((t) => /JULIA/.test(t)), 'Igor: intervalo 00:00 = registro parcial; Julia (5x2, tudo batido) fora da lista');
  const julia = await ev.locator('.pt-func', { hasText: 'JULIA' }).textContent();
  ok(/Regular/.test(julia) && /SUPERVISOR/.test(julia) && /Diária 8h40/.test(julia), 'Julia: escala 5x2 de 8h40 lida do próprio sistema (Hr. Dia − Dif.), sem falso "sem registro" nos fins de semana: ' + julia.replace(/\s+/g, ' ').slice(0, 120));
  // filtros: cliente/posto e função
  await ev.selectOption('select[aria-label="Cliente/posto"]', 'CLIENTEX PORTARIA02 - MARITIMO');
  let names2 = await ev.locator('.pt-func-main b').allTextContents();
  ok(names2.length === 2 && !names2.includes('HELENA PRATES'), 'filtro de posto: só quem trabalhou no Marítimo: ' + names2.join(', '));
  await ev.selectOption('select[aria-label="Função"]', 'SUPERVISOR');
  names2 = await ev.locator('.pt-func-main b').allTextContents();
  ok(names2.length === 1 && names2[0] === 'JULIA FONTES', 'filtro de função: só a supervisora');
  ok((await ev.locator('select[aria-label="Filial"] option').allTextContents()).some((t) => /MAX FORTE SERVICOS DE SEGURANCA LTDA · CNPJ 03\.195\.862\/0001-05/.test(t)), 'filial lida do cabeçalho (empresa e CNPJ)');
  await ev.click('button[aria-label="Limpar filtros"]');
  await ev.fill('input[aria-label="Período: até"]', '2026-08-30');
  names2 = await ev.locator('.pt-reg-row').allTextContents();
  ok(names2.length === 2 && !names2.some((t) => /31\/08/.test(t)), 'filtro de período: até 30/08, o 31/08 sai da conta');
  const dl5 = ev.waitForEvent('download', { timeout: 30000 });
  await ev.click('[data-max="pontos-diretoria"]');
  const d5 = await dl5;
  ok(d5.suggestedFilename() === 'RELATÓRIO PARA DIRETORIA.pdf', 'baixa só o da diretoria, com o recorte: ' + d5.suggestedFilename());
  await ev.screenshot({ path: SHOTS + '/pt-gesoper.png' });

  console.log('\n[3b] Espelho em PDF genérico');
  r = await upload(ev, await espelhoPdf(), 'espelho.pdf', 'application/pdf');
  const f0 = r.body.analise?.funcionarios?.[0];
  ok(r.status === 200 && f0?.name === 'DIEGO ROCHA' && f0.matricula === '2001', 'PDF lido: Diego, matrícula 2001');
  ok(f0 && f0.dias.find((x) => x.date === '2026-09-23')?.ocorrencias.some((o) => o.tipo === 'sem_intervalo') && f0.dias.find((x) => x.date === '2026-09-21')?.punches.length === 4, 'colunas pela posição: o "Trab." não vira batida; 23/09 sem intervalo');
  r = await upload(ev, Buffer.from('isto não é um espelho'), 'qualquer.txt', 'text/plain');
  ok(r.status === 422 && /espelho/.test(r.body.error), 'arquivo que não é espelho: aviso claro');

  console.log('\n[4] Tema claro e celular');
  await ev.evaluate(() => localStorage.setItem('maxhub-theme', 'light'));
  await ev.reload();
  await ev.waitForSelector('.pt-drop', { timeout: 15000 });
  await ev.screenshot({ path: SHOTS + '/pt-claro.png' });
  await ev.context().close();
  const m = await session('evelyn', true);
  await m.waitForSelector('.pt-drop', { timeout: 15000 });
  const dl3 = m.waitForEvent('download', { timeout: 60000 });
  await m.setInputFiles('input[aria-label="Arquivo do espelho de ponto"]', xlsx);
  await dl3;
  await m.waitForSelector('.pt-func');
  const over = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(over <= 1, `celular sem rolagem lateral (${over}px)`);
  await m.screenshot({ path: SHOTS + '/pt-celular.png', fullPage: false });
} catch (e) {
  problems.push('EXCEÇÃO ' + e.message);
  console.log('EXCEÇÃO', e);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problema(s):\n- ` + problems.join('\n- ') : '\nTUDO CERTO');
process.exit(problems.length ? 1 : 0);
