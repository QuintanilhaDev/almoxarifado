import 'server-only';
import { db } from './supabaseAdmin';
import type { Posto, StockItem } from './types';

const PAGE = 1000; // o Supabase devolve no máximo 1000 linhas por consulta

/** Lê TODAS as linhas de uma tabela, página por página (ordem estável). */
export async function fetchAll<T>(
  table: string,
  select: string,
  order: { column: string; ascending?: boolean; tiebreak?: string },
  apply?: (q: any) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db().from(table).select(select);
    if (apply) q = apply(q);
    q = q.order(order.column, { ascending: order.ascending ?? true });
    if (order.tiebreak) q = q.order(order.tiebreak);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function loadItems(): Promise<StockItem[]> {
  const items = await fetchAll<Omit<StockItem, 'at_postos'>>(
    'stock_items',
    'id, ref, name, size, unit, quantity, min_quantity, cost, created_at, updated_at',
    { column: 'name_key', tiebreak: 'id' },
  );
  const lines = await fetchAll<{ item_id: string; quantity: number; posto_id: string }>(
    'posto_stock',
    'posto_id, item_id, quantity',
    { column: 'item_id', tiebreak: 'posto_id' },
  );
  const sum = new Map<string, number>();
  for (const l of lines) sum.set(l.item_id, (sum.get(l.item_id) ?? 0) + l.quantity);
  return items.map((i) => ({ ...i, cost: i.cost === null ? null : Number(i.cost), at_postos: sum.get(i.id) ?? 0 }));
}

export async function loadPostos(): Promise<Posto[]> {
  const postos = await fetchAll<Omit<Posto, 'items_count' | 'units'>>(
    'postos',
    'id, name, code, city, address, supervisor, notes, created_by, created_at',
    { column: 'name_key', tiebreak: 'id' },
  );
  const lines = await fetchAll<{ posto_id: string; quantity: number }>('posto_stock', 'posto_id, item_id, quantity', {
    column: 'posto_id',
    tiebreak: 'item_id',
  });
  const agg = new Map<string, { n: number; u: number }>();
  for (const l of lines) {
    const a = agg.get(l.posto_id) ?? { n: 0, u: 0 };
    a.n += 1;
    a.u += l.quantity;
    agg.set(l.posto_id, a);
  }
  return postos.map((p) => ({ ...p, items_count: agg.get(p.id)?.n ?? 0, units: agg.get(p.id)?.u ?? 0 }));
}

/* ---------- validação ---------- */

export function str(v: unknown, max: number): string | null {
  const s = String(v ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return s || null;
}

/** Inteiro >= 0 (aceita número ou texto). Devolve null se inválido. */
export function intOrNull(v: unknown, max = 1_000_000): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return Math.round(n);
}

export function moneyOrNull(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 99_999_999) return null;
  return Math.round(n * 100) / 100;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mensagem das funções do banco ("raise exception") ou null se for outro tipo de erro. */
export function dbMessage(e: unknown): string | null {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code === 'P0001' && err.message) return err.message;
  if (err?.code === '23505') return 'Já existe um cadastro com esse nome.';
  return null;
}
