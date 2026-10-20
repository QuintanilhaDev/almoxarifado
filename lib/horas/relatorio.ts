import 'server-only';
import PDFDocument from 'pdfkit';
import { hm, type ApuracaoHoras } from './calculo';

/**
 * Relatório de horas extras: PDF (resumo, por mês, por funcionário e o detalhe de cada dia
 * com hora extra) e planilha (as horas como hora do Excel, que somam certo).
 */
const INK = '#17112A';
const LILAC = '#6B3FD6';
const LILAC_SOFT = '#EFE8FF';
const PAPER = '#FAF8FF';
const TEXT = '#221A36';
const MUTED = '#6E6787';
const LINE = '#E6E0F2';
const AMBER = '#B87708';
const AMBER_SOFT = '#FFF4DE';
const RED = '#C9314B';
const W = 595.28;
const H = 841.89;
const M = 36;
const CW = W - M * 2;
const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const br = (d: string) => d.split('-').reverse().join('/');
export const periodoHoras = (a: ApuracaoHoras) => `${br(a.periodo.from)} a ${br(a.periodo.to)}`;
const h0 = (m: number) => (m ? hm(m) : '—');

export function horasPdf(a: ApuracaoHoras): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `Horas extras ${periodoHoras(a)}`, Author: a.geradoPor, Creator: 'Max Hub' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const font = (b = false) => doc.font(b ? 'Helvetica-Bold' : 'Helvetica');
  const quando = new Date(a.geradoEm).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  let y = 0;
  const page = (title: string) => {
    doc.addPage();
    doc.rect(0, 0, W, 54).fill(INK);
    doc.rect(0, 54, W, 3).fill(LILAC);
    font(true).fontSize(8).fillColor('#BFA8FF').text('APURAÇÃO DE HORAS EXTRAS', M, 18, { characterSpacing: 1 });
    font().fontSize(8).fillColor('#D7CFEA').text(`Período ${periodoHoras(a)}`, M, 31);
    font(true).fontSize(13).fillColor('#FFFFFF').text(title, M, 20, { width: CW, align: 'right' });
    y = 76;
  };
  const need = (h: number, title: string) => {
    if (y + h > H - 50) {
      page(title);
      return true;
    }
    return false;
  };
  const section = (t: string, sub?: string) => {
    doc.rect(M, y + 2, 3, 14).fill(LILAC);
    font(true).fontSize(12).fillColor(TEXT).text(t, M + 10, y);
    if (sub) font().fontSize(8).fillColor(MUTED).text(sub, M + 10, y + 16, { width: CW - 10 });
    y += sub ? 32 : 22;
  };

  /* ---------- capa */
  doc.rect(0, 0, W, 160).fill(INK);
  doc.save();
  doc.rect(0, 0, W, 160).clip();
  for (let i = 0; i < 9; i++) doc.polygon([W - 260 + i * 34, 0], [W - 220 + i * 34, 0], [W - 330 + i * 34, 160], [W - 370 + i * 34, 160]).fillOpacity(0.05 + (i % 3) * 0.02).fill('#B79CFF');
  doc.restore();
  doc.fillOpacity(1);
  doc.rect(0, 160, W, 4).fill(LILAC);
  font(true).fontSize(9).fillColor('#BFA8FF').text('GRUPO MAX FORTE  ·  RECURSOS HUMANOS', M, 32, { characterSpacing: 1.2 });
  font(true).fontSize(26).fillColor('#FFFFFF').text('Apuração de Horas Extras', M, 50);
  font().fontSize(12).fillColor('#E6DDFB').text(`Período: ${periodoHoras(a)}`, M, 86);
  font().fontSize(8).fillColor('#9E94BC').text(`Gerado em ${quando}${a.geradoPor ? ` por ${a.geradoPor}` : ''}  ·  ${a.arquivo} (${a.leitura})`, M, 128, { width: CW });
  y = 186;
  const cards: [string, string, string, string][] = [
    ['Funcionários', String(a.total.funcionarios), `${a.funcionarios.filter((f) => f.total.extras > 0).length} com hora extra`, LILAC],
    ['Horas extras', hm(a.total.extras), `de ${hm(a.total.trabalhado)} trabalhadas`, RED],
    ['Dias úteis e sábado', hm(a.total.extra50), 'extras a 50%', AMBER],
    ['Domingo e feriado', hm(a.total.extra100), 'extras a 100%', RED],
  ];
  const cw = (CW - 30) / 4;
  cards.forEach(([k, v, s, c], i) => {
    const x = M + i * (cw + 10);
    doc.roundedRect(x, y, cw, 72, 10).fill(PAPER);
    doc.roundedRect(x, y, cw, 72, 10).lineWidth(0.8).strokeColor(LINE).stroke();
    doc.rect(x + 12, y + 12, 18, 3).fill(c);
    font(true).fontSize(7.5).fillColor(MUTED).text(k.toUpperCase(), x + 12, y + 20, { width: cw - 24 });
    font(true).fontSize(19).fillColor(TEXT).text(v, x + 12, y + 32, { width: cw - 24 });
    font().fontSize(7.5).fillColor(MUTED).text(s, x + 12, y + 56, { width: cw - 24 });
  });
  y += 92;
  for (const av of a.avisos) {
    font().fontSize(8.5);
    const h = doc.heightOfString(av, { width: CW - 28 }) + 16;
    doc.roundedRect(M, y, CW, h, 8).fill(AMBER_SOFT);
    doc.rect(M, y, 3, h).fill(AMBER);
    font().fontSize(8.5).fillColor(TEXT).text(av, M + 14, y + 8, { width: CW - 28 });
    y += h + 10;
  }

  // por mês
  section('Por mês', 'Horas extras somadas no mês de apuração.');
  const mc = [180, 80, 80, 90, CW - 430];
  const mh = ['Mês', 'Extras 50%', 'Extras 100%', 'Total de extras', 'Funcionários com extra'];
  const rowM = (cells: string[], bold = false, fill?: string) => {
    need(20, 'Resumo');
    if (fill) doc.rect(M, y - 3, CW, 19).fill(fill);
    let x = M;
    cells.forEach((c, i) => {
      font(bold).fontSize(8.6).fillColor(fill === INK ? '#FFFFFF' : TEXT).text(c, x + 6, y + 1, { width: mc[i] - 12, align: i ? 'right' : 'left', lineBreak: false });
      x += mc[i];
    });
    y += 19;
  };
  rowM(mh, true, INK);
  a.meses.forEach((m, i) => rowM([m.rotulo, h0(m.extra50), h0(m.extra100), hm(m.extras), String(m.funcionarios)], false, i % 2 ? PAPER : undefined));
  rowM(['Total', h0(a.total.extra50), h0(a.total.extra100), hm(a.total.extras), ''], true, LILAC_SOFT);
  y += 14;

  // por funcionário e mês
  section('Por funcionário', 'Cada mês de apuração com as horas trabalhadas, normais e extras.');
  const fc = [168, 82, 62, 58, 52, 52, CW - 474];
  const fh = ['Funcionário', 'Mês', 'Trabalhadas', 'Normais', 'Extras 50%', 'Extras 100%', 'Total extras'];
  const head = () => {
    doc.rect(M, y - 3, CW, 20).fill(INK);
    let x = M;
    fh.forEach((c, i) => {
      font(true).fontSize(7.6).fillColor('#FFFFFF').text(c, x + 5, y + 2, { width: fc[i] - 10, align: i > 1 ? 'right' : 'left', lineBreak: false });
      x += fc[i];
    });
    y += 21;
  };
  if (y > H - 140) page('Por funcionário');
  head();
  a.funcionarios.forEach((f, idx) => {
    const rows = f.meses.length + (f.meses.length > 1 ? 1 : 0);
    if (need(16 * Math.min(rows, 4) + 10, 'Por funcionário')) head();
    const top = y;
    f.meses.forEach((m, k) => {
      if (need(17, 'Por funcionário')) head();
      if (idx % 2) doc.rect(M, y - 3, CW, 17).fill(PAPER);
      let x = M;
      const cells = [k === 0 || y === 97 ? f.name : '', m.rotulo, hm(m.trabalhado), hm(m.normal), h0(m.extra50), h0(m.extra100), hm(m.extras)];
      cells.forEach((c, i) => {
        const strong = i === 0 || (i === 6 && m.extras > 0);
        font(strong).fontSize(i === 0 ? 8 : 8.2).fillColor(i === 6 && m.extras > 0 ? RED : TEXT).text(c, x + 5, y + 1, { width: fc[i] - 10, align: i > 1 ? 'right' : 'left', lineBreak: false, ellipsis: true, height: 11 });
        x += fc[i];
      });
      if (k === 0 && f.matricula) font().fontSize(6.8).fillColor(MUTED);
      y += 17;
    });
    if (f.meses.length > 1) {
      if (need(17, 'Por funcionário')) head();
      doc.rect(M + fc[0], y - 3, CW - fc[0], 17).fill(LILAC_SOFT);
      let x = M;
      ['', 'Total', hm(f.total.trabalhado), hm(f.total.normal), h0(f.total.extra50), h0(f.total.extra100), hm(f.total.extras)].forEach((c, i) => {
        font(true).fontSize(8.2).fillColor(i === 6 && f.total.extras ? RED : TEXT).text(c, x + 5, y + 1, { width: fc[i] - 10, align: i > 1 ? 'right' : 'left', lineBreak: false });
        x += fc[i];
      });
      y += 17;
    }
    if (f.matricula && y - top >= 30) font().fontSize(6.8).fillColor(MUTED).text(`Mat. ${f.matricula}${f.cargo ? ' · ' + f.cargo : ''}`, M + 5, top + 13, { width: fc[0] - 10, lineBreak: false });
    doc.moveTo(M, y - 3).lineTo(M + CW, y - 3).lineWidth(0.5).strokeColor(LINE).stroke();
  });
  y += 12;

  // regras
  need(130, 'Regras usadas');
  section('Regras usadas no cálculo');
  const c = a.config;
  for (const t of [
    `Jornada de ${hm(c.semanal)} semanais, até ${hm(c.diaria)} por dia. Semana de segunda a domingo.`,
    `O que passa de ${hm(c.diaria)} num dia é hora extra (excesso de até ${c.tolerancia} minutos no dia é tolerado, CLT art. 58 § 1º).`,
    `As horas normais de segunda a sábado somam até ${hm(c.semanal)}: o que passar é hora extra. Sábado trabalhado com as ${hm(c.semanal)} já cumpridas nos dias úteis é todo extra; se faltou hora na semana, o sábado completa primeiro.`,
    'Domingo e feriado trabalhados: todas as horas são extras (100%). Feriado em dia útil reduz a meta da semana em um dia.',
    `Mês de apuração: ${c.inicioMes > 1 ? `do dia ${c.inicioMes} ao dia ${c.inicioMes - 1} do mês seguinte` : 'do dia 1º ao último dia do mês'}. Cada hora extra entra no mês do dia em que foi feita.`,
    'Batida faltando: só os pares completos (entrada e saída) são somados, e o dia aparece marcado para conferência.',
  ]) {
    font().fontSize(8.6);
    const hh = doc.heightOfString(t, { width: CW - 16 });
    need(hh + 6, 'Regras usadas');
    doc.circle(M + 4, y + 5, 2).fill(LILAC);
    doc.fillColor(TEXT).text(t, M + 14, y, { width: CW - 16 });
    y = doc.y + 5;
  }

  /* ---------- detalhe */
  const com = a.funcionarios.filter((f) => f.dias.some((d) => d.extra50 + d.extra100 > 0 || d.incompleto));
  if (com.length) page('Dias com hora extra');
  for (const f of com) {
    const ds = f.dias.filter((d) => d.extra50 + d.extra100 > 0 || d.incompleto);
    need(80, 'Dias com hora extra');
    doc.roundedRect(M, y, CW, 40, 9).fill(LILAC_SOFT);
    font(true).fontSize(11).fillColor(TEXT).text(f.name, M + 12, y + 8, { width: CW - 170, lineBreak: false, ellipsis: true, height: 13 });
    font().fontSize(7.8).fillColor(MUTED).text([f.matricula ? `Matrícula ${f.matricula}` : null, f.cargo, f.posto].filter(Boolean).join('  ·  ') || ' ', M + 12, y + 24, { width: CW - 170, lineBreak: false, ellipsis: true, height: 10 });
    font(true).fontSize(12).fillColor(RED).text(hm(f.total.extras), M + CW - 150, y + 8, { width: 138, align: 'right' });
    font().fontSize(7.5).fillColor(MUTED).text('de horas extras no período', M + CW - 150, y + 24, { width: 138, align: 'right' });
    y += 48;
    for (const d of ds) {
      font().fontSize(7.8);
      const motivo = (d.motivo ?? '') + (d.incompleto ? `${d.motivo ? '; ' : ''}batida faltando: confira o dia` : '');
      const rh = Math.max(17, doc.heightOfString(motivo, { width: CW - 300 }) + 7);
      if (need(rh, 'Dias com hora extra')) {
        font(true).fontSize(8).fillColor(MUTED).text(`${f.name} (continuação)`, M, y);
        y += 14;
      }
      font(true).fontSize(8.3).fillColor(TEXT).text(br(d.date).slice(0, 5), M + 4, y + 2, { lineBreak: false });
      font().fontSize(7.5).fillColor(d.weekday === 0 || d.feriado ? RED : MUTED).text(d.feriado ? 'feriado' : SEM[d.weekday], M + 36, y + 3, { lineBreak: false });
      font().fontSize(7.8).fillColor(TEXT).text(d.punches.join('  '), M + 80, y + 2, { width: 120, lineBreak: false, ellipsis: true, height: 10 });
      font().fontSize(7.8).fillColor(MUTED).text(hm(d.trabalhado), M + 200, y + 2, { width: 40, align: 'right', lineBreak: false });
      font(true).fontSize(8.3).fillColor(d.extra100 ? RED : AMBER).text(d.extra50 + d.extra100 ? `+${hm(d.extra50 + d.extra100)}` : '—', M + 244, y + 2, { width: 44, align: 'right', lineBreak: false });
      font().fontSize(7.8).fillColor(d.incompleto ? AMBER : TEXT).text(motivo, M + 298, y + 2, { width: CW - 300 });
      y += rh;
      doc.moveTo(M, y - 3).lineTo(M + CW, y - 3).lineWidth(0.4).strokeColor(LINE).stroke();
    }
    y += 12;
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.moveTo(M, H - 34).lineTo(M + CW, H - 34).lineWidth(0.5).strokeColor(LINE).stroke();
    font().fontSize(7).fillColor(MUTED).text(`Max Hub · Horas extras · ${periodoHoras(a)}`, M, H - 26, { width: CW / 2, lineBreak: false });
    font().fontSize(7).fillColor(MUTED).text(`Página ${i + 1} de ${range.count}`, M + CW / 2, H - 26, { width: CW / 2, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}

/** planilha: horas como hora do Excel ([h]:mm), com totais que somam */
export async function horasXlsx(a: ApuracaoHoras): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Max Hub';
  const T = (m: number) => Math.round(m) / 1440;
  const FMT = '[h]:mm';
  const ink = 'FF17112A';
  const lilac = 'FF6B3FD6';
  const soft = 'FFF1EAFF';
  const zebra = 'FFFAF8FF';
  const line = { style: 'thin' as const, color: { argb: 'FFE3DAF6' } };
  const border = { top: line, bottom: line, left: line, right: line };
  const title = (ws: import('exceljs').Worksheet, cols: number, t: string) => {
    const rows: [string, number, boolean, string, number][] = [
      ['GRUPO MAX FORTE  ·  RECURSOS HUMANOS', 9, true, 'FFC6A8FF', 18],
      [t, 18, true, 'FFFFFFFF', 30],
      [`Período: ${periodoHoras(a)}   ·   ${a.arquivo} (${a.leitura})`, 10, false, 'FFE6DDFB', 20],
    ];
    rows.forEach(([v, size, bold, color, h], i) => {
      ws.mergeCells(i + 1, 1, i + 1, cols);
      const c = ws.getRow(i + 1).getCell(1);
      c.value = v;
      c.font = { name: 'Calibri', size, bold, color: { argb: color } };
      c.alignment = { vertical: 'middle', indent: 1 };
      for (let k = 1; k <= cols; k++) ws.getRow(i + 1).getCell(k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ink } };
      ws.getRow(i + 1).height = h;
    });
    for (let k = 1; k <= cols; k++) ws.getRow(4).getCell(k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: lilac } };
    ws.getRow(4).height = 4;
  };
  const header = (ws: import('exceljs').Worksheet, row: number, names: string[], right: number) => {
    const r = ws.getRow(row);
    names.forEach((t, i) => {
      const c = r.getCell(i + 1);
      c.value = t;
      c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ink } };
      c.alignment = { vertical: 'middle', wrapText: true, horizontal: i >= right ? 'right' : 'left', indent: 1 };
      c.border = { ...border, bottom: { style: 'medium', color: { argb: lilac } } };
    });
    r.height = 30;
    ws.views = [{ state: 'frozen', ySplit: row, showGridLines: false }];
  };
  const style = (r: import('exceljs').Row, i: number, timeFrom: number) => {
    r.eachCell({ includeEmpty: true }, (c, k) => {
      c.font = { name: 'Calibri', size: 10, color: { argb: 'FF221A36' }, bold: k === 1 };
      c.border = border;
      c.alignment = { vertical: 'top', wrapText: true, horizontal: k >= timeFrom ? 'right' : 'left', indent: 1 };
      if (k >= timeFrom && typeof c.value === 'number') c.numFmt = FMT;
      if (i % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } };
    });
  };

  /* Resumo: funcionário × mês */
  const ws = wb.addWorksheet('Resumo', { views: [{ showGridLines: false }], properties: { tabColor: { argb: lilac } } });
  ws.columns = [{ width: 36 }, { width: 12 }, { width: 16 }, { width: 26 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 14 }];
  title(ws, 9, 'Apuração de Horas Extras');
  const h1 = 6;
  header(ws, h1, ['Funcionário', 'Matrícula', 'Cargo', 'Mês', 'Trabalhadas', 'Normais', 'Extras 50%', 'Extras 100%', 'Total de extras'], 4);
  let r = h1 + 1;
  a.funcionarios.forEach((f, i) => {
    for (const m of f.meses) {
      const row = ws.getRow(r++);
      row.values = [f.name, f.matricula ?? '', f.cargo ?? '', m.rotulo, T(m.trabalhado), T(m.normal), T(m.extra50), T(m.extra100), T(m.extras)];
      style(row, i, 5);
      const t = row.getCell(9);
      t.font = { name: 'Calibri', size: 10, bold: true, color: { argb: m.extras ? 'FFC9314B' : 'FF6E6787' } };
    }
  });
  const last = r - 1;
  if (last >= h1 + 1) {
    ws.autoFilter = { from: { row: h1, column: 1 }, to: { row: last, column: 9 } };
    const tot = ws.getRow(r);
    tot.values = ['Total', '', '', '', { formula: `SUM(E${h1 + 1}:E${last})`, result: T(a.total.trabalhado) }, { formula: `SUM(F${h1 + 1}:F${last})`, result: T(a.funcionarios.reduce((t, f) => t + f.total.normal, 0)) }, { formula: `SUM(G${h1 + 1}:G${last})`, result: T(a.total.extra50) }, { formula: `SUM(H${h1 + 1}:H${last})`, result: T(a.total.extra100) }, { formula: `SUM(I${h1 + 1}:I${last})`, result: T(a.total.extras) }];
    tot.eachCell({ includeEmpty: true }, (c, k) => {
      c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: k === 9 ? 'FFC9314B' : ink } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: soft } };
      c.border = { top: { style: 'medium', color: { argb: lilac } } };
      c.alignment = { horizontal: k >= 5 ? 'right' : 'left', indent: 1 };
      if (k >= 5) c.numFmt = FMT;
    });
    tot.height = 22;
  }
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${h1}:${h1}` };

  /* Por mês: funcionários × meses (total de extras) */
  const wm = wb.addWorksheet('Por mês', { views: [{ showGridLines: false }] });
  const meses = a.meses;
  wm.columns = [{ width: 36 }, ...meses.map(() => ({ width: 15 })), { width: 15 }];
  title(wm, meses.length + 2, 'Horas extras por mês');
  header(wm, 6, ['Funcionário', ...meses.map((m) => m.rotulo), 'Total'], 1);
  a.funcionarios.forEach((f, i) => {
    const row = wm.getRow(7 + i);
    row.values = [f.name, ...meses.map((m) => T(f.meses.find((x) => x.chave === m.chave)?.extras ?? 0)), T(f.total.extras)];
    style(row, i, 2);
    row.getCell(meses.length + 2).font = { name: 'Calibri', size: 10, bold: true, color: { argb: f.total.extras ? 'FFC9314B' : 'FF6E6787' } };
  });
  {
    const n = a.funcionarios.length;
    const row = wm.getRow(7 + n);
    const col = (k: number) => String.fromCharCode(65 + k);
    row.values = ['Total', ...meses.map((m, k) => ({ formula: `SUM(${col(k + 1)}7:${col(k + 1)}${6 + n})`, result: T(m.extras) })), { formula: `SUM(${col(meses.length + 1)}7:${col(meses.length + 1)}${6 + n})`, result: T(a.total.extras) }];
    row.eachCell({ includeEmpty: true }, (c, k) => {
      c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: ink } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: soft } };
      c.border = { top: { style: 'medium', color: { argb: lilac } } };
      c.alignment = { horizontal: k >= 2 ? 'right' : 'left', indent: 1 };
      if (k >= 2) c.numFmt = FMT;
    });
  }

  /* Dias: tudo, para conferir */
  const wd = wb.addWorksheet('Dias', { views: [{ showGridLines: false }] });
  wd.columns = [{ width: 34 }, { width: 12 }, { width: 7 }, { width: 28 }, { width: 12 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 60 }];
  title(wd, 9, 'Dia a dia');
  header(wd, 6, ['Funcionário', 'Data', 'Dia', 'Batidas', 'Trabalhadas', 'Normais', 'Extras 50%', 'Extras 100%', 'Como foi calculado'], 4);
  let k = 0;
  for (const f of a.funcionarios)
    for (const d of f.dias) {
      const row = wd.getRow(7 + k);
      row.values = [f.name, br(d.date), d.feriado ? 'feriado' : SEM[d.weekday], d.punches.join('  '), T(d.trabalhado), T(d.normal), T(d.extra50), T(d.extra100), [d.motivo, d.incompleto ? 'batida faltando: só os pares completos foram somados' : null].filter(Boolean).join('; ')];
      style(row, k, 5);
      row.getCell(9).alignment = { wrapText: true, vertical: 'top', indent: 1 };
      row.getCell(9).numFmt = '@';
      k++;
    }
  if (k) wd.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6 + k, column: 9 } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
