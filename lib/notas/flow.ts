import 'server-only';
import { db } from '../supabaseAdmin';
import { loadConfig, toPO } from '../compras/pcServer';
import { PO_OPEN, type PurchaseOrder } from '../compras/pc';
import { computeDivergences, matchOrder, noteCols, noteOrderIds, toNote, type FiscalNote } from './server';
import { usedOrders } from './vinculo';
import { openAny, openBlocking } from './conferencia';

export async function loadNote(id: string): Promise<FiscalNote | null> {
  const { data, error } = await db().from('fiscal_notes').select(await noteCols()).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toNote(data as unknown as Record<string, unknown>) : null;
}

/** o pedido principal da nota (o primeiro) */
export async function orderOf(note: Pick<FiscalNote, 'purchase_order_id' | 'purchase_order_ids'>): Promise<PurchaseOrder | null> {
  return (await ordersOf(note))[0] ?? null;
}

/** todos os pedidos ligados à nota, na ordem (o principal primeiro) */
export async function ordersOf(note: Pick<FiscalNote, 'purchase_order_id' | 'purchase_order_ids'>): Promise<PurchaseOrder[]> {
  const ids = noteOrderIds(note);
  if (!ids.length) return [];
  const { data } = await db().from('purchase_orders').select('*').in('id', ids);
  const list = (data ?? []).map((r) => toPO(r as Record<string, unknown>));
  return ids.map((id) => list.find((o) => o.id === id)).filter(Boolean) as PurchaseOrder[];
}

/** pedidos em aberto do mesmo fornecedor (pelo CNPJ ou pelo cadastro) */
export async function openOrdersOf(supplierId: string | null, cnpj: string | null): Promise<PurchaseOrder[]> {
  if (!supplierId && !cnpj) return [];
  const { data } = await db().from('purchase_orders').select('*').in('status', PO_OPEN).order('number', { ascending: true }).limit(300);
  return (data ?? []).map((r) => toPO(r as Record<string, unknown>)).filter((o) => (cnpj && o.cnpj ? o.cnpj === cnpj : Boolean(supplierId) && o.supplier_id === supplierId));
}

/**
 * Pedidos candidatos para a nota: os já ligados (ou escolhidos agora) + os em aberto do
 * mesmo fornecedor — a nota pode trazer itens de vários pedidos.
 */
export async function candidateOrders(n: FiscalNote, chosen?: PurchaseOrder[]): Promise<PurchaseOrder[]> {
  const linked = chosen ?? (await ordersOf(n));
  const open = n.status === 'lancada' || n.status === 'estornada' ? [] : await openOrdersOf(n.supplier_id, n.cnpj);
  const all = [...linked];
  for (const o of open) if (!all.some((x) => x.id === o.id)) all.push(o);
  return all;
}

/** situação da nota antes da entrada: NF recebida → em conferência → com divergência */
export function preStatus(n: FiscalNote): FiscalNote['status'] {
  if (n.status === 'lancada' || n.status === 'estornada') return n.status;
  if (n.items.some((l) => (l.received ?? 0) > 0)) return 'parcial';
  if (openAny(n.divergences).length) return 'divergencia';
  if (n.items.some((l) => l.inspected_at)) return 'conferencia';
  return 'aberta';
}

/**
 * Liga as linhas aos pedidos (pode ser mais de um, e uma linha pode ser dividida entre
 * pedidos), recalcula as divergências e a situação. `chosen`: pedidos escolhidos agora
 * (ficam ligados mesmo sem linha); sem ele, valem os já ligados à nota.
 * `reshape`: pode juntar/dividir linhas (só ao registrar e ao corrigir a nota — nunca no meio
 * da conferência ou da entrada, quando a tela já está usando as posições das linhas).
 */
export async function recompute(n: FiscalNote, chosen?: PurchaseOrder[] | PurchaseOrder | null, reshape = false): Promise<{ items: FiscalNote['items']; divergences: NonNullable<FiscalNote['divergences']>; status: FiscalNote['status']; purchase_order_ids: string[]; purchase_order_id: string | null }> {
  const pick = chosen === undefined ? undefined : !chosen ? [] : Array.isArray(chosen) ? chosen : [chosen];
  const cands = await candidateOrders(n, pick);
  const cfg = await loadConfig();
  const items = matchOrder(n.items, cands, n.order_refs ?? [], cfg.price_tolerance, reshape);
  // fica ligado: o que foi escolhido agora (ou o principal) + os pedidos que as linhas usam
  const keep = pick ? pick.map((o) => o.id) : n.purchase_order_id ? [n.purchase_order_id] : [];
  const ids = usedOrders(items, keep);
  const orders = ids.map((id) => cands.find((o) => o.id === id)).filter(Boolean) as PurchaseOrder[];
  const divergences = computeDivergences({ ...n, items }, orders, cfg, n.divergences ?? []);
  const status = preStatus({ ...n, items, divergences });
  return { items, divergences, status, purchase_order_ids: ids, purchase_order_id: ids[0] ?? null };
}

/** o que ainda impede a entrada no estoque (mensagem pronta para a tela) */
export function entryBlockers(n: FiscalNote): string[] {
  const out: string[] = [];
  if (n.installments_status !== undefined && n.installments_status !== 'validada') out.push('confira e valide as parcelas (a soma precisa bater com o total da nota)');
  const b = openBlocking(n.divergences);
  if (b.length) out.push(`${b.length === 1 ? 'há 1 divergência' : `há ${b.length} divergências`} com o pedido esperando Compras/gestão: ${b.map((d) => d.text).join(' ')}`);
  return out;
}
