import 'server-only';
import PDFDocument from 'pdfkit';
import { brl, paymentText, poLabel, poTotal, quoteLabel, type ComprasConfig, type Proposal, type PurchaseOrder, type Quote } from './pc';
import { leadText } from './prazo';
import { formatDoc } from './fornecedores';

/**
 * Documentos de Compras em PDF (A4): o pedido de compra que vai para o fornecedor e a
 * solicitação de orçamento. Desenhados com o pdfkit, leves e nítidos na impressão.
 */
const INK = '#1D1430';
const LILAC = '#6B3FD6';
const SOFT = '#F1EAFF';
const TEXT = '#241B3A';
const MUTED = '#6B6483';
const LINE = '#E3DAF6';
const W = 595.28;
const H = 841.89;
const M = 40;
const CW = W - M * 2;
/** data (dd/mm/aaaa); horário ISO vira o dia em Salvador (UTC−3), não o de Greenwich */
const dateBR = (d: string | null | undefined) => {
  if (!d) return '—';
  const t = d.length > 10 ? Date.parse(d) : NaN;
  const day = Number.isFinite(t) ? new Date(t - 3 * 3_600_000).toISOString().slice(0, 10) : d.slice(0, 10);
  return day.split('-').reverse().join('/');
};
const num = (n: number) => n.toLocaleString('pt-BR');

function base(title: string, author: string) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: title, Author: author, Creator: 'Max Hub' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const font = (bold = false) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
  return { doc, done, font };
}

function header(ctx: ReturnType<typeof base>, cfg: ComprasConfig, title: string, number: string, sub: string) {
  const { doc, font } = ctx;
  doc.rect(0, 0, W, 92).fill(INK);
  font(true).fontSize(9).fillColor('#C6A8FF').text((cfg.company.name || 'Grupo Max Forte').toUpperCase(), M, 26, { width: CW / 2 });
  font().fontSize(8).fillColor('#CFC6E6').text([cfg.company.cnpj ? `CNPJ ${formatDoc(cfg.company.cnpj)}` : '', cfg.company.address, [cfg.company.phone, cfg.company.email].filter(Boolean).join(' · ')].filter(Boolean).join('\n'), M, 40, { width: CW / 2 });
  font(true).fontSize(17).fillColor('#FFFFFF').text(title, M + CW / 2, 24, { width: CW / 2, align: 'right' });
  font(true).fontSize(12).fillColor('#E2D4FF').text(number, M + CW / 2, 46, { width: CW / 2, align: 'right' });
  font().fontSize(8).fillColor('#A99FC4').text(sub, M + CW / 2, 64, { width: CW / 2, align: 'right' });
  return 112;
}

function boxes(ctx: ReturnType<typeof base>, y: number, cells: [string, string][], cols = 2) {
  const { doc, font } = ctx;
  const w = (CW - (cols - 1) * 10) / cols;
  let maxH = 0;
  const rows: number[] = [];
  cells.forEach(([, v], i) => {
    const h = 20 + doc.font('Helvetica').fontSize(9.5).heightOfString(v || '—', { width: w - 20 });
    rows[Math.floor(i / cols)] = Math.max(rows[Math.floor(i / cols)] ?? 0, h);
  });
  let yy = y;
  cells.forEach(([k, v], i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    if (c === 0 && i) yy += rows[r - 1] + 14;
    const x = M + c * (w + 10);
    const h = rows[r] + 8;
    doc.roundedRect(x, yy, w, h, 6).fill(SOFT);
    font().fontSize(7).fillColor(MUTED).text(k.toUpperCase(), x + 10, yy + 7, { width: w - 20, characterSpacing: 0.3 });
    font(true).fontSize(9.5).fillColor(TEXT).text(v || '—', x + 10, yy + 18, { width: w - 20 });
    maxH = yy + h;
  });
  return maxH + 14;
}

type Col = { t: string; w: number; a?: 'left' | 'right' | 'center' };
function table(ctx: ReturnType<typeof base>, y: number, cols: Col[], rows: string[][], footer?: string[][]) {
  const { doc, font } = ctx;
  const draw = (cells: string[], yy: number, bold: boolean, fill?: string) => {
    const h = Math.max(...cells.map((c, i) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).heightOfString(c, { width: cols[i].w - 10 }))) + 10;
    if (yy + h > H - 60) {
      doc.addPage();
      yy = 40;
    }
    if (fill) doc.rect(M, yy, CW, h).fill(fill);
    let x = M;
    cells.forEach((c, i) => {
      font(bold).fontSize(8.5).fillColor(bold && fill === INK ? '#FFFFFF' : TEXT).text(c, x + 5, yy + 5, { width: cols[i].w - 10, align: cols[i].a ?? 'left' });
      x += cols[i].w;
    });
    doc.moveTo(M, yy + h).lineTo(M + CW, yy + h).lineWidth(0.5).strokeColor(LINE).stroke();
    return yy + h;
  };
  let yy = draw(cols.map((c) => c.t), y, true, INK);
  rows.forEach((r) => (yy = draw(r, yy, false)));
  footer?.forEach((r) => (yy = draw(r, yy, true, SOFT)));
  return yy + 14;
}

function footerAll(ctx: ReturnType<typeof base>, text: string) {
  const { doc, font } = ctx;
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    font().fontSize(7.5).fillColor(MUTED).text(`${text} · página ${i + 1} de ${range.count}`, M, H - 30, { width: CW, align: 'center', lineBreak: false });
  }
}

/** marca d'água em todas as páginas (pedido que ainda não vale como compra) */
function watermark(ctx: ReturnType<typeof base>, text: string) {
  const { doc, font } = ctx;
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.save();
    doc.rotate(-35, { origin: [W / 2, H / 2] });
    font(true).fontSize(64).fillColor('#C0392B').fillOpacity(0.14).text(text, 0, H / 2 - 32, { width: W, align: 'center', lineBreak: false });
    doc.restore();
    doc.fillOpacity(1);
  }
}

function para(ctx: ReturnType<typeof base>, y: number, title: string, body: string) {
  const { doc, font } = ctx;
  if (y > H - 120) {
    doc.addPage();
    y = 40;
  }
  font(true).fontSize(10).fillColor(LILAC).text(title, M, y);
  font().fontSize(9).fillColor(TEXT).text(body, M, y + 15, { width: CW });
  return doc.y + 14;
}

/** Pedido de compra para o fornecedor */
export function poPdf(o: PurchaseOrder, cfg: ComprasConfig, by: string): Promise<Buffer> {
  const ctx = base(`${poLabel(o.number)} · ${o.supplier_name}`, by);
  let y = header(ctx, cfg, 'PEDIDO DE COMPRA', poLabel(o.number), `Emitido em ${dateBR(o.created_at)}`);
  y = boxes(ctx, y, [
    ['Fornecedor', `${o.supplier_name}${o.cnpj ? `\nCNPJ ${formatDoc(o.cnpj)}` : ''}`],
    ['Entrega', `${o.delivery.location ?? cfg.delivery_location}\n${o.promised_date ? `Data confirmada: ${dateBR(o.promised_date)}` : o.expected_date ? `Previsão: ${dateBR(o.expected_date)}` : leadText(o.delivery.days, o.delivery.business)}${o.delivery.mode === 'producao' ? ' · sob produção' : ''}`],
    ['Pagamento', `${paymentText(o.payment)}${o.payment.note ? `\n${o.payment.note}` : ''}`],
    ['Aprovação', o.approval ? `${o.approval.auto ? 'Alçada automática' : o.approval.by} em ${dateBR(o.approval.at)}` : 'Aguardando aprovação'],
  ]);
  const rows = o.items.map((i, n) => [
    String(n + 1),
    `${i.name}${i.size ? ` · ${i.size}` : ''}${i.brand || i.spec ? `\n${[i.brand, i.spec].filter(Boolean).join(' · ')}` : ''}${i.ext_code ? `\nCód. fornecedor: ${i.ext_code}` : ''}`,
    i.unit,
    num(i.qty),
    brl(i.unit_price),
    brl(i.qty * i.unit_price),
  ]);
  const goods = o.items.reduce((t, i) => t + i.qty * i.unit_price, 0);
  const foot: string[][] = [['', 'Mercadorias', '', '', '', brl(goods)]];
  if (o.freight) foot.push(['', 'Frete', '', '', '', brl(o.freight)]);
  if (o.other_costs) foot.push(['', 'Outros custos', '', '', '', brl(o.other_costs)]);
  if (o.discount) foot.push(['', 'Desconto', '', '', '', '− ' + brl(o.discount)]);
  foot.push(['', 'TOTAL DO PEDIDO', '', '', '', brl(poTotal(o))]);
  y = table(ctx, y, [{ t: '#', w: 24, a: 'center' }, { t: 'Item', w: 235 }, { t: 'Unid.', w: 46 }, { t: 'Qtd.', w: 50, a: 'right' }, { t: 'Preço unit.', w: 80, a: 'right' }, { t: 'Total', w: CW - 435, a: 'right' }], rows, foot);
  if (o.notes) y = para(ctx, y, 'Observações', o.notes);
  y = para(
    ctx,
    y,
    'Condições',
    `Favor confirmar o recebimento deste pedido e a data de entrega. A nota fiscal deve citar o número ${poLabel(o.number)}. Mercadoria divergente do pedido (item, quantidade, especificação ou preço) poderá ser recusada no recebimento.`,
  );
  if (o.status === 'cancelado') watermark(ctx, 'CANCELADO');
  else if (o.status === 'rascunho' || o.status === 'aguardando_aprovacao') watermark(ctx, 'NÃO APROVADO');
  footerAll(ctx, `${cfg.company.name} · ${poLabel(o.number)}`);
  ctx.doc.end();
  return ctx.done;
}

/** Solicitação de orçamento para um fornecedor (sem preços de ninguém) */
export function rfqPdf(q: Quote, p: Proposal | null, cfg: ComprasConfig, by: string): Promise<Buffer> {
  const ctx = base(`Solicitação de orçamento ${quoteLabel(q.number)}`, by);
  let y = header(ctx, cfg, 'SOLICITAÇÃO DE ORÇAMENTO', quoteLabel(q.number), `Emitida em ${dateBR(new Date().toISOString())}`);
  y = boxes(ctx, y, [
    ['Para', p ? `${p.supplier_name}${p.cnpj ? `\nCNPJ ${formatDoc(p.cnpj)}` : ''}` : 'Fornecedor'],
    ['Responder até', q.reply_by ? dateBR(q.reply_by) : 'O quanto antes'],
    ['Local de entrega', cfg.delivery_location],
    ['Contato', [by, cfg.company.phone, cfg.company.email].filter(Boolean).join(' · ')],
  ]);
  y = table(
    ctx,
    y,
    [{ t: '#', w: 24, a: 'center' }, { t: 'Item', w: 255 }, { t: 'Unid.', w: 50 }, { t: 'Qtd.', w: 56, a: 'right' }, { t: 'Preço unitário', w: CW - 385, a: 'right' }],
    q.items.map((i, n) => [String(n + 1), `${i.name}${i.size ? ` · ${i.size}` : ''}`, i.unit, num(i.qty), '']),
  );
  y = para(
    ctx,
    y,
    'Informe na proposta',
    `• Preço unitário de cada item, descontos, frete e demais custos\n• Condição de pagamento (à vista ou parcelado: número de parcelas e prazos)\n• Prazo de entrega em dias úteis, se é pronta entrega ou sob produção, e a data de início da contagem\n• Marca, modelo/especificação e garantia\n• Validade da proposta (pedimos pelo menos ${cfg.quote_valid_days} dias)`,
  );
  if (q.note) para(ctx, y, 'Observações', q.note);
  footerAll(ctx, `${cfg.company.name} · ${quoteLabel(q.number)}`);
  ctx.doc.end();
  return ctx.done;
}

/** texto pronto para o e-mail do pedido de orçamento */
export function rfqEmail(q: Quote, p: Proposal | null, cfg: ComprasConfig, by: string) {
  const lines = q.items.map((i) => `- ${i.name}${i.size ? ` (${i.size})` : ''}: ${num(i.qty)} ${i.unit}`).join('\n');
  return {
    subject: `Solicitação de orçamento ${quoteLabel(q.number)} — ${cfg.company.name}`,
    body: `Olá${p ? `, ${p.supplier_name}` : ''}!\n\nPor favor, envie o orçamento dos itens abaixo${q.reply_by ? ` até ${dateBR(q.reply_by)}` : ''}:\n\n${lines}\n\nInforme preço unitário, frete, condição de pagamento, prazo de entrega em dias úteis (pronta entrega ou produção), marca/modelo, garantia e validade da proposta.\nEntrega: ${cfg.delivery_location}.\n\nObrigado,\n${by}\n${cfg.company.name}${cfg.company.phone ? `\n${cfg.company.phone}` : ''}`,
  };
}

/** Programação de vencimentos (previsão de desembolso — não indica pagamento) */
export function duesPdf(
  rows: { due: string | null; supplier: string; note: string; n: string; value: number; order: string | null; status: string }[],
  opts: { cfg: ComprasConfig; by: string; period: string },
): Promise<Buffer> {
  const ctx = base('Programação de vencimentos', opts.by);
  let y = header(ctx, opts.cfg, 'VENCIMENTOS', opts.period, `Gerado em ${dateBR(new Date().toISOString())} por ${opts.by}`);
  const total = rows.reduce((t, r) => t + r.value, 0);
  const byMonth = new Map<string, number>();
  const bySup = new Map<string, number>();
  for (const r of rows) {
    const m = r.due ? r.due.slice(0, 7).split('-').reverse().join('/') : 'Sem data';
    byMonth.set(m, (byMonth.get(m) ?? 0) + r.value);
    bySup.set(r.supplier, (bySup.get(r.supplier) ?? 0) + r.value);
  }
  y = boxes(ctx, y, [
    ['Total no período', brl(total)],
    ['Parcelas', String(rows.length)],
  ]);
  y = table(ctx, y, [{ t: 'Mês', w: 180 }, { t: 'Valor', w: CW - 180, a: 'right' }], [...byMonth].map(([m, v]) => [m, brl(v)]));
  y = table(ctx, y, [{ t: 'Fornecedor', w: 300 }, { t: 'Valor', w: CW - 300, a: 'right' }], [...bySup].sort((a, b) => b[1] - a[1]).map(([s, v]) => [s, brl(v)]));
  y = table(
    ctx,
    y,
    [{ t: 'Vencimento', w: 70 }, { t: 'Fornecedor', w: 160 }, { t: 'Nota', w: 70 }, { t: 'Parcela', w: 50 }, { t: 'Pedido', w: 60 }, { t: 'Valor', w: CW - 410, a: 'right' }],
    rows.map((r) => [dateBR(r.due), r.supplier, r.note, r.n, r.order ?? '—', brl(r.value)]),
    [['', 'TOTAL', '', '', '', brl(total)]],
  );
  para(ctx, y, 'Atenção', 'Esta é a previsão de desembolso registrada nas notas fiscais. Não indica que algum valor foi pago e não é o saldo bancário.');
  footerAll(ctx, `${opts.cfg.company.name} · Vencimentos`);
  ctx.doc.end();
  return ctx.done;
}
