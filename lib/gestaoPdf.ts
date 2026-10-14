import 'server-only';
import PDFDocument from 'pdfkit';
import type { Indicators } from './gestao';

/**
 * Relatório de Gestão em PDF (A4): capa com os números principais, gráficos de barras
 * e as tabelas de atenção. Desenhado à mão com o pdfkit (vetorial, leve e nítido na impressão).
 */
const INK = '#1D1430';
const LILAC = '#A982FF';
const LILAC_SOFT = '#F1EAFF';
const PURPLE = '#6B3FD6';
const TEXT = '#241B3A';
const MUTED = '#6B6483';
const LINE = '#E3DAF6';
const GREEN = '#1F9D6B';
const RED = '#D6455D';
const AMBER = '#B7791F';

const W = 595.28;
const H = 841.89;
const M = 40;
const CW = W - M * 2;

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const int = (v: number) => v.toLocaleString('pt-BR');
const pad = (n: number) => String(n).padStart(2, '0');
const bahia = (d: Date) => {
  const w = new Date(d.getTime() - 3 * 3_600_000);
  return `${pad(w.getUTCDate())}/${pad(w.getUTCMonth() + 1)}/${w.getUTCFullYear()} às ${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`;
};
const dateBR = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');

const plural = (n: number, one: string, many: string) => `${int(n)} ${n === 1 ? one : many}`;

export function gestaoPdf(d: Indicators, opts: { by: string; period: string }): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: 'Relatório de Gestão · Max Hub', Author: opts.by, Creator: 'Max Hub' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  let y = 0;

  const font = (bold = false) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
  const ensure = (need: number) => {
    if (y + need > H - 56) {
      doc.addPage();
      miniHeader();
    }
  };
  const miniHeader = () => {
    doc.rect(0, 0, W, 34).fill(INK);
    mark(M, 9, 16);
    font(true).fontSize(9).fillColor('#FFFFFF').text('Relatório de Gestão', M + 24, 13);
    font().fontSize(8.5).fillColor('#CFC6E6').text(opts.period, M, 13, { width: CW, align: 'right' });
    y = 54;
  };
  /** a marca do Max Hub (quadrado lilás com o ponto) */
  const mark = (x: number, yy: number, s: number) => {
    doc.roundedRect(x, yy, s, s, s * 0.28).fill(LILAC);
    doc.circle(x + s * 0.44, yy + s * 0.56, s * 0.2).fill(INK);
    doc.circle(x + s * 0.72, yy + s * 0.28, s * 0.09).fill(INK);
  };
  const section = (title: string, sub?: string) => {
    ensure(70);
    doc.rect(M, y, 3, 16).fill(LILAC);
    font(true).fontSize(13).fillColor(INK).text(title, M + 10, y + 1);
    if (sub) font().fontSize(8.5).fillColor(MUTED).text(sub, M + 10, y + 1, { width: CW - 10, align: 'right' });
    y += 26;
  };

  /* ---------------- capa ---------------- */
  doc.rect(0, 0, W, 170).fill(INK);
  // detalhe geométrico
  doc.save();
  doc.opacity(0.12);
  for (let i = 0; i < 7; i++) doc.circle(W - 40, 30, 40 + i * 26).lineWidth(1).stroke(LILAC);
  doc.restore();
  mark(M, 38, 30);
  font(true).fontSize(11).fillColor('#C6A8FF').text('MAX HUB · GRUPO MAX FORTE', M + 42, 47);
  font(true).fontSize(28).fillColor('#FFFFFF').text('Relatório de Gestão', M, 84);
  font().fontSize(12).fillColor('#E2D4FF').text(opts.period, M, 120);
  font().fontSize(9).fillColor('#A99FC4').text(`Gerado em ${bahia(new Date(d.at))} por ${opts.by}`, M, 140);
  y = 194;

  /* ---------------- cartões ---------------- */
  const cards: { label: string; value: string; color: string; sub?: string }[] = [
    { label: 'Valor em estoque', value: brl(d.stock.value), color: PURPLE, sub: `${int(d.stock.items)} itens ativos` },
    { label: 'Pedidos em aberto', value: int(d.orders.open), color: LILAC, sub: plural(d.orders.partial, 'parcial', 'parciais') },
    { label: 'Pedidos atrasados', value: int(d.orders.late), color: d.orders.late ? RED : GREEN },
    { label: 'Atendimento médio', value: d.orders.avgDays === null ? '—' : d.orders.avgDays < 1 ? '< 1 dia' : `${d.orders.avgDays.toLocaleString('pt-BR')} dias`, color: GREEN, sub: plural(d.orders.done, 'concluído', 'concluídos') },
    { label: 'Abaixo do mínimo', value: int(d.stock.below), color: d.stock.below ? AMBER : GREEN, sub: `${int(d.replenish)} para repor` },
    { label: 'Compras em aberto', value: int(d.purchases.open), color: LILAC, sub: d.purchases.late ? plural(d.purchases.late, 'atrasada', 'atrasadas') : 'nenhuma atrasada' },
    { label: 'Parcelas vencidas', value: brl(d.notes.overdueValue), color: d.notes.overdue ? RED : GREEN, sub: plural(d.notes.overdue, 'parcela', 'parcelas') },
    { label: 'A vencer em 30 dias', value: brl(d.notes.dueSoonValue), color: AMBER, sub: plural(d.notes.dueSoon, 'parcela', 'parcelas') },
  ];
  const cw = (CW - 3 * 10) / 4;
  const ch = 70;
  cards.forEach((c, i) => {
    const x = M + (i % 4) * (cw + 10);
    const yy = y + Math.floor(i / 4) * (ch + 10);
    doc.roundedRect(x, yy, cw, ch, 8).fill('#FFFFFF');
    doc.roundedRect(x, yy, cw, ch, 8).lineWidth(0.8).stroke(LINE);
    doc.roundedRect(x, yy + 12, 3, ch - 24, 1.5).fill(c.color);
    font().fontSize(8).fillColor(MUTED).text(c.label.toUpperCase(), x + 12, yy + 11, { width: cw - 18, characterSpacing: 0.3 });
    let size = 17;
    font(true).fontSize(size);
    while (doc.widthOfString(c.value) > cw - 20 && size > 10) doc.fontSize(--size);
    doc.fillColor(INK).text(c.value, x + 12, yy + 28, { width: cw - 18, lineBreak: false });
    if (c.sub) font().fontSize(7.5).fillColor(MUTED).text(c.sub, x + 12, yy + 51, { width: cw - 18 });
  });
  y += ch * 2 + 10 + 26;

  /* ---------------- estoque ---------------- */
  section('Estoque', 'Físico, reservado e disponível');
  {
    const total = Math.max(1, d.stock.physical);
    const resW = (d.stock.reserved / total) * CW;
    doc.roundedRect(M, y, CW, 16, 8).fill(LILAC_SOFT);
    doc.roundedRect(M, y, Math.max(16, CW - resW), 16, 8).fill(PURPLE);
    if (d.stock.reserved) doc.rect(M + CW - resW, y, resW, 16).fill(AMBER);
    y += 24;
    const legend = [
      { c: PURPLE, t: `Disponível  ${int(d.stock.available)}` },
      { c: AMBER, t: `Reservado  ${int(d.stock.reserved)}` },
      { c: INK, t: `Físico  ${int(d.stock.physical)} un.` },
    ];
    let lx = M;
    legend.forEach((l) => {
      doc.circle(lx + 4, y + 4.5, 4).fill(l.c);
      font().fontSize(9).fillColor(TEXT).text(l.t, lx + 12, y);
      lx += doc.widthOfString(l.t) + 34;
    });
    y += 26;
  }
  barChart('Valor por categoria', d.byCategory.map((c) => ({ label: `${c.cat !== '—' ? c.cat + ' · ' : ''}${c.name}`, value: c.value, text: brl(c.value) })), PURPLE);

  /* ---------------- pedidos ---------------- */
  section('Pedidos de material', 'Situação atual e período');
  barChart(
    '',
    [
      { label: 'Em aberto', value: d.orders.open, text: int(d.orders.open) },
      { label: 'Parcialmente atendidos', value: d.orders.partial, text: int(d.orders.partial) },
      { label: 'Aguardando compra', value: d.orders.waitingPurchase, text: int(d.orders.waitingPurchase), color: AMBER },
      { label: 'Atrasados', value: d.orders.late, text: int(d.orders.late), color: RED },
      { label: 'Concluídos no período', value: d.orders.done, text: int(d.orders.done), color: GREEN },
      { label: 'Cancelados no período', value: d.orders.cancelled, text: int(d.orders.cancelled), color: MUTED },
    ],
    LILAC,
  );
  table(['Origem', 'Em aberto', 'Entregues'], d.orders.byOrigin.map((o) => [o.label, int(o.open), int(o.done)]), [0.6, 0.2, 0.2]);

  /* ---------------- consumo ---------------- */
  if (d.consumption.length) {
    section('Mais consumidos', 'Saídas, entregas e transferências no período');
    barChart('', d.consumption.slice(0, 10).map((c) => ({ label: `${c.name}${c.size ? ' ' + c.size : ''}`, value: c.units, text: `${int(c.units)} un.` })), GREEN);
  }
  if (d.byCompany.length) {
    section('Entregas por empresa');
    table(['Empresa', 'Unidades', 'Valor'], d.byCompany.map((c) => [c.company, int(c.units), brl(c.value)]), [0.56, 0.2, 0.24]);
  }

  /* ---------------- atenção ---------------- */
  if (d.below.length) {
    section('Abaixo do mínimo', plural(d.below.length, 'item', 'itens'));
    table(
      ['Código', 'Item', 'Disponível', 'Mínimo'],
      d.below.slice(0, 25).map((b) => [b.code ?? '—', `${b.name}${b.size ? ' ' + b.size : ''}`, int(b.quantity - b.reserved), int(b.min)]),
      [0.18, 0.5, 0.16, 0.16],
      (row) => (Number(String(row[2]).replace(/\D/g, '')) <= 0 ? RED : AMBER),
    );
  }
  if (d.orders.lateList.length) {
    section('Pedidos atrasados');
    table(['Pedido', 'Origem', 'Para', 'Prazo'], d.orders.lateList.map((o) => [o.number, o.origin, o.who, dateBR(o.due)]), [0.14, 0.3, 0.38, 0.18], () => RED);
  }
  if (d.idle.length) {
    section('Sem movimentação', 'Itens parados com saldo');
    table(['Item', 'Saldo', 'Valor parado'], d.idle.slice(0, 15).map((i) => [`${i.name}${i.size ? ' ' + i.size : ''}`, int(i.quantity), i.value === null ? '—' : brl(i.value)]), [0.6, 0.16, 0.24]);
  }

  /* ---------------- rodapé ---------------- */
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.moveTo(M, H - 38).lineTo(W - M, H - 38).lineWidth(0.6).stroke(LINE);
    font().fontSize(7.5).fillColor(MUTED).text('Max Hub · Grupo Max Forte · Relatório de Gestão', M, H - 30, { lineBreak: false });
    doc.text(`Página ${i + 1} de ${range.count}`, M, H - 30, { width: CW, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;

  /* ---------------- peças ---------------- */
  function barChart(title: string, rows: { label: string; value: number; text: string; color?: string }[], color: string) {
    if (title) {
      ensure(30);
      font(true).fontSize(9.5).fillColor(TEXT).text(title, M, y);
      y += 16;
    }
    const max = Math.max(1, ...rows.map((r) => r.value));
    const labelW = 170;
    const valW = 80;
    const barW = CW - labelW - valW - 10;
    for (const r of rows) {
      ensure(20);
      font().fontSize(8.8).fillColor(TEXT).text(r.label, M, y + 2, { width: labelW - 8, lineBreak: false, ellipsis: true });
      doc.roundedRect(M + labelW, y + 2, barW, 9, 4.5).fill(LILAC_SOFT);
      if (r.value > 0) doc.roundedRect(M + labelW, y + 2, Math.max(9, (r.value / max) * barW), 9, 4.5).fill(r.color ?? color);
      font(true).fontSize(8.8).fillColor(INK).text(r.text, M + labelW + barW + 10, y + 2, { width: valW, align: 'right', lineBreak: false });
      y += 18;
    }
    y += 12;
  }

  function table(head: string[], rows: string[][], widths: number[], tone?: (row: string[]) => string | undefined) {
    const ws = widths.map((w) => w * CW);
    const rowH = 19;
    const drawHead = () => {
      doc.roundedRect(M, y, CW, 20, 4).fill(INK);
      let x = M;
      head.forEach((h, i) => {
        font(true).fontSize(8.2).fillColor('#FFFFFF').text(h, x + 8, y + 6.5, { width: ws[i] - 16, align: i === 0 || i === 1 && head.length > 3 ? 'left' : 'right', lineBreak: false });
        x += ws[i];
      });
      y += 22;
    };
    ensure(rowH * 3 + 22);
    drawHead();
    rows.forEach((row, ri) => {
      if (y + rowH > H - 56) {
        doc.addPage();
        miniHeader();
        drawHead();
      }
      if (ri % 2 === 1) doc.rect(M, y, CW, rowH).fill('#F9F6FF');
      let x = M;
      const c = tone?.(row);
      row.forEach((v, i) => {
        const right = !(i === 0 || (i === 1 && head.length > 3));
        font(right && c && i === 2 ? true : false).fontSize(8.6).fillColor(right && c && i === 2 ? c : TEXT).text(v, x + 8, y + 5.5, { width: ws[i] - 16, align: right ? 'right' : 'left', lineBreak: false, ellipsis: true });
        x += ws[i];
      });
      doc.moveTo(M, y + rowH).lineTo(M + CW, y + rowH).lineWidth(0.5).stroke(LINE);
      y += rowH;
    });
    y += 18;
  }
}
