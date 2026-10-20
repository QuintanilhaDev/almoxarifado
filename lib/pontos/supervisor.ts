import 'server-only';
import type { Worksheet } from 'exceljs';
import { SEMANA, SITUACAO, dataBR, semRegistro, type Analise } from './types';

/**
 * RELATÓRIO PARA SUPERVISOR (.xlsx): a mesma lista do PDF "Funcionários sem registro ou
 * parcialmente sem registro", pronta para o supervisor cobrar.
 *  - aba "Resumo": um funcionário por linha, com as quantidades e os dias;
 *  - aba "Dia a dia": uma linha por dia, com as batidas e o que faltou.
 */
const INK = 'FF17112A';
const LILAC = 'FF6B3FD6';
const LILAC_SOFT = 'FFF1EAFF';
const ZEBRA = 'FFFAF8FF';
const LINE = 'FFE3DAF6';
const MUTED = 'FF6E6787';
const RED = 'FFC9314B';
const RED_SOFT = 'FFFDECEF';
const AMBER = 'FFB27200';
const AMBER_SOFT = 'FFFFF4DE';
const WHITE = 'FFFFFFFF';
const FONT = 'Calibri';

const curto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const border = { top: { style: 'thin' as const, color: { argb: LINE } }, bottom: { style: 'thin' as const, color: { argb: LINE } }, left: { style: 'thin' as const, color: { argb: LINE } }, right: { style: 'thin' as const, color: { argb: LINE } } };

/** faixa de título (linhas mescladas) */
function cabecalho(ws: Worksheet, cols: number, a: Analise, titulo: string, sub: string) {
  const periodo = `${dataBR(a.filtros?.de ?? a.periodo.from)} a ${dataBR(a.filtros?.ate ?? a.periodo.to)}`;
  const recorte = [a.filtros?.posto, a.filtros?.filial, a.filtros?.funcao].filter(Boolean).join('  ·  ');
  const quando = new Date(a.geradoEm).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const linhas: [string, number, boolean, string, number][] = [
    ['GRUPO MAX FORTE  ·  APURAÇÃO DE PONTO', 9, true, 'FFC6A8FF', 18],
    [titulo, 18, true, WHITE, 30],
    [`Período: ${periodo}${recorte ? `   ·   ${recorte}` : ''}`, 11, false, 'FFE6DDFB', 20],
    [`${sub}   ·   gerado em ${quando}${a.geradoPor ? ` por ${a.geradoPor}` : ''}`, 9, false, 'FFB9AFD6', 18],
  ];
  linhas.forEach(([t, size, bold, color, h], i) => {
    const r = ws.getRow(i + 1);
    ws.mergeCells(i + 1, 1, i + 1, cols);
    const c = r.getCell(1);
    c.value = t;
    c.font = { name: FONT, size, bold, color: { argb: color } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    for (let k = 1; k <= cols; k++) r.getCell(k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
    r.height = h;
  });
  // faixa lilás
  const r5 = ws.getRow(5);
  for (let k = 1; k <= cols; k++) r5.getCell(k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LILAC } };
  r5.height = 4;
  return 6;
}

/** quadro de números logo abaixo do título */
function numeros(ws: Worksheet, row: number, cols: number, itens: [string, number | string, string][]) {
  const per = Math.floor(cols / itens.length);
  itens.forEach(([label, v, color], i) => {
    const c1 = 1 + i * per;
    const c2 = i === itens.length - 1 ? cols : c1 + per - 1;
    ws.mergeCells(row, c1, row, c2);
    ws.mergeCells(row + 1, c1, row + 1, c2);
    const l = ws.getRow(row).getCell(c1);
    l.value = label.toUpperCase();
    l.font = { name: FONT, size: 8.5, bold: true, color: { argb: MUTED } };
    l.alignment = { vertical: 'bottom', indent: 1 };
    const n = ws.getRow(row + 1).getCell(c1);
    n.value = v;
    n.font = { name: FONT, size: 20, bold: true, color: { argb: color } };
    n.alignment = { vertical: 'middle', indent: 1, horizontal: 'left' };
    for (let k = c1; k <= c2; k++) {
      ws.getRow(row).getCell(k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LILAC_SOFT } };
      ws.getRow(row + 1).getCell(k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LILAC_SOFT } };
    }
  });
  ws.getRow(row).height = 20;
  ws.getRow(row + 1).height = 32;
  return row + 3;
}

/** linha de cabeçalho da tabela */
function titulos(ws: Worksheet, row: number, nomes: string[]) {
  const r = ws.getRow(row);
  nomes.forEach((t, i) => {
    const c = r.getCell(i + 1);
    c.value = t;
    c.font = { name: FONT, size: 10, bold: true, color: { argb: WHITE } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
    c.alignment = { vertical: 'middle', horizontal: ['#', 'Sem registro', 'Parcial', 'Data', 'Dia'].includes(t) ? 'center' : 'left', wrapText: true, indent: 1 };
    c.border = { ...border, bottom: { style: 'medium', color: { argb: LILAC } } };
  });
  r.height = 30;
}

export async function supervisorXlsx(a: Analise): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Max Hub';
  wb.title = 'Relatório para supervisor';
  const lista = a.funcionarios
    .map((f) => ({ f, ...semRegistro(f) }))
    .filter((x) => x.total > 0)
    .sort((p, q) => q.sem.length - p.sem.length || q.total - p.total || p.f.name.localeCompare(q.f.name, 'pt-BR'));
  const totSem = lista.reduce((t, x) => t + x.sem.length, 0);
  const totPar = lista.reduce((t, x) => t + x.parcial.length, 0);

  /* ---------------- Resumo */
  const ws = wb.addWorksheet('Resumo', { views: [{ showGridLines: false }], properties: { tabColor: { argb: LILAC } } });
  const COLS = 9;
  ws.columns = [
    { key: 'n', width: 6 },
    { key: 'name', width: 36 },
    { key: 'mat', width: 12 },
    { key: 'funcao', width: 16 },
    { key: 'posto', width: 34 },
    { key: 'sem', width: 12 },
    { key: 'semDias', width: 46 },
    { key: 'par', width: 11 },
    { key: 'parDias', width: 46 },
  ];
  let row = cabecalho(ws, COLS, a, 'Relatório para Supervisor', 'Funcionários sem registro ou parcialmente sem registro');
  row = numeros(ws, row + 1, COLS, [
    ['Funcionários na lista', lista.length, INK],
    ['Dias sem registro', totSem, totSem ? RED : INK],
    ['Dias com registro parcial', totPar, totPar ? AMBER : INK],
  ]);
  const head = row;
  titulos(ws, head, ['#', 'Funcionário', 'Matrícula', 'Função', 'Cliente/posto', 'Sem registro', 'Dias sem registro', 'Parcial', 'Dias com registro parcial']);
  ws.views = [{ state: 'frozen', ySplit: head, showGridLines: false }];
  if (!lista.length) {
    ws.mergeCells(head + 1, 1, head + 1, COLS);
    const c = ws.getRow(head + 1).getCell(1);
    c.value = 'Todos os funcionários registraram o ponto em todos os dias da escala.';
    c.font = { name: FONT, size: 11, bold: true, color: { argb: 'FF1E9E6A' } };
    c.alignment = { indent: 1, vertical: 'middle' };
    ws.getRow(head + 1).height = 28;
  }
  lista.forEach((x, i) => {
    const r = ws.getRow(head + 1 + i);
    const semDias = x.sem.map(curto).join(', ');
    const parDias = x.parcial.map(curto).join(', ');
    r.values = [i + 1, x.f.name, x.f.matricula ?? '', x.f.cargo ?? '', x.f.posto ?? '', x.sem.length || '', semDias || '—', x.parcial.length || '', parDias || '—'];
    const zebra = i % 2 === 1;
    r.eachCell({ includeEmpty: true }, (c, k) => {
      c.font = { name: FONT, size: 10, color: { argb: k === 1 || k === 3 ? MUTED : 'FF221A36' }, bold: k === 2 };
      c.alignment = { vertical: 'top', wrapText: true, indent: k === 1 ? 0 : 1, horizontal: k === 1 || k === 6 || k === 8 ? 'center' : 'left' };
      c.border = border;
      if (zebra) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
    });
    // quantidades em destaque
    const s = r.getCell(6);
    if (x.sem.length) {
      s.font = { name: FONT, size: 12, bold: true, color: { argb: RED } };
      s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED_SOFT } };
    }
    const p = r.getCell(8);
    if (x.parcial.length) {
      p.font = { name: FONT, size: 12, bold: true, color: { argb: AMBER } };
      p.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER_SOFT } };
    }
    r.getCell(7).font = { name: FONT, size: 10, color: { argb: x.sem.length ? RED : MUTED } };
    r.getCell(9).font = { name: FONT, size: 10, color: { argb: x.parcial.length ? AMBER : MUTED } };
    // altura pela quantidade de dias (as datas quebram linha)
    const linhas = Math.max(Math.ceil(semDias.length / 42), Math.ceil(parDias.length / 42), Math.ceil((x.f.posto ?? '').length / 32), 1);
    r.height = Math.max(22, 15 * linhas + 6);
  });
  const last = head + Math.max(1, lista.length);
  if (lista.length) {
    ws.autoFilter = { from: { row: head, column: 1 }, to: { row: last, column: COLS } };
    // total
    const t = ws.getRow(last + 1);
    t.values = ['', 'Total', '', '', '', totSem, '', totPar, ''];
    t.eachCell({ includeEmpty: true }, (c, k) => {
      c.font = { name: FONT, size: 11, bold: true, color: { argb: k === 6 ? RED : k === 8 ? AMBER : INK } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LILAC_SOFT } };
      c.alignment = { vertical: 'middle', horizontal: k === 6 || k === 8 ? 'center' : 'left', indent: k === 2 ? 1 : 0 };
      c.border = { top: { style: 'medium', color: { argb: LILAC } } };
    });
    t.height = 24;
  }
  const nota = ws.getRow(last + 3);
  ws.mergeCells(last + 3, 1, last + 3, COLS);
  nota.getCell(1).value = 'Sem registro: dia de trabalho pela escala do funcionário, sem nenhuma batida (folgas não contam).  Parcial: o dia tem batidas, mas faltou registrar a entrada, a saída ou o intervalo.';
  nota.getCell(1).font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } };
  nota.getCell(1).alignment = { wrapText: true, vertical: 'top', indent: 1 };
  nota.height = 30;
  for (const [i, av] of a.avisos.entries()) {
    const rr = last + 4 + i;
    ws.mergeCells(rr, 1, rr, COLS);
    const c = ws.getRow(rr).getCell(1);
    c.value = `Atenção: ${av}`;
    c.font = { name: FONT, size: 9.5, color: { argb: AMBER } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER_SOFT } };
    c.alignment = { wrapText: true, vertical: 'middle', indent: 1 };
    ws.getRow(rr).height = 44;
  }
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }, printTitlesRow: `${head}:${head}` };
  ws.headerFooter = { oddFooter: '&L&8Max Hub · Relatório para supervisor&R&8Página &P de &N' };

  /* ---------------- Dia a dia */
  const wd = wb.addWorksheet('Dia a dia', { views: [{ showGridLines: false }], properties: { tabColor: { argb: 'FFD6455D' } } });
  const C2 = 8;
  wd.columns = [
    { key: 'name', width: 34 },
    { key: 'mat', width: 11 },
    { key: 'posto', width: 32 },
    { key: 'data', width: 12 },
    { key: 'dia', width: 8 },
    { key: 'sit', width: 18 },
    { key: 'bat', width: 26 },
    { key: 'det', width: 56 },
  ];
  let r2 = cabecalho(wd, C2, a, 'Relatório para Supervisor', 'Dia a dia: o que falta registrar');
  r2 += 1;
  titulos(wd, r2, ['Funcionário', 'Matrícula', 'Cliente/posto', 'Data', 'Dia', 'Situação', 'Batidas', 'Detalhe']);
  wd.views = [{ state: 'frozen', ySplit: r2, showGridLines: false }];
  let k = 0;
  for (const x of lista) {
    for (const d of x.f.dias) {
      const oc = d.ocorrencias.filter((o) => o.tipo === 'sem_registro' || o.tipo === 'incompleta' || o.tipo === 'sem_intervalo');
      if (!oc.length) continue;
      const sem = oc.some((o) => o.tipo === 'sem_registro');
      const r = wd.getRow(r2 + 1 + k);
      r.values = [x.f.name, x.f.matricula ?? '', d.local ?? x.f.posto ?? '', dataBR(d.date), SEMANA[d.weekday], sem ? 'Sem registro' : 'Registro parcial', d.punches.join('  ') || 'nenhuma', oc.map((o) => `${SITUACAO[o.tipo].short}: ${o.texto}`).join(' · ')];
      const zebra = k % 2 === 1;
      r.eachCell({ includeEmpty: true }, (c, col) => {
        c.font = { name: FONT, size: 10, color: { argb: col === 2 || col === 5 ? MUTED : 'FF221A36' }, bold: col === 1 };
        c.alignment = { vertical: 'top', wrapText: true, indent: 1, horizontal: col === 4 || col === 5 ? 'center' : 'left' };
        c.border = border;
        if (zebra) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
      });
      const s = r.getCell(6);
      s.font = { name: FONT, size: 10, bold: true, color: { argb: sem ? RED : AMBER } };
      s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sem ? RED_SOFT : AMBER_SOFT } };
      r.height = Math.max(20, 14 * Math.ceil(String(r.getCell(8).value).length / 60) + 6);
      k++;
    }
  }
  if (k) wd.autoFilter = { from: { row: r2, column: 1 }, to: { row: r2 + k, column: C2 } };
  wd.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${r2}:${r2}` };
  wd.headerFooter = { oddFooter: '&L&8Max Hub · Relatório para supervisor (dia a dia)&R&8Página &P de &N' };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
