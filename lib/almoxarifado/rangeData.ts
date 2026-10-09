import 'server-only';
import { db } from '../supabaseAdmin';
import { IN_KINDS, OUT_KINDS } from './metrics';
import type { RangeData } from './range';

const PAGE = 1000;
const MAX_ROWS = 50_000;
export const MAX_SPAN_MS = 400 * 86_400_000;

async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
  const { data, error } = await build(from, from + PAGE - 1);
  if (error) throw error;
  const part = (data ?? []) as T[];
  rows.push(...part);
  if (part.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/** Entradas, saídas e solicitações entre dois instantes. Entradas = entrada + devolução · Saídas = saída + envio a posto. */
export async function loadRange(fromMs: number, toMs: number): Promise<RangeData> {
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();
  const sb = db();
  const [mv, rq] = await Promise.all([
  readAll<{ kind: string; quantity: number; item_name: string; posto_name: string | null }>((a, b) =>
    sb
      .from('stock_movements')
      .select('id, created_at, kind, quantity, item_name, posto_name')
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b),
  ),
  readAll<{ status: string }>((a, b) =>
    sb
      .from('requests')
      .select('id, created_at, status')
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b),
  ),
  ]);

  const totals: RangeData['totals'] = { in: 0, out: 0, inMoves: 0, outMoves: 0, itemsIn: 0, itemsOut: 0, toPostos: 0, returned: 0, consumed: 0, adjustments: 0 };
  const items = new Map<string, { name: string; in: number; out: number }>();
  const postos = new Map<string, { name: string; received: number }>();
  for (const m of mv.rows) {
  const q = Number(m.quantity) || 0;
  const isIn = IN_KINDS.includes(m.kind);
  const isOut = OUT_KINDS.includes(m.kind);
  if (m.kind === 'baixa_posto') totals.consumed += q;
  if (m.kind === 'ajuste') totals.adjustments++;
  if (!isIn && !isOut) continue;
  const it = items.get(m.item_name) ?? { name: m.item_name, in: 0, out: 0 };
  if (isIn) {
    totals.in += q;
    totals.inMoves++;
    it.in += q;
    if (m.kind === 'devolucao') totals.returned += q;
  } else {
    totals.out += q;
    totals.outMoves++;
    it.out += q;
    if (m.kind === 'transferencia') {
      totals.toPostos += q;
      const name = m.posto_name || 'Posto removido';
      const p = postos.get(name) ?? { name, received: 0 };
      p.received += q;
      postos.set(name, p);
    }
  }
  items.set(m.item_name, it);
  }
  for (const it of items.values()) {
  if (it.in > 0) totals.itemsIn++;
  if (it.out > 0) totals.itemsOut++;
  }
  const requests = { total: rq.rows.length, nova: 0, pendente: 0, resolvida: 0 };
  for (const r of rq.rows) {
  if (r.status === 'nova') requests.nova++;
  else if (r.status === 'pendente') requests.pendente++;
  else if (r.status === 'resolvida') requests.resolvida++;
  }
  const data: RangeData = {
  from: fromIso,
  to: toIso,
  totals,
  items: [...items.values()].sort((a, b) => b.out + b.in - (a.out + a.in) || a.name.localeCompare(b.name, 'pt-BR')).slice(0, 500),
  postos: [...postos.values()].sort((a, b) => b.received - a.received).slice(0, 50),
  requests,
  truncated: mv.truncated || rq.truncated,
  };
  return data;
}
