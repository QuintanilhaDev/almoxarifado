import 'server-only';
import { categoryName } from './catalog';
import { fetchAll, loadItems } from './almoxarifado/stockData';
import { replenishment } from './almoxarifado/reposicao';
import { getConfig, toOrder } from './pedidos/server';
import { ORDER_COLS } from './pedidos/server';
import { ORIGIN_LABEL, isLate, orderLabel, todayBahia, type MaterialOrder } from './pedidos/types';

export interface Indicators {
  at: string;
  days: number;
  stock: { items: number; physical: number; reserved: number; available: number; value: number; noCost: number; below: number };
  byCategory: { cat: string; name: string; items: number; units: number; value: number }[];
  below: { id: string; code: string | null; name: string; size: string | null; quantity: number; reserved: number; min: number }[];
  purchases: { open: number; byStatus: Record<string, number>; late: number };
  orders: {
    open: number;
    partial: number;
    late: number;
    waitingPurchase: number;
    done: number;
    cancelled: number;
    avgDays: number | null;
    byOrigin: { origin: string; label: string; open: number; done: number }[];
    lateList: { id: string; number: string; origin: string; who: string; due: string | null }[];
  };
  consumption: { item_id: string; name: string; size: string | null; units: number; value: number; turnover: number | null }[];
  byCompany: { company: string; units: number; value: number }[];
  idle: { name: string; size: string | null; quantity: number; value: number | null }[];
  replenish: number;
  notes: { open: number; dueSoon: number; dueSoonValue: number; overdue: number; overdueValue: number };
}

/** soma dias a uma data AAAA-MM-DD (meio-dia UTC, sem escorregar de dia) */
function addDays(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Indicadores para a Gestão (Projeto 3, seção 10): tudo calculado na hora, nada digitado à mão. */
export async function indicators(days: number): Promise<Indicators> {
  const cfg = await getConfig();
  const items = await loadItems();
  const active = items.filter((i) => i.active !== false);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const today = todayBahia();

  // ---- estoque ----
  const stock = { items: active.length, physical: 0, reserved: 0, available: 0, value: 0, noCost: 0, below: 0 };
  const cats = new Map<string, { cat: string; name: string; items: number; units: number; value: number }>();
  const below: Indicators['below'] = [];
  for (const i of active) {
    stock.physical += i.quantity;
    stock.reserved += i.reserved;
    stock.available += i.quantity - i.reserved;
    if (i.cost === null) stock.noCost++;
    const v = (i.cost ?? 0) * i.quantity;
    stock.value += v;
    const key = i.cat_code ?? '—';
    const c = cats.get(key) ?? { cat: key, name: categoryName(i.cat_code) ?? (i.categories[0] ? `${i.categories[0]} (sem código)` : 'Sem classificação'), items: 0, units: 0, value: 0 };
    c.items++;
    c.units += i.quantity;
    c.value += v;
    cats.set(key, c);
    if (i.min_quantity > 0 && i.quantity - i.reserved <= i.min_quantity) {
      stock.below++;
      below.push({ id: i.id, code: i.code, name: i.name, size: i.size, quantity: i.quantity, reserved: i.reserved, min: i.min_quantity });
    }
  }

  // ---- compras ----
  // paginado (o Supabase devolve no máximo 1000 linhas por consulta) e com erro conferido
  const ps = await fetchAll<{ status: string; needed_by: string | null; expected_date: string | null }>('purchase_requests', 'id, status, needed_by, expected_date', { column: 'id' });
  const byStatus: Record<string, number> = {};
  let pOpen = 0;
  let pLate = 0;
  for (const p of ps) {
    byStatus[p.status as string] = (byStatus[p.status as string] ?? 0) + 1;
    if (['nova', 'em_cotacao', 'comprada'].includes(p.status as string)) {
      pOpen++;
      const due = (p.expected_date as string | null) ?? (p.needed_by as string | null);
      if (due && due < today) pLate++;
    }
  }

  // ---- pedidos ----
  const orders = (await fetchAll<Record<string, unknown>>('material_orders', ORDER_COLS, { column: 'created_at', ascending: false, tiebreak: 'id' })).map(toOrder);
  const openOrders = orders.filter((o) => o.stage !== 'concluido' && o.stage !== 'cancelado');
  const inPeriod = (o: MaterialOrder) => (o.closed_at ?? o.created_at) >= since;
  const done = orders.filter((o) => o.stage === 'concluido' && inPeriod(o));
  const durations = done.map((o) => (Date.parse(o.closed_at!) - Date.parse(o.created_at)) / 86_400_000);
  const byOrigin = new Map<string, { origin: string; label: string; open: number; done: number }>();
  for (const o of orders) {
    const r = byOrigin.get(o.origin) ?? { origin: o.origin, label: ORIGIN_LABEL[o.origin], open: 0, done: 0 };
    if (o.stage !== 'concluido' && o.stage !== 'cancelado') r.open++;
    else if (o.stage === 'concluido' && inPeriod(o)) r.done++;
    byOrigin.set(o.origin, r);
  }
  const late = openOrders.filter(isLate);

  // ---- consumo (entregas + saídas) e por empresa ----
  const moves = await fetchAll<{ item_id: string | null; kind: string; quantity: number; order_id: string | null }>(
    'stock_movements',
    'item_id, kind, quantity, order_id',
    { column: 'created_at', tiebreak: 'id' },
    (q) => q.gte('created_at', since).in('kind', ['saida', 'transferencia', 'entrega', 'perda']),
  );
  const byId = new Map(items.map((i) => [i.id, i]));
  const orderCompany = new Map(orders.map((o) => [o.id, o.company ?? null]));
  const cons = new Map<string, number>();
  const comp = new Map<string, { company: string; units: number; value: number }>();
  for (const m of moves) {
    if (!m.item_id) continue;
    cons.set(m.item_id, (cons.get(m.item_id) ?? 0) + m.quantity);
    if (m.kind === 'entrega') {
      const company = (m.order_id ? orderCompany.get(m.order_id) : null) || 'Sem empresa informada';
      const c = comp.get(company) ?? { company, units: 0, value: 0 };
      c.units += m.quantity;
      c.value += (byId.get(m.item_id)?.cost ?? 0) * m.quantity;
      comp.set(company, c);
    }
  }
  const consumption = [...cons.entries()]
    .map(([id, units]) => {
      const i = byId.get(id);
      return { item_id: id, name: i?.name ?? '—', size: i?.size ?? null, units, value: (i?.cost ?? 0) * units, turnover: i && i.quantity > 0 ? Math.round((units / i.quantity) * 10) / 10 : null };
    })
    .sort((a, b) => b.units - a.units)
    .slice(0, 30);

  // ---- reposição e sem movimentação ----
  const rep = await replenishment({ days: Math.max(days, 30), defaultLead: cfg.defaultLeadDays, items });

  // ---- notas e vencimentos ----
  // Não há controle de pagamento: "overdue" = parcelas que venceram nos últimos 30 dias
  // (janela fixa, para o número não só crescer). Datas no dia da Bahia.
  const notes = { open: 0, dueSoon: 0, dueSoonValue: 0, overdue: 0, overdueValue: 0 };
  const ns = await fetchAll<{ status: string; installments: { due: string | null; value: number }[] | null }>(
    'fiscal_notes',
    'id, status, installments',
    { column: 'id' },
    (q) => q.neq('status', 'estornada'),
  );
  const soon = addDays(today, 30);
  const recent = addDays(today, -30);
  for (const n of ns) {
    if (n.status === 'aberta' || n.status === 'parcial') notes.open++;
    for (const p of Array.isArray(n.installments) ? n.installments : []) {
      if (!p?.due) continue;
      if (p.due < today) {
        if (p.due < recent) continue;
        notes.overdue++;
        notes.overdueValue += Number(p.value) || 0;
      } else if (p.due <= soon) {
        notes.dueSoon++;
        notes.dueSoonValue += Number(p.value) || 0;
      }
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    at: new Date().toISOString(),
    days,
    stock: { ...stock, value: round(stock.value) },
    byCategory: [...cats.values()].map((c) => ({ ...c, value: round(c.value) })).sort((a, b) => a.cat.localeCompare(b.cat)),
    below: below.sort((a, b) => a.quantity - a.min - (b.quantity - b.min)),
    purchases: { open: pOpen, byStatus, late: pLate },
    orders: {
      open: openOrders.length,
      partial: openOrders.filter((o) => o.items.some((l) => l.delivered > 0)).length,
      late: late.length,
      waitingPurchase: openOrders.filter((o) => o.items.some((l) => l.purchase_id && l.delivered < l.qty)).length,
      done: done.length,
      cancelled: orders.filter((o) => o.stage === 'cancelado' && inPeriod(o)).length,
      avgDays: durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null,
      byOrigin: [...byOrigin.values()],
      lateList: late.slice(0, 20).map((o) => ({ id: o.id, number: orderLabel(o.number), origin: ORIGIN_LABEL[o.origin], who: o.collaborator_name ?? o.posto_name ?? o.requester, due: o.needed_by ?? o.start_date })),
    },
    consumption,
    byCompany: [...comp.values()].map((c) => ({ ...c, value: round(c.value) })).sort((a, b) => b.value - a.value),
    idle: rep.idle.slice(0, 30).map((i) => ({ name: i.name, size: i.size, quantity: i.quantity, value: i.value === null ? null : round(i.value) })),
    replenish: rep.rows.length,
    notes: { ...notes, dueSoonValue: round(notes.dueSoonValue), overdueValue: round(notes.overdueValue) },
  };
}
