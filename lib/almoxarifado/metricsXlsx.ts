/**
 * Planilha (.xlsx) das métricas. Cada aba de dados tem o cabeçalho na linha 1 e uma linha por registro,
 * então o Excel filtra/ordena e o Power BI importa direto. A aba "Resumo" é a visão para ler.
 */
import ExcelJS from 'exceljs';
import { KIND_LABEL, KIND_ORDER, tzOffsetMs, type MetricsData, type MoveInput, type ReqInput } from './metrics';

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
  amber: 'FFB7791F',
};
const FONT = 'Calibri';
export const MAX_LOG_ROWS = 20_000;

const STATUS_LABEL: Record<string, string> = { nova: 'Nova', pendente: 'Pendente', resolvida: 'Resolvida' };

type Align = 'left' | 'center' | 'right';
interface Col<T> {
  header: string;
  width: number;
  align?: Align;
  fmt?: string;
  value: (r: T) => string | number | Date | null;
}

/** Instante → "relógio da parede" no fuso, como data do Excel (que não tem fuso). */
const wall = (ts: number, tz: string) => new Date(ts + tzOffsetMs(ts, tz));
const when = (iso: string, tz: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? wall(t, tz) : null;
};
const pad = (n: number) => String(n).padStart(2, '0');

const thin = (argb: string) => ({ style: 'thin' as const, color: { argb } });

function headerRow(ws: ExcelJS.Worksheet, cols: { header: string; align?: Align }[]) {
  const row = ws.getRow(1);
  row.height = 28;
  cols.forEach((c, i) => {
    const cell = row.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: C.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.ink } };
    cell.alignment = { vertical: 'middle', horizontal: c.align === 'left' || !c.align ? 'left' : 'center', indent: c.align === 'left' || !c.align ? 1 : 0, wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: C.lilac } } };
  });
}

/** Cria uma aba de dados: cabeçalho, linhas com faixas, filtro, painel congelado, impressão. */
function dataSheet<T>(wb: ExcelJS.Workbook, name: string, tab: string, cols: Col<T>[], rows: T[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, {
    properties: { tabColor: { argb: tab } },
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false, zoomScale: 100 }],
  });
  cols.forEach((c, i) => {
    let w = c.width;
    if ((c.align ?? 'left') === 'left') {
      // ajusta a largura ao maior texto (até 70), para nada ficar cortado
      let max = 0;
      for (const r of rows.slice(0, 3000)) {
        const v = c.value(r);
        if (typeof v === 'string' && v.length > max) max = v.length;
      }
      w = Math.max(w, Math.min(70, Math.ceil(max * 1.08) + 3));
    }
    ws.getColumn(i + 1).width = w;
  });
  headerRow(ws, cols);
  rows.forEach((r, ri) => {
    const row = ws.getRow(ri + 2);
    row.height = 21;
    cols.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      const v = c.value(r);
      cell.value = v;
      if (c.fmt) cell.numFmt = c.fmt;
      cell.font = { name: FONT, size: 11, color: { argb: C.text } };
      cell.alignment = { vertical: 'middle', horizontal: c.align ?? 'left', indent: (c.align ?? 'left') === 'left' ? 1 : 0 };
      cell.border = { bottom: thin(C.border) };
      if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.band } };
    });
  });
  if (rows.length) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: cols.length } };
  }
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  ws.headerFooter = { oddFooter: '&L&8Almoxarifado · Métricas&R&8Página &P de &N' };
  ws.pageSetup.printTitlesRow = '1:1';
  return ws;
}

/** barras dentro das células + cor verde/vermelha para saldo */
function decorate(ws: ExcelJS.Worksheet, nRows: number, bars: { col: string; color: string }[], signed: string[]) {
  if (!nRows) return;
  let prio = 1;
  for (const b of bars) {
    ws.addConditionalFormatting({
      ref: `${b.col}2:${b.col}${nRows + 1}`,
      rules: [
        {
          type: 'dataBar',
          priority: prio++,
          gradient: false,
          cfvo: [{ type: 'num', value: 0 }, { type: 'max' }],
          color: { argb: b.color },
        } as ExcelJS.ConditionalFormattingRule,
      ],
    });
  }
  for (const col of signed) {
    ws.addConditionalFormatting({
      ref: `${col}2:${col}${nRows + 1}`,
      rules: [
        { type: 'cellIs', operator: 'greaterThan', priority: prio++, formulae: [0], style: { font: { color: { argb: C.green }, bold: true } } },
        { type: 'cellIs', operator: 'lessThan', priority: prio++, formulae: [0], style: { font: { color: { argb: C.red }, bold: true } } },
      ],
    });
  }
}

const INT = '#,##0';
const SIGNED = '+#,##0;-#,##0;0';

export interface ExportContext {
  by: string;
  exportedAt: number;
  truncated: boolean;
}

export async function buildWorkbook(data: MetricsData, moves: MoveInput[], reqs: ReqInput[], ctx: ExportContext): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Almoxarifado · Central de Solicitações';
  wb.lastModifiedBy = ctx.by;
  wb.created = new Date(ctx.exportedAt);
  wb.modified = new Date(ctx.exportedAt);
  wb.title = `Métricas do almoxarifado · ${data.periodLabel}`;
  wb.subject = data.rangeLabel;
  wb.calcProperties = { fullCalcOnLoad: false };

  const tz = data.tz;
  const fromMs = Date.parse(data.from);
  const toMs = Date.parse(data.to);
  const inWindow = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= fromMs && t <= toMs;
  };

  /* --------------------------------- Resumo --------------------------------- */
  const rs = wb.addWorksheet('Resumo', {
    properties: { tabColor: { argb: C.lilac } },
    views: [{ showGridLines: false, zoomScale: 100 }],
  });
  rs.getColumn(1).width = 2.5;
  rs.getColumn(2).width = 40;
  rs.getColumn(3).width = 16;
  rs.getColumn(4).width = 16;
  rs.getColumn(5).width = 56;
  rs.getColumn(6).width = 2.5;

  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
  const band = (r: number, argb: string, height: number) => {
    rs.getRow(r).height = height;
    for (let c = 2; c <= 5; c++) rs.getCell(r, c).fill = fill(argb);
  };

  let r = 2;
  band(r, C.ink, 48);
  rs.mergeCells(r, 2, r, 5);
  Object.assign(rs.getCell(r, 2), { value: 'Métricas do Almoxarifado' });
  rs.getCell(r, 2).font = { name: FONT, size: 22, bold: true, color: { argb: C.white } };
  rs.getCell(r, 2).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  r++;
  band(r, C.ink, 26);
  rs.mergeCells(r, 2, r, 5);
  rs.getCell(r, 2).value = `${data.periodLabel}  ·  ${data.rangeLabel}`;
  rs.getCell(r, 2).font = { name: FONT, size: 13, bold: true, color: { argb: 'FFC6A8FF' } };
  rs.getCell(r, 2).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  r++;
  band(r, C.ink, 24);
  rs.mergeCells(r, 2, r, 5);
  const dt = (ms: number) => {
    const w = wall(ms, tz);
    return `${pad(w.getUTCDate())}/${pad(w.getUTCMonth() + 1)}/${w.getUTCFullYear()} ${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`;
  };
  rs.getCell(r, 2).value = `Dados até ${dt(Date.parse(data.generatedAt))}  ·  planilha gerada em ${dt(ctx.exportedAt)} por ${ctx.by}  ·  horário da Bahia (UTC−3)`;
  rs.getCell(r, 2).font = { name: FONT, size: 10, color: { argb: 'FFCFC6E6' } };
  rs.getCell(r, 2).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  r += 2;

  const section = (title: string) => {
    rs.getRow(r).height = 24;
    for (let c = 2; c <= 5; c++) {
      const cell = rs.getCell(r, c);
      cell.fill = fill(C.lilacSoft);
      cell.border = { bottom: { style: 'medium', color: { argb: C.lilac } } };
    }
    rs.getCell(r, 2).value = title;
    rs.getCell(r, 2).font = { name: FONT, size: 11, bold: true, color: { argb: C.ink } };
    rs.getCell(r, 2).alignment = { vertical: 'middle', indent: 1 };
    r++;
  };
  const kpi = (label: string, value: number, fmt: string, note: string, color?: string) => {
    rs.getRow(r).height = 23;
    const a = rs.getCell(r, 2);
    a.value = label;
    a.font = { name: FONT, size: 11, color: { argb: C.text } };
    a.alignment = { vertical: 'middle', indent: 1 };
    const b = rs.getCell(r, 3);
    b.value = value;
    b.numFmt = fmt;
    b.font = { name: FONT, size: 13, bold: true, color: { argb: color ?? C.ink } };
    b.alignment = { vertical: 'middle', horizontal: 'right' };
    rs.mergeCells(r, 4, r, 5);
    const n = rs.getCell(r, 4);
    n.value = note;
    n.font = { name: FONT, size: 10, italic: true, color: { argb: C.muted } };
    n.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    for (let c = 2; c <= 5; c++) rs.getCell(r, c).border = { bottom: thin(C.border) };
    r++;
  };

  const t = data.totals;
  section('VISÃO GERAL DO PERÍODO');
  kpi('Unidades que entraram', t.in, INT, 'Entradas + devoluções de postos', C.green);
  kpi('Unidades que saíram', t.out, INT, 'Saídas + transferências a postos', C.purple);
  kpi('Saldo líquido', t.net, SIGNED, 'Entradas − saídas', t.net < 0 ? C.red : t.net > 0 ? C.green : C.ink);
  kpi('Movimentações', t.moves, INT, 'Registros (exceto criação e exclusão de item)');
  kpi('Itens diferentes movimentados', t.itemsMoved, INT, 'Itens com alguma entrada ou saída');
  kpi('Transferidas a postos (unidades)', t.transfers, INT, 'Do almoxarifado para o estoque de um posto');
  kpi('Devolvidas por postos (unidades)', t.returns, INT, 'Do posto de volta ao almoxarifado');
  kpi('Consumidas nos postos (unidades)', t.consumed, INT, 'Baixa feita no estoque do posto');
  kpi('Ajustes de inventário', t.adjustments, INT, 'Contagens que corrigiram o saldo (registros)');
  kpi('Solicitações recebidas', t.requests, INT, 'Pedidos que chegaram pelo formulário no período', C.amber);
  kpi('Solicitações ainda abertas', t.requestsOpen, INT, 'Entre as recebidas: novas ou pendentes agora');
  r++;

  section('MOVIMENTAÇÃO POR TIPO');
  rs.getRow(r).height = 22;
  ['Tipo', 'Registros', 'Unidades'].forEach((h, i) => {
    const cell = rs.getCell(r, 2 + i);
    cell.value = h;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: C.muted } };
    cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'right', indent: i === 0 ? 1 : 0 };
    cell.border = { bottom: thin(C.border) };
  });
  rs.getCell(r, 5).border = { bottom: thin(C.border) };
  r++;
  const kindRows = KIND_ORDER.map((k) => data.byKind.find((x) => x.kind === k) ?? { kind: k, count: 0, units: 0 });
  for (const k of kindRows) {
    rs.getRow(r).height = 21;
    const a = rs.getCell(r, 2);
    a.value = KIND_LABEL[k.kind] ?? k.kind;
    a.font = { name: FONT, size: 11, color: { argb: k.count ? C.text : C.muted } };
    a.alignment = { vertical: 'middle', indent: 1 };
    [k.count, k.units].forEach((v, i) => {
      const cell = rs.getCell(r, 3 + i);
      cell.value = v;
      cell.numFmt = INT;
      cell.font = { name: FONT, size: 11, color: { argb: k.count ? C.text : C.muted } };
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    });
    for (let c = 2; c <= 5; c++) rs.getCell(r, c).border = { bottom: thin(C.border) };
    r++;
  }
  r++;

  section('SITUAÇÃO ATUAL DO ESTOQUE (no momento da planilha)');
  kpi('Itens cadastrados', data.stock.items, INT, 'Cada tamanho conta como um item');
  kpi('Unidades no almoxarifado', data.stock.units, INT, 'Não inclui o que já está nos postos');
  kpi('Itens abaixo do mínimo', data.stock.low, INT, 'Saldo igual ou menor que o estoque mínimo', data.stock.low ? C.red : C.ink);
  kpi('Itens sem saldo', data.stock.zero, INT, 'Saldo zero no almoxarifado', data.stock.zero ? C.red : C.ink);
  r++;

  section('COMO LER ESTA PLANILHA');
  const notes = [
    'Abas: "Linha do tempo" (números por hora ou por dia), "Itens" (o que mais entrou e saiu), "Postos" (o que cada posto recebeu), "Movimentações" (todos os registros) e "Solicitações".',
    'Entradas = entrada + devolução de posto. Saídas = saída + transferência a posto. Ajustes, consumo nos postos e criação/exclusão de item aparecem nos detalhes, mas não entram nesses dois totais.',
    'Todas as abas de dados têm o cabeçalho na primeira linha, sem linhas de total, e podem ser filtradas no Excel ou importadas no Power BI.',
    `Datas e horas no horário da Bahia (UTC−3). O período vai de ${dt(fromMs)} até ${dt(toMs)}.`,
  ];
  if (ctx.truncated) notes.push('ATENÇÃO: havia mais registros do que o limite de leitura; os números podem estar incompletos.');
  if (moves.length > MAX_LOG_ROWS) notes.push(`A aba "Movimentações" mostra os ${MAX_LOG_ROWS.toLocaleString('pt-BR')} registros mais recentes do período.`);
  for (const n of notes) {
    rs.mergeCells(r, 2, r, 5);
    const cell = rs.getCell(r, 2);
    cell.value = `•  ${n}`;
    cell.font = { name: FONT, size: 10.5, color: { argb: n.startsWith('ATENÇÃO') ? C.red : C.text }, bold: n.startsWith('ATENÇÃO') };
    cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
    rs.getRow(r).height = Math.max(20, Math.ceil(n.length / 128) * 15 + 6);
    r++;
  }
  rs.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };

  /* ----------------------------- Linha do tempo ----------------------------- */
  const hourly = data.granularity === 'hour';
  const live = data.buckets.filter((b) => !b.future);
  const WD = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const tl = dataSheet(
    wb,
    'Linha do tempo',
    C.green,
    [
      { header: 'Data', width: 14, align: 'center', fmt: 'dd/mm/yyyy', value: (b: (typeof live)[number]) => wall(Date.parse(b.start), tz) },
      hourly
        ? { header: 'Hora', width: 14, align: 'center', value: (b: (typeof live)[number]) => `${b.label}–${pad((Number.parseInt(b.label, 10) + 1) % 24)}h` }
        : { header: 'Dia da semana', width: 18, align: 'left', value: (b: (typeof live)[number]) => WD[wall(Date.parse(b.start), tz).getUTCDay()] },
      { header: 'Entradas (un.)', width: 16, align: 'center', fmt: INT, value: (b: (typeof live)[number]) => b.in },
      { header: 'Saídas (un.)', width: 16, align: 'center', fmt: INT, value: (b: (typeof live)[number]) => b.out },
      { header: 'Saldo líquido', width: 15, align: 'center', fmt: SIGNED, value: (b: (typeof live)[number]) => b.in - b.out },
      { header: 'Movimentações', width: 17, align: 'center', fmt: INT, value: (b: (typeof live)[number]) => b.moves },
      { header: 'Solicitações recebidas', width: 22, align: 'center', fmt: INT, value: (b: (typeof live)[number]) => b.requests },
    ],
    live,
  );
  decorate(tl, live.length, [{ col: 'C', color: C.greenBar }, { col: 'D', color: C.purpleBar }], ['E']);

  /* --------------------------------- Itens ---------------------------------- */
  const itemsSheet = dataSheet(
    wb,
    'Itens',
    C.purple,
    [
      { header: 'Item', width: 56, align: 'left', value: (i: (typeof data.items)[number]) => i.name },
      { header: 'Entradas (un.)', width: 16, align: 'center', fmt: INT, value: (i: (typeof data.items)[number]) => i.in },
      { header: 'Saídas (un.)', width: 16, align: 'center', fmt: INT, value: (i: (typeof data.items)[number]) => i.out },
      { header: 'Saldo líquido', width: 15, align: 'center', fmt: SIGNED, value: (i: (typeof data.items)[number]) => i.in - i.out },
      { header: 'Movimentações', width: 17, align: 'center', fmt: INT, value: (i: (typeof data.items)[number]) => i.moves },
      { header: 'Estoque atual (un.)', width: 20, align: 'center', fmt: INT, value: (i: (typeof data.items)[number]) => i.current },
    ],
    data.items,
  );
  decorate(itemsSheet, data.items.length, [{ col: 'B', color: C.greenBar }, { col: 'C', color: C.purpleBar }], ['D']);

  /* --------------------------------- Postos --------------------------------- */
  const postosSheet = dataSheet(
    wb,
    'Postos',
    C.amber,
    [
      { header: 'Posto', width: 40, align: 'left', value: (p: (typeof data.postos)[number]) => p.name },
      { header: 'Recebido (un.)', width: 17, align: 'center', fmt: INT, value: (p: (typeof data.postos)[number]) => p.received },
      { header: 'Devolvido (un.)', width: 17, align: 'center', fmt: INT, value: (p: (typeof data.postos)[number]) => p.returned },
      { header: 'Consumido (un.)', width: 17, align: 'center', fmt: INT, value: (p: (typeof data.postos)[number]) => p.consumed },
      { header: 'Variação no posto', width: 19, align: 'center', fmt: SIGNED, value: (p: (typeof data.postos)[number]) => p.received - p.returned - p.consumed },
      { header: 'Movimentações', width: 17, align: 'center', fmt: INT, value: (p: (typeof data.postos)[number]) => p.moves },
    ],
    data.postos,
  );
  decorate(postosSheet, data.postos.length, [{ col: 'B', color: C.purpleBar }], ['E']);

  /* ------------------------------ Movimentações ----------------------------- */
  const log = moves
    .filter((m) => inWindow(m.created_at))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, MAX_LOG_ROWS);
  const effect = (m: MoveInput): number | null => {
    const q = Math.max(0, Math.trunc(Number(m.quantity) || 0));
    if (m.kind === 'entrada' || m.kind === 'devolucao' || m.kind === 'criacao') return q;
    if (m.kind === 'saida' || m.kind === 'transferencia' || m.kind === 'exclusao') return -q;
    if (m.kind === 'baixa_posto') return 0;
    if (m.kind === 'ajuste') return typeof m.before_qty === 'number' && typeof m.after_qty === 'number' ? m.after_qty - m.before_qty : null;
    return null;
  };
  const mv = dataSheet(
    wb,
    'Movimentações',
    C.lilac,
    [
      { header: 'Data e hora', width: 19, align: 'center', fmt: 'dd/mm/yyyy hh:mm', value: (m: MoveInput) => when(m.created_at, tz) },
      { header: 'Tipo', width: 24, align: 'left', value: (m: MoveInput) => KIND_LABEL[m.kind] ?? m.kind },
      { header: 'Item', width: 52, align: 'left', value: (m: MoveInput) => m.item_name },
      { header: 'Posto', width: 28, align: 'left', value: (m: MoveInput) => m.posto_name ?? '' },
      { header: 'Quantidade', width: 14, align: 'center', fmt: INT, value: (m: MoveInput) => m.quantity },
      { header: 'Variação no almoxarifado', width: 25, align: 'center', fmt: SIGNED, value: (m: MoveInput) => effect(m) },
      { header: 'Saldo antes', width: 14, align: 'center', fmt: INT, value: (m: MoveInput) => m.before_qty },
      { header: 'Saldo depois', width: 14, align: 'center', fmt: INT, value: (m: MoveInput) => m.after_qty },
      { header: 'Responsável', width: 20, align: 'left', value: (m: MoveInput) => m.by_name ?? '' },
      { header: 'Observação', width: 46, align: 'left', value: (m: MoveInput) => m.note ?? '' },
    ],
    log,
  );
  decorate(mv, log.length, [], ['F']);

  /* ------------------------------- Solicitações ------------------------------ */
  const rq = reqs
    .filter((x) => inWindow(x.created_at))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  dataSheet(
    wb,
    'Solicitações',
    'FF7C7790',
    [
      { header: 'Protocolo', width: 13, align: 'center', fmt: '"#"0000', value: (x: ReqInput) => x.protocol },
      { header: 'Recebida em', width: 19, align: 'center', fmt: 'dd/mm/yyyy hh:mm', value: (x: ReqInput) => when(x.created_at, tz) },
      { header: 'Colaborador', width: 34, align: 'left', value: (x: ReqInput) => x.collaborator ?? '' },
      { header: 'Posto', width: 30, align: 'left', value: (x: ReqInput) => x.posto ?? '' },
      { header: 'Situação', width: 15, align: 'center', value: (x: ReqInput) => STATUS_LABEL[x.status] ?? x.status },
      { header: 'Atendida por', width: 22, align: 'left', value: (x: ReqInput) => x.handled_by ?? '' },
    ],
    rq,
  );

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
