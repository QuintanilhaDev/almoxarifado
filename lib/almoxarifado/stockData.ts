import 'server-only';
import { db } from '../supabaseAdmin';
import type { Posto, StockItem } from './types';
import { isMissingColumn } from '../auth';
import { sortCategories } from './categories';

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

const ITEM_COLS = 'id, ref, name, size, unit, quantity, min_quantity, cost, created_at, updated_at';
const P3_COLS = 'code, cat_code, grp_code, brand, ca_number, location, max_quantity, lead_days, safety_qty, reserved, active';
/**
 * Colunas em camadas: o site funciona mesmo antes de rodar categorias.sql e pedidos_e_notas.sql
 * (cada camada que falta é deixada de fora e tentada de novo depois de 1 minuto).
 */
const TIERS = [`${ITEM_COLS}, categories, ${P3_COLS}`, `${ITEM_COLS}, categories`, ITEM_COLS];
let tier = 0;
let tierCheckedAt = 0;
/** o banco já tem as colunas do Projeto 3? */
export const projeto3Ready = () => tier === 0;

export async function loadItems(): Promise<StockItem[]> {
  type Row = Partial<StockItem> & Omit<StockItem, 'at_postos' | 'categories' | 'reserved' | 'active'> & { categories?: string[] | null };
  let items: Row[] | null = null;
  const order = { column: 'name_key', tiebreak: 'id' };
  if (tier > 0 && Date.now() - tierCheckedAt > 60_000) tier = 0;
  while (items === null) {
    try {
      items = await fetchAll<Row>('stock_items', TIERS[tier], order);
    } catch (e) {
      if (!isMissingColumn(e) || tier === TIERS.length - 1) throw e;
      tier++;
      tierCheckedAt = Date.now();
    }
  }
  const lines = await fetchAll<{ item_id: string; quantity: number; posto_id: string }>(
    'posto_stock',
    'posto_id, item_id, quantity',
    { column: 'item_id', tiebreak: 'posto_id' },
  );
  const sum = new Map<string, number>();
  for (const l of lines) sum.set(l.item_id, (sum.get(l.item_id) ?? 0) + l.quantity);
  return items.map((i) => ({
    ...i,
    cost: i.cost === null ? null : Number(i.cost),
    categories: Array.isArray(i.categories) ? sortCategories(i.categories.filter((c) => typeof c === 'string' && c)) : [],
    at_postos: sum.get(i.id) ?? 0,
    code: i.code ?? null,
    cat_code: i.cat_code ?? null,
    grp_code: i.grp_code ?? null,
    brand: i.brand ?? null,
    ca_number: i.ca_number ?? null,
    location: i.location ?? null,
    max_quantity: i.max_quantity ?? null,
    lead_days: i.lead_days ?? null,
    safety_qty: i.safety_qty ?? null,
    reserved: i.reserved ?? 0,
    active: i.active ?? true,
  }));
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

/** Campos do cadastro mestre (Projeto 3). Devolve só o que veio no corpo, já validado. */
export function catalogFields(body: Record<string, unknown>): { patch: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};
  const text = (k: string, max: number) => {
    if (k in body) patch[k] = str(body[k], max);
  };
  text('brand', 80);
  text('ca_number', 20);
  text('location', 60);
  for (const [k, label, max] of [
    ['max_quantity', 'estoque máximo', 1_000_000],
    ['lead_days', 'prazo de reposição', 365],
    ['safety_qty', 'estoque de segurança', 1_000_000],
  ] as const) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v === '' || v === null || v === undefined) {
      patch[k] = null;
      continue;
    }
    const n = intOrNull(v, max);
    if (n === null) return { error: `O ${label} precisa ser um número inteiro entre 0 e ${max.toLocaleString('pt-BR')}.` };
    patch[k] = n;
  }
  if ('active' in body) patch.active = body.active !== false;
  if (typeof patch.max_quantity === 'number' && typeof body.min_quantity !== 'undefined') {
    const min = intOrNull(body.min_quantity);
    if (min !== null && patch.max_quantity < min) return { error: 'O estoque máximo não pode ser menor do que o mínimo.' };
  }
  return { patch };
}
export const P3_SQL_MSG = 'Os campos novos do catálogo ainda não foram ativados. Rode o arquivo supabase/pedidos_e_notas.sql no SQL Editor do Supabase.';
