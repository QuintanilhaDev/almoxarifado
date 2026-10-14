/**
 * Planilhas do Max Hub (todos os relatórios baixáveis usam este modelo, o mesmo visual das Métricas):
 *  - aba "Resumo" com faixa de título, seções e indicadores;
 *  - abas de dados com cabeçalho escuro, faixas alternadas, filtro, painel congelado,
 *    barras dentro das células e impressão em A4 deitado.
 */
import ExcelJS from 'exceljs';

const C = {
  ink: 'FF1D1430',
  lilac: 'FFA982FF',
  lilacSoft: 'FFF1EAFF',
  band: 'FFF9F6FF',
  border: 'FFE3DAF6',
  text: 'FF241B3A',
  muted: 'FF6B6483',
  white: 'FFFFFFFF',
  green: 'FF1F9D6B',
  greenBar: 'FFCDF3E1',
  purple: 'FF6B3FD6',
  purpleBar: 'FFE2D6FF',
  red: 'FFD6455D',
  redBar: 'FFF9D3DA',
  amber: 'FFB7791F',
  amberBar: 'FFFBE9C8',
};
const FONT = 'Calibri';
export const FMT = { int: '#,##0', money: '"R$" #,##0.00', date: 'dd/mm/yyyy', datetime: 'dd/mm/yyyy hh:mm', pct: '0.0%', dec: '#,##0.0' } as const;
type Align = 'left' | 'center' | 'right';
type Tone = 'good' | 'bad' | 'warn' | 'plain';
const toneColor = (t?: Tone) => (t === 'good' ? C.green : t === 'bad' ? C.red : t === 'warn' ? C.amber : C.ink);
export type Cell = string | number | Date | null | undefined;

export interface ReportCol<T> {
  header: string;
  width?: number;
  align?: Align;
  fmt?: string;
  value: (r: T) => Cell;
  /** barra dentro da célula (cor) */
  bar?: 'lilac' | 'green' | 'red' | 'amber';
  /** cor do texto por linha */
  tone?: (r: T) => Tone | undefined;
}
export interface ReportSheet<T = unknown> {
  name: string;
  tab?: 'lilac' | 'green' | 'red' | 'amber' | 'ink';
  cols: ReportCol<T>[];
  rows: T[];
  /** linha de total no fim (só nas colunas numéricas indicadas) */
  totals?: number[];
}
export interface Kpi {
  label: string;
  value: number | string;
  fmt?: string;
  note?: string;
  tone?: Tone;
}
export interface ReportSection {
  title: string;
  kpis?: Kpi[];
  table?: { headers: string[]; rows: Cell[][]; fmts?: (string | undefined)[] };
}
export interface ReportSpec {
  title: string;
  subtitle?: string;
  /** quem gerou e quando (rodapé do cabeçalho) */
  by: string;
  at?: Date;
  /** nome curto no rodapé das páginas impressas */
  footer: string;
  sections?: ReportSection[];
  notes?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheets: ReportSheet<any>[];
}

const TAB: Record<string, string> = { lilac: C.lilac, green: C.green, red: C.red, amber: C.amber, ink: C.ink };
const BAR: Record<string, string> = { lilac: C.purpleBar, green: C.greenBar, red: C.redBar, amber: C.amberBar };
const thin = (argb: string) => ({ style: 'thin' as const, color: { argb } });
const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
const colLetter = (n: number) => {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const pad = (n: number) => String(n).padStart(2, '0');
/** data/hora de Salvador como texto */
const bahia = (d: Date) => {
  const w = new Date(d.getTime() - 3 * 3_600_000);
  return `${pad(w.getUTCDate())}/${pad(w.getUTCMonth() + 1)}/${w.getUTCFullYear()} ${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`;
};

function summarySheet(wb: ExcelJS.Workbook, spec: ReportSpec) {
  const rs = wb.addWorksheet('Resumo', { properties: { tabColor: { argb: C.lilac } }, views: [{ showGridLines: false }] });
  [2.5, 42, 18, 18, 52, 2.5].forEach((w, i) => (rs.getColumn(i + 1).width = w));
  let r = 2;
  const band = (h: number) => {
    rs.getRow(r).height = h;
    for (let c = 2; c <= 5; c++) rs.getCell(r, c).fill = fill(C.ink);
    rs.mergeCells(r, 2, r, 5);
    rs.getCell(r, 2).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  };
  band(48);
  rs.getCell(r, 2).value = spec.title;
  rs.getCell(r, 2).font = { name: FONT, size: 22, bold: true, color: { argb: C.white } };
  r++;
  if (spec.subtitle) {
    band(26);
    rs.getCell(r, 2).value = spec.subtitle;
    rs.getCell(r, 2).font = { name: FONT, size: 13, bold: true, color: { argb: 'FFC6A8FF' } };
    r++;
  }
  band(24);
  rs.getCell(r, 2).value = `Gerado em ${bahia(spec.at ?? new Date())} por ${spec.by}  ·  horário da Bahia (UTC−3)`;
  rs.getCell(r, 2).font = { name: FONT, size: 10, color: { argb: 'FFCFC6E6' } };
  r += 2;

  for (const sec of spec.sections ?? []) {
    rs.getRow(r).height = 24;
    for (let c = 2; c <= 5; c++) {
      rs.getCell(r, c).fill = fill(C.lilacSoft);
      rs.getCell(r, c).border = { bottom: { style: 'medium', color: { argb: C.lilac } } };
    }
    rs.getCell(r, 2).value = sec.title.toUpperCase();
    rs.getCell(r, 2).font = { name: FONT, size: 11, bold: true, color: { argb: C.ink } };
    rs.getCell(r, 2).alignment = { vertical: 'middle', indent: 1 };
    r++;
    for (const k of sec.kpis ?? []) {
      rs.getRow(r).height = 23;
      const a = rs.getCell(r, 2);
      a.value = k.label;
      a.font = { name: FONT, size: 11, color: { argb: C.text } };
      a.alignment = { vertical: 'middle', indent: 1 };
      const b = rs.getCell(r, 3);
      b.value = k.value;
      if (k.fmt && typeof k.value === 'number') b.numFmt = k.fmt;
      b.font = { name: FONT, size: 13, bold: true, color: { argb: toneColor(k.tone) } };
      b.alignment = { vertical: 'middle', horizontal: 'right' };
      rs.mergeCells(r, 4, r, 5);
      const n = rs.getCell(r, 4);
      n.value = k.note ?? '';
      n.font = { name: FONT, size: 10, italic: true, color: { argb: C.muted } };
      n.alignment = { vertical: 'middle', indent: 1 };
      for (let c = 2; c <= 5; c++) rs.getCell(r, c).border = { bottom: thin(C.border) };
      r++;
    }
    if (sec.table) {
      rs.getRow(r).height = 22;
      sec.table.headers.forEach((h, i) => {
        const cell = rs.getCell(r, 2 + i);
        cell.value = h;
        cell.font = { name: FONT, size: 10, bold: true, color: { argb: C.muted } };
        cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'right', indent: i === 0 ? 1 : 0 };
      });
      for (let c = 2; c <= 5; c++) rs.getCell(r, c).border = { bottom: thin(C.border) };
      r++;
      for (const row of sec.table.rows) {
        rs.getRow(r).height = 21;
        row.slice(0, 4).forEach((v, i) => {
          const cell = rs.getCell(r, 2 + i);
          cell.value = v ?? '';
          const f = sec.table!.fmts?.[i];
          if (f && typeof v === 'number') cell.numFmt = f;
          cell.font = { name: FONT, size: 11, color: { argb: C.text } };
          cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'right', indent: i === 0 ? 1 : 0 };
        });
        for (let c = 2; c <= 5; c++) rs.getCell(r, c).border = { bottom: thin(C.border) };
        r++;
      }
    }
    r++;
  }
  if (spec.notes?.length) {
    for (const n of spec.notes) {
      rs.mergeCells(r, 2, r, 5);
      const cell = rs.getCell(r, 2);
      cell.value = `•  ${n}`;
      cell.font = { name: FONT, size: 10.5, color: { argb: C.text } };
      cell.alignment = { vertical: 'top', wrapText: true, indent: 1 };
      rs.getRow(r).height = Math.max(20, Math.ceil(n.length / 120) * 15 + 6);
      r++;
    }
  }
  rs.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  rs.headerFooter = { oddFooter: `&L&8${spec.footer}&R&8Página &P de &N` };
}

function dataSheet<T>(wb: ExcelJS.Workbook, spec: ReportSpec, s: ReportSheet<T>) {
  const ws = wb.addWorksheet(s.name.slice(0, 31), { properties: { tabColor: { argb: TAB[s.tab ?? 'lilac'] } }, views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  s.cols.forEach((c, i) => {
    let w = c.width ?? 16;
    if ((c.align ?? 'left') === 'left') {
      let max = c.header.length;
      for (const r of s.rows.slice(0, 3000)) {
        const v = c.value(r);
        if (typeof v === 'string' && v.length > max) max = v.length;
      }
      w = Math.max(w, Math.min(60, Math.ceil(max * 1.08) + 3));
    }
    ws.getColumn(i + 1).width = w;
  });
  const head = ws.getRow(1);
  head.height = 28;
  s.cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: C.white } };
    cell.fill = fill(C.ink);
    const left = (c.align ?? 'left') === 'left';
    cell.alignment = { vertical: 'middle', horizontal: left ? 'left' : 'center', indent: left ? 1 : 0, wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: C.lilac } } };
  });
  s.rows.forEach((r, ri) => {
    const row = ws.getRow(ri + 2);
    row.height = 21;
    s.cols.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      const v = c.value(r);
      cell.value = v === undefined ? null : v;
      if (c.fmt) cell.numFmt = c.fmt;
      const t = c.tone?.(r);
      cell.font = { name: FONT, size: 11, color: { argb: t ? toneColor(t) : C.text }, bold: Boolean(t && t !== 'plain') };
      const al = c.align ?? 'left';
      cell.alignment = { vertical: 'middle', horizontal: al, indent: al === 'left' ? 1 : 0 };
      cell.border = { bottom: thin(C.border) };
      if (ri % 2 === 1) cell.fill = fill(C.band);
    });
  });
  const n = s.rows.length;
  if (n) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: n + 1, column: s.cols.length } };
    let prio = 1;
    s.cols.forEach((c, i) => {
      if (!c.bar) return;
      const L = colLetter(i + 1);
      ws.addConditionalFormatting({
        ref: `${L}2:${L}${n + 1}`,
        rules: [{ type: 'dataBar', priority: prio++, gradient: false, cfvo: [{ type: 'num', value: 0 }, { type: 'max' }], color: { argb: BAR[c.bar] } } as ExcelJS.ConditionalFormattingRule],
      });
    });
  }
  if (s.totals?.length && n) {
    const row = ws.getRow(n + 2);
    row.height = 24;
    s.cols.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      const L = colLetter(ci + 1);
      if (ci === 0) cell.value = 'Total';
      else if (s.totals!.includes(ci)) {
        cell.value = { formula: `SUBTOTAL(9,${L}2:${L}${n + 1})` };
        if (c.fmt) cell.numFmt = c.fmt;
      }
      cell.font = { name: FONT, size: 11, bold: true, color: { argb: C.ink } };
      cell.fill = fill(C.lilacSoft);
      cell.alignment = { vertical: 'middle', horizontal: ci === 0 ? 'left' : c.align ?? 'left', indent: ci === 0 ? 1 : 0 };
      cell.border = { top: { style: 'medium', color: { argb: C.lilac } } };
    });
  }
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  ws.pageSetup.printTitlesRow = '1:1';
  ws.headerFooter = { oddFooter: `&L&8${spec.footer} · ${s.name}&R&8Página &P de &N` };
}

export async function buildReport(spec: ReportSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Max Hub';
  wb.lastModifiedBy = spec.by;
  wb.created = spec.at ?? new Date();
  wb.title = spec.title;
  if (spec.sections?.length || spec.notes?.length) summarySheet(wb, spec);
  for (const s of spec.sheets) dataSheet(wb, spec, s);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const xlsxResponseHeaders = (file: string) => ({
  'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'Content-Disposition': `attachment; filename="${file}"`,
  'Cache-Control': 'no-store',
});
/** 'AAAA-MM-DD' → data do Excel (meio-dia, para não virar o dia anterior) */
export const xDate = (d: string | null | undefined) => (d ? new Date(d.slice(0, 10) + 'T12:00:00Z') : null);
