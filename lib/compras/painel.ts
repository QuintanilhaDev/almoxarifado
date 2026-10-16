import 'server-only';
import { db } from '../supabaseAdmin';
import { toRequest } from './server';
import { toPO, toQuote } from './pcServer';
import { PO_OPEN, poDue, poLate, poLeft, proposalExpired, type PurchaseOrder } from './pc';
import { daysBetween, todayBahia } from './prazo';
import type { Divergence } from '../notas/conferencia';

/** a nota atende este pedido? (uma nota pode atender vários) */
const noteHas = (n: { purchase_order_id: string | null; purchase_order_ids?: string[] | null }, id: string) => n.purchase_order_id === id || (n.purchase_order_ids ?? []).includes(id);
type NoteRow = { id: string; supplier_id: string | null; purchase_order_id: string | null; purchase_order_ids?: string[] | null; received_date: string | null; posted_at: string | null; status: string; divergences: unknown; number: string; supplier_name: string; totals: { total?: number } | null; created_at: string };

async function allPOs(): Promise<PurchaseOrder[]> {
  const { data, error } = await db().from('purchase_orders').select('*').order('created_at', { ascending: false }).limit(3000);
  if (error) throw error;
  return (data ?? []).map((r) => toPO(r as Record<string, unknown>));
}

/**
 * "Em compra / a receber" por item: soma do que falta receber nos pedidos vigentes
 * (aprovado, enviado, confirmado, entrega parcial). NÃO compõe o saldo físico.
 */
export async function onOrderByItem(pos?: PurchaseOrder[]) {
  const list = pos ?? (await allPOs());
  const today = todayBahia();
  const map: Record<string, { qty: number; next: string | null; late: boolean; orders: { id: string; number: number; left: number; due: string | null; late: boolean; supplier: string }[] }> = {};
  for (const o of list.filter((x) => PO_OPEN.includes(x.status))) {
    const due = poDue(o);
    const late = poLate(o, today);
    for (const i of o.items) {
      const left = poLeft(i);
      if (!i.item_id || left <= 0) continue;
      const m = (map[i.item_id] ??= { qty: 0, next: null, late: false, orders: [] });
      m.qty += left;
      if (due && (!m.next || due < m.next)) m.next = due;
      m.late = m.late || late;
      m.orders.push({ id: o.id, number: o.number, left, due, late, supplier: o.supplier_name });
    }
  }
  return map;
}

/** Desempenho dos fornecedores: pontualidade, atraso médio (dias úteis) e divergências nas notas. */
export async function supplierPerformance(only?: string[], pos?: PurchaseOrder[], notes?: NoteRow[]) {
  const list = (pos ?? (await allPOs())).filter((o) => o.supplier_id && (!only || only.includes(o.supplier_id)));
  const ns = notes ?? (((await db().from('fiscal_notes').select('id, supplier_id, purchase_order_id, purchase_order_ids, received_date, posted_at, status, divergences, number, supplier_name, totals, created_at').neq('status', 'estornada').limit(20000)).data ?? []) as NoteRow[]);
  const today = todayBahia();
  const out: Record<string, { name: string; orders: number; delivered: number; on_time: number; late_open: number; avg_delay: number | null; divergences: number; spent: number; on_time_pct: number | null }> = {};
  for (const o of list) {
    const k = o.supplier_id!;
    const s = (out[k] ??= { name: o.supplier_name, orders: 0, delivered: 0, on_time: 0, late_open: 0, avg_delay: null, divergences: 0, spent: 0, on_time_pct: null });
    if (o.status === 'rascunho' || o.status === 'aguardando_aprovacao' || o.status === 'cancelado') continue;
    s.orders++;
    s.spent += o.total;
    const due = poDue(o);
    const got = ns.filter((n) => noteHas(n, o.id) && n.received_date).map((n) => n.received_date!).sort();
    if (o.status === 'concluido' && got.length && due) {
      s.delivered++;
      const delay = daysBetween(due, got[got.length - 1], true);
      if (delay <= 0) s.on_time++;
      s.avg_delay = ((s.avg_delay ?? 0) * (s.delivered - 1) + Math.max(0, delay)) / s.delivered;
    } else if (poLate(o, today)) s.late_open++;
  }
  for (const n of ns) {
    if (!n.supplier_id || !out[n.supplier_id]) continue;
    out[n.supplier_id].divergences += Array.isArray(n.divergences) ? n.divergences.length : 0;
  }
  for (const s of Object.values(out)) {
    s.on_time_pct = s.delivered ? Math.round((s.on_time / s.delivered) * 100) : null;
    s.avg_delay = s.avg_delay === null ? null : Math.round(s.avg_delay * 10) / 10;
    s.spent = Math.round(s.spent * 100) / 100;
  }
  return out;
}

/** Tudo o que o painel de Compras e a Gestão mostram, calculado na hora. */
export async function comprasPainel(opts: { days?: number } = {}) {
  const today = todayBahia();
  const since = new Date(Date.now() - (opts.days ?? 365) * 86_400_000).toISOString();
  const [pos, { data: qs }, { data: rs }, { data: items }, { data: ns }] = await Promise.all([
    allPOs(),
    db().from('purchase_quotes').select('*').order('created_at', { ascending: false }).limit(500),
    db().from('purchase_requests').select('*').order('created_at', { ascending: false }).limit(1000),
    db().from('stock_items').select('id, name, size, quantity, reserved, min_quantity, categories, active').limit(20000),
    db().from('fiscal_notes').select('id, supplier_id, purchase_order_id, purchase_order_ids, received_date, posted_at, status, divergences, number, supplier_name, totals, created_at').neq('status', 'estornada').limit(20000),
  ]);
  const quotes = (qs ?? []).map((r) => toQuote(r as Record<string, unknown>));
  const requests = (rs ?? []).map((r) => toRequest(r as Record<string, unknown>));
  const notes = (ns ?? []) as NoteRow[];

  const openQuotes = quotes.filter((q) => q.status === 'aberta');
  const expired = openQuotes.flatMap((q) => q.proposals.filter((p) => proposalExpired(p, today)).map((p) => ({ quote_id: q.id, quote: q.number, supplier: p.supplier_name, valid_until: p.valid_until })));
  const live = pos.filter((o) => PO_OPEN.includes(o.status));
  const byStatus: Record<string, number> = {};
  for (const o of pos) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;

  const late = live
    .filter((o) => poLate(o, today))
    .map((o) => ({ id: o.id, number: o.number, supplier: o.supplier_name, due: poDue(o), days: daysBetween(poDue(o)!, today, true), left: o.items.reduce((t, i) => t + poLeft(i), 0) }))
    .sort((a, b) => b.days - a.days);
  const soon = new Date(Date.now() - 3 * 3_600_000 + 14 * 86_400_000).toISOString().slice(0, 10);
  const arriving = live
    .filter((o) => {
      const d = poDue(o);
      return d && d >= today && d <= soon;
    })
    .map((o) => ({ id: o.id, number: o.number, supplier: o.supplier_name, due: poDue(o), left: o.items.reduce((t, i) => t + poLeft(i), 0), status: o.status }))
    .sort((a, b) => String(a.due).localeCompare(String(b.due)));

  // gestão: valor comprado (pedidos aprovados em diante) por mês, fornecedor e categoria
  const bought = pos.filter((o) => !['rascunho', 'aguardando_aprovacao', 'cancelado'].includes(o.status) && (o.approval?.at ?? o.created_at) >= since);
  const cat = new Map<string, string>();
  for (const it of items ?? []) cat.set(String(it.id), (Array.isArray(it.categories) && it.categories[0]) || 'Sem categoria');
  const byMonth: Record<string, number> = {};
  const bySupplier: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let negotiated = 0;
  for (const o of bought) {
    const m = (o.approval?.at ?? o.created_at).slice(0, 7);
    byMonth[m] = (byMonth[m] ?? 0) + o.total;
    bySupplier[o.supplier_name] = (bySupplier[o.supplier_name] ?? 0) + o.total;
    for (const i of o.items) {
      const c = i.item_id ? cat.get(i.item_id) ?? 'Sem categoria' : 'Fora do estoque';
      byCategory[c] = (byCategory[c] ?? 0) + i.qty * i.unit_price;
      if (i.first_price && i.first_price > i.unit_price) negotiated += (i.first_price - i.unit_price) * i.qty;
    }
  }
  // economia sobre a média das outras propostas válidas do mesmo item, nas cotações decididas
  let vsAvg = 0;
  for (const q of quotes.filter((x) => x.status === 'decidida' && x.decision && x.created_at >= since)) {
    for (const [key, pid] of Object.entries(q.decision!.lines)) {
      const it = q.items.find((i) => i.key === key);
      const chosen = q.proposals.find((p) => p.id === pid)?.lines.find((l) => l.key === key)?.unit_price;
      const others = q.proposals.filter((p) => p.id !== pid && p.status === 'recebida').map((p) => p.lines.find((l) => l.key === key)?.unit_price).filter((x): x is number => typeof x === 'number');
      if (it && chosen && others.length) vsAvg += (others.reduce((a, b) => a + b, 0) / others.length - chosen) * it.qty;
    }
  }
  const onOrder = await onOrderByItem(pos);
  const critical = (items ?? [])
    .filter((i) => i.active !== false && Number(i.min_quantity) > 0 && Number(i.quantity) - Number(i.reserved ?? 0) <= Number(i.min_quantity))
    .map((i) => {
      const oo = onOrder[String(i.id)];
      return { item_id: i.id, name: `${i.name}${i.size ? ' · ' + i.size : ''}`, available: Number(i.quantity) - Number(i.reserved ?? 0), min: Number(i.min_quantity), on_order: oo?.qty ?? 0, next: oo?.next ?? null, late: oo?.late ?? false };
    })
    .filter((i) => i.on_order === 0 || i.late || i.available + i.on_order <= i.min)
    .sort((a, b) => a.available - a.min - (b.available - b.min))
    .slice(0, 40);

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const top = (o: Record<string, number>, n = 12) => Object.entries(o).map(([name, total]) => ({ name, total: r2(total) })).sort((a, b) => b.total - a.total).slice(0, n);
  const perf = await supplierPerformance(undefined, pos, notes);
  return {
    at: new Date().toISOString(),
    counts: {
      requests_new: requests.filter((r) => r.status === 'nova').length,
      requests_quoting: requests.filter((r) => r.status === 'em_cotacao').length,
      quotes_open: openQuotes.length,
      proposals_waiting: openQuotes.reduce((t, q) => t + q.proposals.filter((p) => p.status === 'aguardando').length, 0),
      proposals_expired: expired.length,
      po_draft: byStatus.rascunho ?? 0,
      po_awaiting: byStatus.aguardando_aprovacao ?? 0,
      po_open: live.length,
      po_late: late.length,
      notes_divergent: notes.filter((n) => Array.isArray(n.divergences) && (n.divergences as { status?: string }[]).some((d) => d.status !== 'resolvida')).length,
    },
    queue: requests.filter((r) => r.status === 'nova' || r.status === 'em_cotacao').slice(0, 12).map((r) => ({ id: r.id, number: r.number, status: r.status, priority: r.priority, items: r.items.length, by: r.requested_by, at: r.created_at, needed_by: r.needed_by })),
    quotes: openQuotes.slice(0, 12).map((q) => ({ id: q.id, number: q.number, items: q.items.length, received: q.proposals.filter((p) => p.status === 'recebida').length, total: q.proposals.length, reply_by: q.reply_by })),
    expired,
    divergent: notes
      .filter((n) => Array.isArray(n.divergences) && (n.divergences as { status?: string }[]).some((d) => d.status !== 'resolvida'))
      .map((n) => {
        const po = pos.find((o) => o.id === n.purchase_order_id) ?? pos.find((o) => noteHas(n, o.id));
        const all = pos.filter((o) => noteHas(n, o.id)).map((o) => o.number);
        return { id: n.id, number: n.number, supplier: n.supplier_name, order: po ? po.number : null, orders: all, divergences: (n.divergences as Divergence[]).filter((d) => d.status !== 'resolvida') };
      })
      .slice(0, 30),
    awaiting: pos.filter((o) => o.status === 'aguardando_aprovacao').map((o) => ({ id: o.id, number: o.number, supplier: o.supplier_name, total: o.total, by: o.created_by })),
    late,
    arriving,
    by_status: byStatus,
    suppliers: Object.entries(perf).map(([id, p]) => ({ id, ...p })).sort((a, b) => b.spent - a.spent).slice(0, 20),
    gestao: {
      by_month: Object.entries(byMonth).sort().map(([month, total]) => ({ month, total: r2(total) })),
      by_supplier: top(bySupplier),
      by_category: top(byCategory),
      bought: r2(bought.reduce((t, o) => t + o.total, 0)),
      savings: {
        negotiated: r2(negotiated),
        vs_average: r2(vsAvg),
        criterion: 'Negociada: (primeiro preço oferecido − preço final do pedido) × quantidade. Sobre a média: (média das outras propostas válidas − preço escolhido) × quantidade, nas cotações decididas.',
      },
      critical,
    },
  };
}
