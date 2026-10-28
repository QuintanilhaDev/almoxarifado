import 'server-only';
import { nameKey } from '../compras/fornecedores';
import { db } from '../supabaseAdmin';
import { bestMatches, normalize } from '../max/text';
import type { StockItem } from '../almoxarifado/types';
import type { NfeItem } from './nfe';
import type { Attachment, ComprasConfig, PurchaseOrder } from '../compras/pc';
import { poLeft } from '../compras/pc';
import { allocate } from './vinculo';
import { BLOCKING, type Divergence, type DivKind, type Installment } from './conferencia';

export const NOTE_COLS =
  'id, number, series, access_key, supplier_id, supplier_name, cnpj, company, company_cnpj, issue_date, received_date, status, items, totals, installments, payment, purchase_request_id, note, created_by, posted_at, history, created_at, updated_at';

export interface NoteLine extends Partial<NfeItem> {
  code: string;
  description: string;
  unit: string;
  qty: number;
  unit_cost: number;
  total: number;
  item_id: string | null;
  received: number;
  /** como a ligação foi achada: pelo código do fornecedor (aprendido) ou pelo nome */
  via?: 'fornecedor' | 'nome' | 'pedido' | null;
  /* recebimento pelo pedido (supabase/compras_pedidos.sql) */
  /** unidades do estoque por unidade da nota (ex.: 1 caixa = 10) */
  factor?: number;
  /** pedido de compra (uma nota pode atender vários) e a linha dele que esta linha atende */
  po_id?: string | null;
  po_key?: string | null;
  /** por que esta linha foi ligada a este pedido (texto para quem confere) */
  po_why?: string | null;
  /** escolhido à mão: a ligação automática não mexe mais */
  po_lock?: boolean;
  /** pedido citado pelo fornecedor no item (xPed / nItemPed do XML) */
  xped?: string | null;
  nitem_ped?: number | null;
  /** linha original da nota (uma linha pode ser dividida entre pedidos: parte X de N) */
  src?: number | null;
  part?: number;
  parts?: number;
  /** conferência física, em unidades do estoque */
  delivered?: number | null;
  accepted?: number | null;
  refused?: number | null;
  inspection_note?: string | null;
  inspected_by?: string | null;
  inspected_at?: string | null;
  /** conferência registrada junto com a entrada (a próxima entrada estende) */
  inspection_auto?: boolean;
}

export interface FiscalNote {
  id: string;
  number: string;
  series: string | null;
  access_key: string | null;
  supplier_id: string | null;
  supplier_name: string;
  cnpj: string | null;
  company: string | null;
  company_cnpj: string | null;
  issue_date: string | null;
  received_date: string | null;
  status: 'aberta' | 'conferencia' | 'divergencia' | 'parcial' | 'lancada' | 'estornada';
  items: NoteLine[];
  totals: Record<string, number>;
  installments: Installment[];
  payment: string | null;
  purchase_request_id: string | null;
  /** pedido principal (o primeiro) */
  purchase_order_id?: string | null;
  /** todos os pedidos que a nota atende (mesmo fornecedor) */
  purchase_order_ids?: string[];
  /** pedidos citados no texto da nota (informações complementares / DANFE) */
  order_refs?: number[];
  attachments?: Attachment[];
  divergences?: Divergence[];
  installments_status?: 'incompleta' | 'validada';
  note: string | null;
  created_by: string | null;
  posted_at: string | null;
  history: { at: string; by: string; what: string }[];
  created_at: string;
  updated_at: string;
}

/** o mínimo de cada nota para a programação de vencimentos */
export type DueNote = Pick<FiscalNote, 'id' | 'number' | 'series' | 'supplier_name' | 'status' | 'installments' | 'installments_status'>;

/** colunas do recebimento pelo pedido (existem depois do supabase/compras_pedidos.sql) */
export const NOTE_COLS_PC = NOTE_COLS + ', purchase_order_id, purchase_order_ids, order_refs, attachments, divergences, installments_status';
let pcCols: { ok: boolean; at: number } | null = null;
/** as colunas novas já existem no banco? (consulta uma vez por minuto) */
export async function noteCols(): Promise<string> {
  if (!pcCols || Date.now() - pcCols.at > 60_000) {
    const { error } = await db().from('fiscal_notes').select('installments_status, purchase_order_ids, order_refs').limit(1);
    pcCols = { ok: !error, at: Date.now() };
  }
  return pcCols.ok ? NOTE_COLS_PC : NOTE_COLS;
}
export const hasPC = async () => (await noteCols()) === NOTE_COLS_PC;

/** os pedidos de compra que a nota atende (notas antigas: só o principal) */
export function noteOrderIds(n: Pick<FiscalNote, 'purchase_order_id' | 'purchase_order_ids'>): string[] {
  const ids = [...(n.purchase_order_ids ?? [])];
  if (n.purchase_order_id && !ids.includes(n.purchase_order_id)) ids.unshift(n.purchase_order_id);
  return ids;
}

export function toNote(r: Record<string, unknown>): FiscalNote {
  return {
    ...(r as unknown as FiscalNote),
    purchase_order_ids: Array.isArray(r.purchase_order_ids) ? (r.purchase_order_ids as string[]) : r.purchase_order_id ? [String(r.purchase_order_id)] : [],
    order_refs: Array.isArray(r.order_refs) ? (r.order_refs as unknown[]).map(Number).filter((x) => x > 0) : [],
    attachments: Array.isArray(r.attachments) ? (r.attachments as Attachment[]) : [],
    divergences: Array.isArray(r.divergences) ? (r.divergences as Divergence[]) : [],
    items: Array.isArray(r.items) ? (r.items as NoteLine[]) : [],
    installments: Array.isArray(r.installments) ? (r.installments as FiscalNote['installments']) : [],
    history: Array.isArray(r.history) ? (r.history as FiscalNote['history']) : [],
    totals: (r.totals as Record<string, number>) ?? {},
  };
}

/** Palavras da descrição da NF que não ajudam a achar o item ("TAM", "N", "PRETA"…). */
const NOISE = /\b(tam|tamanho|n|no|num|numero|un|und|par|pc|pcs|cx|ref|cod|cor|preto|preta|branco|branca|azul|marinho|cinza)\b/g;
const sizeIn = (desc: string) => {
  const n = normalize(desc);
  const m = n.match(/\b(?:tam(?:anho)?|n|numero|no)\s*([a-z0-9]{1,3})\b/) || n.match(/\b(pp|p|m|g|gg|xg|xgg|eg|[3-5]\d)\b\s*$/);
  return m ? m[1] : null;
};

/** Sugere o item do estoque para uma linha da nota (o que o fornecedor já ligou antes vem primeiro). */
export function suggestItem(line: { code: string; description: string; unit?: string | null }, items: StockItem[], learned: Map<string, Learned>): { item_id: string | null; via: 'fornecedor' | 'nome' | null; options: { id: string; label: string; score: number }[]; factor?: number } {
  const label = (i: StockItem) => i.name + (i.size ? ` ${i.size}` : '');
  const hit = line.code ? learned.get(`${line.code}|${(line.unit ?? '').toLowerCase()}`) ?? learned.get(`${line.code}|`) ?? [...learned.entries()].find(([k]) => k.startsWith(`${line.code}|`))?.[1] : undefined;
  const known = hit?.item_id;
  const active = items.filter((i) => i.active !== false);
  if (known && items.some((i) => i.id === known)) {
    const it = items.find((i) => i.id === known)!;
    return { item_id: it.id, via: 'fornecedor', options: [{ id: it.id, label: label(it), score: 1 }], factor: hit?.factor ?? 1 };
  }
  const clean = normalize(line.description).replace(NOISE, ' ').replace(/\s+/g, ' ');
  const size = sizeIn(line.description);
  const hits = bestMatches(clean, active, (i) => i.name, 0.5, 12);
  let options = hits.map((h) => ({ id: h.item.id, label: label(h.item), score: h.score + (size && normalize(h.item.size ?? '') === size ? 0.3 : size && h.item.size ? -0.2 : 0) }));
  options = options.sort((a, b) => b.score - a.score).slice(0, 6);
  // liga sozinho só se for claro: nome bem parecido e (quando a nota fala de tamanho) o tamanho bate
  const top = options[0];
  const second = options[1];
  // pelo nome só SUGERE: movimentar o estoque exige a ligação confirmada por alguém
  // (a primeira vez) — depois o código do fornecedor já vem ligado sozinho
  const clear = top && top.score >= 0.95 && (!second || top.score - second.score >= 0.2);
  if (clear) options = [top, ...options.filter((o) => o.id !== top.id)];
  return { item_id: null, via: null, options };
}

export interface Learned {
  item_id: string;
  factor: number;
  validated: boolean;
}
/** equivalências do fornecedor: "código|unidade" → item interno e fator de conversão */
export async function learnedFor(cnpj: string | null): Promise<{ supplierId: string | null; map: Map<string, Learned> }> {
  if (!cnpj) return { supplierId: null, map: new Map() };
  const { data: s } = await db().from('suppliers').select('id').eq('cnpj', cnpj).maybeSingle();
  if (!s) return { supplierId: null, map: new Map() };
  let { data, error } = (await db().from('supplier_items').select('supplier_code, unit_key, item_id, factor, validated_at').eq('supplier_id', s.id)) as { data: Record<string, unknown>[] | null; error: unknown };
  if (error) ({ data } = (await db().from('supplier_items').select('supplier_code, item_id').eq('supplier_id', s.id)) as { data: Record<string, unknown>[] | null; error: unknown });
  const map = new Map<string, Learned>();
  for (const r of data ?? []) map.set(`${r.supplier_code}|${String(r.unit_key ?? '')}`, { item_id: String(r.item_id), factor: Number(r.factor ?? 1) || 1, validated: r.validated_at !== null });
  return { supplierId: s.id as string, map };
}

/** liga as linhas aos pedidos (veja lib/notas/vinculo.ts: pode dividir uma linha entre pedidos) */
export function matchOrder(lines: NoteLine[], pos: PurchaseOrder[], refs: number[] = [], tolerance = 0.01, reshape = false): NoteLine[] {
  if (!pos.length) return lines.map((l) => (l.po_key || l.po_id ? { ...l, po_id: null, po_key: null, po_why: null } : l));
  return allocate(lines, pos, refs, tolerance, reshape);
}

/**
 * Compara a nota com o(s) pedido(s) (fornecedor, itens, quantidade, preço, frete e pagamento)
 * e junta as diferenças da conferência física. O que já foi tratado continua tratado
 * (mesma divergência, mesmo valor encontrado). O pedido NUNCA é alterado para bater com a nota.
 */
export function computeDivergences(note: FiscalNote, orders: PurchaseOrder[] | PurchaseOrder | null, cfg: ComprasConfig, prev: Divergence[] = [], freightUsed = 0): Divergence[] {
  const pos = !orders ? [] : Array.isArray(orders) ? orders : [orders];
  const at = new Date().toISOString();
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const label = (po: PurchaseOrder) => `PC ${String(po.number).padStart(4, '0')}`;
  const many = pos.length > 1;
  const out: Divergence[] = [];
  const push = (kind: DivKind, line: number | null, text: string, expected: string | null, found: string | null, tag = '') => {
    const id = `${kind}-${line ?? 'n'}${tag}`;
    const old = prev.find((d) => d.id === id && d.found === found);
    out.push(old ?? { id, kind, line, text, expected, found, blocking: BLOCKING.includes(kind), status: 'aberta', created_at: at });
  };
  if (pos.length) {
    for (const po of pos) {
      if (po.cnpj && note.cnpj && po.cnpj !== note.cnpj) push('fornecedor', null, `A nota é de outro CNPJ (${note.supplier_name}); o ${label(po)} é de ${po.supplier_name}.`, po.cnpj, note.cnpj, many ? `-${po.number}` : '');
    }
    // o mesmo item do pedido pode estar em mais de uma linha da nota: soma tudo
    const billed = new Map<string, number>();
    note.items.forEach((l) => {
      if (l.po_id && l.po_key) billed.set(`${l.po_id}|${l.po_key}`, (billed.get(`${l.po_id}|${l.po_key}`) ?? 0) + l.qty * (l.factor || 1));
    });
    note.items.forEach((l, i) => {
      if (!l.item_id) return; // sem item do estoque: precisa ligar antes (não é divergência)
      const po = l.po_id ? pos.find((o) => o.id === l.po_id) : null;
      const pl = po && l.po_key ? po.items.find((x) => x.key === l.po_key) : null;
      if (!po || !pl) {
        push('item_fora', i, `${l.description} não está ${many ? 'em nenhum dos pedidos ligados' : 'no pedido de compra'}.`, null, l.description);
        return;
      }
      const factor = l.factor || 1;
      const unitNote = Math.round(((Number(l.unit_value) || (l.total && l.qty ? l.total / l.qty : 0)) / factor) * 10000) / 10000;
      if (unitNote > 0 && Math.abs(unitNote - pl.unit_price) > cfg.price_tolerance) {
        push('preco', i, `${l.description}: ${brl(unitNote)} por unidade na nota, ${brl(pl.unit_price)} no ${label(po)}.`, brl(pl.unit_price), brl(unitNote));
      }
      const invoiced = billed.get(`${po.id}|${pl.key}`) ?? l.qty * factor;
      const mine = note.items.reduce((t, x) => t + (x.po_id === po.id && x.po_key === pl.key ? x.received ?? 0 : 0), 0);
      const left = poLeft(pl) + mine;
      if (invoiced > left) push('quantidade_pedido', i, `${l.description}: faturado ${invoiced}, mas o ${label(po)} só tem ${left} a receber.`, String(left), String(invoiced));
    });
    const freight = Number(note.totals?.freight ?? 0);
    // o que sobra do frete do(s) pedido(s) depois das outras notas (não estornadas) deles
    const poFreight = Math.max(0, Math.round((pos.reduce((t, o) => t + (o.freight || 0), 0) - freightUsed) * 100) / 100);
    if (freight - poFreight > 0.009) push('frete', null, `Frete de ${brl(freight)} na nota; ${many ? 'os pedidos previam' : 'o pedido previa'} ${brl(poFreight)}.`, brl(poFreight), brl(freight));
    const terms = pos.filter((o) => o.payment?.mode).map((o) => (o.payment.mode === 'parcelado' ? o.payment.installments || 1 : 1));
    if (note.installments.length && terms.length) {
      const n = note.installments.length;
      if (!terms.includes(n)) {
        const want = terms[0];
        push('pagamento', null, `A nota tem ${n} parcela${n > 1 ? 's' : ''}; ${many ? 'os pedidos combinaram' : 'o pedido combinou'} ${want === 1 ? 'pagamento à vista/1 parcela' : `${want} parcelas`}.`, String(want), String(n));
      }
    }
  }
  note.items.forEach((l, i) => {
    if (l.delivered === null || l.delivered === undefined) return;
    const invoiced = l.qty * (l.factor || 1);
    if (l.delivered < invoiced) push('falta', i, `${l.description}: faturado ${invoiced}, chegaram ${l.delivered}. O que falta fica a receber.`, String(invoiced), String(l.delivered));
    if ((l.refused ?? 0) > 0) push('recusa', i, `${l.description}: ${l.refused} recusado(s) na conferência${l.inspection_note ? ` — ${l.inspection_note}` : ''}.`, '0', String(l.refused));
  });
  return out;
}

/** Fornecedor pelo CNPJ (cria na primeira nota). */
export async function ensureSupplier(name: string, cnpj: string | null): Promise<string | null> {
  if (cnpj) {
    const { data } = await db().from('suppliers').select('id').eq('cnpj', cnpj).maybeSingle();
    if (data) return data.id as string;
  }
  // mesmo nome (razão social ou fantasia) de um fornecedor já cadastrado em Compras: usa ele, sem duplicar
  const key = nameKey(name);
  if (key) {
    const { data: all } = await db().from('suppliers').select('id, name, trade_name, cnpj').limit(20000);
    const same = ((all ?? []) as { id: string; name: string; trade_name?: string | null; cnpj: string | null }[]).find(
      (x) => (nameKey(x.name) === key || (x.trade_name ? nameKey(x.trade_name) === key : false)) && (!cnpj || !x.cnpj || x.cnpj === cnpj),
    );
    if (same) {
      if (cnpj && !same.cnpj) await db().from('suppliers').update({ cnpj }).eq('id', same.id);
      return same.id;
    }
  }
  const { data, error } = await db().from('suppliers').insert({ name, cnpj }).select('id').single();
  if (error) {
    if (error.code === '23505' && cnpj) {
      const { data: again } = await db().from('suppliers').select('id').eq('cnpj', cnpj).maybeSingle();
      return (again?.id as string) ?? null;
    }
    throw error;
  }
  return data.id as string;
}
