import 'server-only';
import { db } from './supabaseAdmin';
import { buildWindow, computeMetrics, type MetricsData, type MoveInput, type Period, type ReqInput, type StockSnapshot } from './metrics';

const PAGE = 1000;
export const MAX_MOVES = 50_000;
export const MAX_REQS = 20_000;

/** Lê todas as páginas (o Supabase devolve no máximo 1000 linhas por consulta). */
async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>, max: number) {
  const rows: T[] = [];
  let truncated = false;
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const part = (data ?? []) as T[];
    rows.push(...part);
    if (part.length < PAGE) return { rows, truncated };
  }
  truncated = true;
  return { rows, truncated };
}

/** "agora" aceito do cliente: só passado recente (a tela pede os dados exatamente do instante que está mostrando). */
export function parseAt(raw: string | null, now = Date.now()): number {
  const t = raw ? Date.parse(raw) : NaN;
  if (!Number.isFinite(t)) return now;
  if (t > now + 60_000) return now;
  if (t < now - 40 * 86_400_000) return now;
  return Math.min(t, now);
}

export interface Loaded {
  data: MetricsData;
  moves: MoveInput[];
  reqs: ReqInput[];
  truncated: boolean;
}

export async function loadMetrics(period: Period, at: number): Promise<Loaded> {
  const win = buildWindow(period, at);
  const fromIso = new Date(win.startMs).toISOString();
  const toIso = new Date(at).toISOString();
  const sb = db();

  const [mv, rq, st] = await Promise.all([
    readAll<MoveInput & { id: string }>(
      (a, b) =>
        sb
          .from('stock_movements')
          .select('id, created_at, kind, quantity, item_id, item_name, posto_name, before_qty, after_qty, note, by_name')
          .gte('created_at', fromIso)
          .lte('created_at', toIso)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(a, b),
      MAX_MOVES,
    ),
    readAll<ReqInput & { id: string }>(
      (a, b) =>
        sb
          .from('requests')
          .select('id, created_at, status, protocol, collaborator, posto, handled_by')
          .gte('created_at', fromIso)
          .lte('created_at', toIso)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(a, b),
      MAX_REQS,
    ),
    readAll<{ id: string; quantity: number; min_quantity: number }>(
      (a, b) => sb.from('stock_items').select('id, quantity, min_quantity').order('id', { ascending: true }).range(a, b),
      20_000,
    ),
  ]);

  const stock: StockSnapshot = { items: st.rows.length, units: 0, low: 0, zero: 0, qtyById: {} };
  for (const i of st.rows) {
    const q = Number(i.quantity) || 0;
    stock.units += q;
    if (q === 0) stock.zero++;
    if (Number(i.min_quantity) > 0 && q <= Number(i.min_quantity)) stock.low++;
    stock.qtyById![i.id] = q;
  }
  const truncated = mv.truncated || rq.truncated;
  const data = computeMetrics(mv.rows, rq.rows, period, at, stock, { truncated });
  return { data, moves: mv.rows, reqs: rq.rows, truncated };
}
