import 'server-only';
import { db } from '../supabaseAdmin';
import { fail } from '../http';
import { hasLevel, type HubUser } from '../permissions';
import { notesAccess, financeNotes } from '../pedidos/access';
import { almoxView, comprasEdit, comprasView } from './access';
import { DEFAULT_CONFIG, parseBRL, type Attachment, type ComprasConfig, type PurchaseOrder, type Quote } from './pc';

type U = HubUser | null | undefined;

/** quem aprova pedidos de compra e autoriza exceções: master geral ou "Aprovação de compras" */
export const canApprove = (u: U) => Boolean(u?.is_master) || hasLevel(u, 'compras', 'aprovacao', 'edit');
/** quem trata divergência comercial da nota: Compras (edição) ou quem aprova */
export const canTreat = (u: U) => comprasEdit(u) || canApprove(u);
/** quem enxerga pedidos de compra: Compras, quem aprova, Almoxarifado (compras ou notas) e Financeiro */
export const canSeeOrders = (u: U) => comprasView(u) || canApprove(u) || almoxView(u) || notesAccess(u) || financeNotes(u);

/** falta rodar o supabase/compras_pedidos.sql? */
export function missingPC(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return ['42P01', 'PGRST205', '42703', 'PGRST204', 'PGRST202'].includes(err?.code ?? '') || /purchase_quotes|purchase_orders|supplier_products|does not exist|could not find/i.test(err?.message ?? '');
}
export const PC_SETUP = 'Cotações e pedidos de compra ainda não foram ativados no banco. Rode o arquivo supabase/compras_pedidos.sql no SQL Editor do Supabase.';
export const pcFail = () => fail(PC_SETUP, 409, { setup: true });

/** mensagem de regra do banco (raise exception) */
export function dbRuleMsg(e: unknown): string | null {
  const err = e as { code?: string; message?: string } | null;
  return err?.code === 'P0001' && err.message ? err.message : null;
}

export function toQuote(r: Record<string, unknown>): Quote {
  return {
    ...(r as unknown as Quote),
    number: Number(r.number),
    items: Array.isArray(r.items) ? (r.items as Quote['items']) : [],
    proposals: Array.isArray(r.proposals) ? (r.proposals as Quote['proposals']) : [],
    request_ids: Array.isArray(r.request_ids) ? (r.request_ids as string[]) : [],
    history: Array.isArray(r.history) ? (r.history as Quote['history']) : [],
  };
}
export function toPO(r: Record<string, unknown>): PurchaseOrder {
  const n = (v: unknown) => Number(v ?? 0) || 0;
  return {
    ...(r as unknown as PurchaseOrder),
    number: Number(r.number),
    items: Array.isArray(r.items) ? (r.items as PurchaseOrder['items']).map((i) => ({ ...i, qty: n(i.qty), unit_price: n(i.unit_price), received: n(i.received) })) : [],
    request_ids: Array.isArray(r.request_ids) ? (r.request_ids as string[]) : [],
    attachments: Array.isArray(r.attachments) ? (r.attachments as PurchaseOrder['attachments']) : [],
    history: Array.isArray(r.history) ? (r.history as PurchaseOrder['history']) : [],
    payment: (r.payment as PurchaseOrder['payment']) ?? { mode: 'avista', installments: 1, days: null, note: null },
    delivery: (r.delivery as PurchaseOrder['delivery']) ?? { days: null, business: true, mode: 'pronta', date: null, location: null },
    freight: n(r.freight),
    other_costs: n(r.other_costs),
    discount: n(r.discount),
    total: n(r.total),
  };
}

const CONFIG_KEY = 'compras_config';
export async function loadConfig(): Promise<ComprasConfig> {
  const { data } = await db().from('hub_meta').select('value').eq('key', CONFIG_KEY).maybeSingle();
  const v = (data?.value ?? {}) as Partial<ComprasConfig>;
  return { ...DEFAULT_CONFIG, ...v, company: { ...DEFAULT_CONFIG.company, ...(v.company ?? {}) } };
}
export async function saveConfig(c: ComprasConfig) {
  const { error } = await db().from('hub_meta').upsert({ key: CONFIG_KEY, value: c }, { onConflict: 'key' });
  if (error) throw error;
}

export const nowIso = () => new Date().toISOString();
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** "AAAA-MM-DD" que existe de verdade (31/02 não passa: a data tem de voltar igual) */
export const dateOrNull = (v: unknown) => {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null;
  const t = Date.parse(`${v}T12:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v ? v : null;
};
export const money = (v: unknown, max = 1e9): number | null => {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return null;
  const n = typeof v === 'number' ? v : parseBRL(String(v));
  return Number.isFinite(n) && n >= 0 && n < max ? Math.round(n * 10000) / 10000 : null;
};
export const intOr = (v: unknown, d: number | null = null) => {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return d;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isInteger(n) ? n : d;
};

/** anexos guardados pelo /api/anexos (só caminhos de compras/) */
export function cleanAttachments(v: unknown): Attachment[] {
  return (Array.isArray(v) ? v : [])
    .filter((a): a is Attachment => Boolean(a && typeof a === 'object' && typeof (a as Attachment).path === 'string' && /^compras\/[\w/.-]+$/.test((a as Attachment).path)))
    .slice(0, 12)
    .map((a) => ({ path: a.path, name: String(a.name ?? 'arquivo').slice(0, 120), size: Number(a.size) || 0, type: String(a.type ?? '').slice(0, 80), at: a.at, by: a.by }));
}
