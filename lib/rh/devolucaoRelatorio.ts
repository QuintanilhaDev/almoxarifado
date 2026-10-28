import 'server-only';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { STATUS_DEV, clienteDe, type Desligado } from './devolucao';

/**
 * Relatório de colaboradores desligados e a devolução do fardamento/equipamentos.
 * PDF (A4 deitado, para imprimir e assinar) e planilha Excel com os mesmos dados.
 */
const INK = '#1D1430';
const LILAC = '#A982FF';
const LILAC_SOFT = '#F1EAFF';
const TEXT = '#241B3A';
const MUTED = '#6B6483';
const LINE = '#E3DAF6';
const RED = '#D6455D';
const GREEN = '#1F9D6B';
const AMBER = '#B7791F';

const W = 841.89;
const H = 595.28;
const M = 34;
const CW = W - M * 2;
const dataBR = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const pad = (n: number) => String(n).padStart(2, '0');
const agora = () => {
  const w = new Date(Date.now() - 3 * 3_600_000);
  return `${pad(w.getUTCDate())}/${pad(w.getUTCMonth() + 1)}/${w.getUTCFullYear()} às ${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`;
};
const COR_STATUS = { pendente: AMBER, devolvido: GREEN, nao_devolvido: RED } as const;

export interface FiltroRelatorio {
  cliente: string;
  posto: string;
  situacao: 'pendentes' | 'todos';
}
export const filtroTxt = (f: FiltroRelatorio) =>
  [f.situacao === 'pendentes' ? 'Só com devolução pendente' : 'Todos os desligados', f.cliente ? `Cliente: ${f.cliente}` : 'Todos os clientes', f.posto ? `Posto: ${f.posto}` : 'Todos os postos'].join(' · ');

export function aplicaFiltro(lista: Desligado[], f: FiltroRelatorio): Desligado[] {
  return lista.filter((d) => (f.situacao === 'todos' || d.pendentes > 0) && (!f.cliente || clienteDe(d) === f.cliente) && (!f.posto || (d.posto_name ?? '') === f.posto));
}

export function devolucaoPdf(lista: Desligado[], f: FiltroRelatorio, por: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, bufferPages: true, info: { Title: 'Desligados e devolução de fardamento · Max Hub', Author: por, Creator: 'Max Hub' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const font = (b = false) => doc.font(b ? 'Helvetica-Bold' : 'Helvetica');
  let y = 0;
  const mark = (x: number, yy: number, s: number) => {
    doc.roundedRect(x, yy, s, s, s * 0.28).fill(LILAC);
    doc.circle(x + s * 0.44, yy + s * 0.56, s * 0.2).fill(INK);
    doc.circle(x + s * 0.72, yy + s * 0.28, s * 0.09).fill(INK);
  };
  const mini = () => {
    doc.rect(0, 0, W, 30).fill(INK);
    mark(M, 8, 14);
    font(true)
      .fontSize(9)
      .fillColor('#FFFFFF')
      .text('Desligados e devolução de fardamento', M + 22, 11);
    font().fontSize(8).fillColor('#CFC6E6').text(filtroTxt(f), M, 11, { width: CW, align: 'right' });
    y = 46;
  };
  const ensure = (need: number) => {
    if (y + need > H - 40) {
      doc.addPage();
      mini();
    }
  };

  // ---- capa (faixa) e números
  const todosItens = lista.flatMap((d) => d.itens);
  const pend = todosItens.filter((i) => i.status === 'pendente');
  const pendUn = pend.reduce((t, i) => t + (Math.max(0, i.qty_delivered - i.qty_returned) || 1), 0);
  doc.rect(0, 0, W, 112).fill(INK);
  mark(M, 26, 26);
  font(true)
    .fontSize(10)
    .fillColor('#C6A8FF')
    .text('MAX HUB · GRUPO MAX FORTE · RH/DP', M + 36, 34);
  font(true).fontSize(22).fillColor('#FFFFFF').text('Desligados e devolução de fardamento', M, 62);
  font()
    .fontSize(9.5)
    .fillColor('#CFC6E6')
    .text(`${filtroTxt(f)} · gerado em ${agora()} por ${por}`, M, 90);
  y = 128;
  const kpis: [string, string, string][] = [
    ['Desligados no relatório', String(lista.length), INK],
    ['Com devolução pendente', String(lista.filter((d) => d.pendentes > 0).length), AMBER],
    ['Itens pendentes', `${pend.length} (${pendUn} un.)`, AMBER],
    ['Itens não devolvidos', String(todosItens.filter((i) => i.status === 'nao_devolvido').length), RED],
  ];
  const kw = (CW - 3 * 10) / 4;
  kpis.forEach(([t, v, cor], i) => {
    const x = M + i * (kw + 10);
    doc.roundedRect(x, y, kw, 52, 8).fill(LILAC_SOFT);
    font()
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(t, x + 12, y + 10, { width: kw - 24 });
    font(true)
      .fontSize(17)
      .fillColor(cor)
      .text(v, x + 12, y + 24, { width: kw - 24 });
  });
  y += 70;

  if (!lista.length) {
    font().fontSize(11).fillColor(MUTED).text('Nenhum colaborador desligado com esses filtros.', M, y);
  }

  // ---- um bloco por colaborador
  const COLS = [
    { t: 'Item', w: 0.3 },
    { t: 'Tam.', w: 0.07 },
    { t: 'Entregue', w: 0.08 },
    { t: 'Última entrega', w: 0.1 },
    { t: 'Devolvido', w: 0.08 },
    { t: 'Data', w: 0.09 },
    { t: 'Situação', w: 0.11 },
    { t: 'Observação', w: 0.17 },
  ];
  for (const d of lista) {
    const itens = f.situacao === 'pendentes' ? d.itens.filter((i) => i.status === 'pendente') : d.itens;
    ensure(64 + Math.min(itens.length, 3) * 16);
    doc.roundedRect(M, y, CW, 34, 6).fill(LILAC_SOFT);
    font(true)
      .fontSize(11)
      .fillColor(INK)
      .text(d.name, M + 10, y + 6, { width: CW * 0.55, ellipsis: true, height: 14 });
    font()
      .fontSize(8.5)
      .fillColor(MUTED)
      .text([d.matricula ? `Mat. ${d.matricula}` : null, d.role, clienteDe(d) || null, d.posto_name].filter(Boolean).join(' · '), M + 10, y + 20, { width: CW * 0.6, ellipsis: true, height: 11 });
    font(true)
      .fontSize(9)
      .fillColor(d.pendentes ? AMBER : GREEN)
      .text(d.pendentes ? `${d.pendentes} pendente(s)` : 'Sem pendência', M, y + 6, { width: CW - 10, align: 'right' });
    font()
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(`Desligado em ${dataBR(d.dismissed_at)}${d.dismissal_reason ? ` · ${d.dismissal_reason}` : ''}`, M, y + 20, { width: CW - 10, align: 'right' });
    y += 40;
    if (!itens.length) {
      font()
        .fontSize(8.5)
        .fillColor(MUTED)
        .text(d.itens.length ? 'Nenhum item pendente.' : 'Nenhum item registrado na conferência.', M + 10, y);
      y += 18;
      continue;
    }
    const head = () => {
      let x = M;
      font(true).fontSize(7.5).fillColor(MUTED);
      for (const c of COLS) {
        doc.text(c.t.toUpperCase(), x + 4, y, { width: CW * c.w - 8 });
        x += CW * c.w;
      }
      y += 12;
      doc
        .moveTo(M, y - 2)
        .lineTo(M + CW, y - 2)
        .lineWidth(0.6)
        .stroke(LINE);
    };
    head();
    for (const i of itens) {
      if (y + 18 > H - 40) {
        doc.addPage();
        mini();
        font(true).fontSize(9).fillColor(INK).text(`${d.name} (continuação)`, M, y);
        y += 16;
        head();
      }
      const vals = [i.item_name, i.size ?? '—', String(i.qty_delivered || '—'), dataBR(i.last_delivered_at), String(i.qty_returned || '—'), dataBR(i.returned_at), STATUS_DEV[i.status], i.notes ?? ''];
      let x = M;
      vals.forEach((v, k) => {
        const st = k === 6;
        font(st)
          .fontSize(8.5)
          .fillColor(st ? COR_STATUS[i.status] : TEXT)
          .text(v, x + 4, y + 3, { width: CW * COLS[k].w - 8, ellipsis: true, height: 11 });
        x += CW * COLS[k].w;
      });
      y += 16;
      doc
        .moveTo(M, y)
        .lineTo(M + CW, y)
        .lineWidth(0.4)
        .stroke(LINE);
    }
    y += 12;
  }

  // rodapé com página
  const n = doc.bufferedPageRange().count;
  for (let p = 0; p < n; p++) {
    doc.switchToPage(p);
    font()
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(`Max Hub · Desligados e devolução · página ${p + 1} de ${n}`, M, H - 24, { width: CW, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}

export async function devolucaoXlsx(lista: Desligado[], f: FiltroRelatorio, por: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Max Hub';
  wb.created = new Date();
  const borda = { style: 'thin' as const, color: { argb: 'FFE3DAF6' } };
  const cab = (ws: ExcelJS.Worksheet, titulo: string, colunas: { header: string; width: number }[]) => {
    ws.mergeCells(1, 1, 1, colunas.length);
    const t = ws.getCell(1, 1);
    t.value = titulo;
    t.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D1430' } };
    t.alignment = { vertical: 'middle', indent: 1 };
    ws.getRow(1).height = 26;
    ws.mergeCells(2, 1, 2, colunas.length);
    const s = ws.getCell(2, 1);
    s.value = `${filtroTxt(f)} · gerado em ${agora()} por ${por}`;
    s.font = { size: 9, color: { argb: 'FF6B6483' } };
    s.alignment = { indent: 1 };
    const h = ws.getRow(4);
    colunas.forEach((c, i) => {
      ws.getColumn(i + 1).width = c.width;
      const cell = h.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: 'FF1D1430' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1EAFF' } };
      cell.border = { bottom: borda };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    h.height = 22;
    ws.views = [{ state: 'frozen', ySplit: 4 }];
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: colunas.length } };
  };
  const dt = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`) : null);

  const r = wb.addWorksheet('Desligados');
  cab(r, 'Desligados e devolução de fardamento', [
    { header: 'Colaborador', width: 36 },
    { header: 'Matrícula', width: 11 },
    { header: 'Função', width: 22 },
    { header: 'Cliente', width: 30 },
    { header: 'Posto', width: 34 },
    { header: 'Desligado em', width: 13 },
    { header: 'Motivo', width: 22 },
    { header: 'Itens', width: 8 },
    { header: 'Pendentes', width: 10 },
    { header: 'Não devolvidos', width: 14 },
  ]);
  for (const d of lista) {
    const row = r.addRow([d.name, d.matricula, d.role, clienteDe(d), d.posto_name, dt(d.dismissed_at), d.dismissal_reason, d.itens.length, d.pendentes, d.itens.filter((i) => i.status === 'nao_devolvido').length]);
    row.getCell(6).numFmt = 'dd/mm/yyyy';
    if (d.pendentes) row.getCell(9).font = { bold: true, color: { argb: 'FFB7791F' } };
    row.eachCell((c) => (c.border = { bottom: borda }));
  }

  const it = wb.addWorksheet('Itens');
  cab(it, 'Itens da devolução', [
    { header: 'Colaborador', width: 34 },
    { header: 'Matrícula', width: 11 },
    { header: 'Cliente', width: 28 },
    { header: 'Posto', width: 32 },
    { header: 'Desligado em', width: 13 },
    { header: 'Item', width: 28 },
    { header: 'Tamanho', width: 10 },
    { header: 'Qtd entregue', width: 12 },
    { header: 'Última entrega', width: 14 },
    { header: 'Qtd devolvida', width: 13 },
    { header: 'Data da devolução', width: 16 },
    { header: 'Situação', width: 14 },
    { header: 'Observação', width: 36 },
  ]);
  const cor = { pendente: 'FFB7791F', devolvido: 'FF1F9D6B', nao_devolvido: 'FFD6455D' } as const;
  for (const d of lista) {
    for (const i of f.situacao === 'pendentes' ? d.itens.filter((x) => x.status === 'pendente') : d.itens) {
      const row = it.addRow([
        d.name,
        d.matricula,
        clienteDe(d),
        d.posto_name,
        dt(d.dismissed_at),
        i.item_name,
        i.size,
        i.qty_delivered || null,
        dt(i.last_delivered_at),
        i.qty_returned || null,
        dt(i.returned_at),
        STATUS_DEV[i.status],
        i.notes,
      ]);
      for (const c of [5, 9, 11]) row.getCell(c).numFmt = 'dd/mm/yyyy';
      row.getCell(12).font = { bold: true, color: { argb: cor[i.status] } };
      row.eachCell((c) => (c.border = { bottom: borda }));
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
