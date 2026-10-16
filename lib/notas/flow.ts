import 'server-only';
import { db } from '../supabaseAdmin';
import { loadConfig, toPO } from '../compras/pcServer';
import type { PurchaseOrder } from '../compras/pc';
import { computeDivergences, matchOrder, noteCols, toNote, type FiscalNote } from './server';
import { openAny, openBlocking } from './conferencia';

export async function loadNote(id: string): Promise<FiscalNote | null> {
  const { data, error } = await db().from('fiscal_notes').select(await noteCols()).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toNote(data as unknown as Record<string, unknown>) : null;
}

export async function orderOf(note: Pick<FiscalNote, 'purchase_order_id'>): Promise<PurchaseOrder | null> {
  if (!note.purchase_order_id) return null;
  const { data } = await db().from('purchase_orders').select('*').eq('id', note.purchase_order_id).maybeSingle();
  return data ? toPO(data as Record<string, unknown>) : null;
}

/** situação da nota antes da entrada: NF recebida → em conferência → com divergência */
export function preStatus(n: FiscalNote): FiscalNote['status'] {
  if (n.status === 'lancada' || n.status === 'estornada') return n.status;
  if (n.items.some((l) => (l.received ?? 0) > 0)) return 'parcial';
  if (openAny(n.divergences).length) return 'divergencia';
  if (n.items.some((l) => l.inspected_at)) return 'conferencia';
  return 'aberta';
}

/** liga as linhas ao pedido, recalcula as divergências e a situação */
export async function recompute(n: FiscalNote, po?: PurchaseOrder | null): Promise<{ items: FiscalNote['items']; divergences: NonNullable<FiscalNote['divergences']>; status: FiscalNote['status'] }> {
  const order = po === undefined ? await orderOf(n) : po;
  const items = matchOrder(n.items, order);
  const cfg = await loadConfig();
  const divergences = computeDivergences({ ...n, items }, order, cfg, n.divergences ?? []);
  const status = preStatus({ ...n, items, divergences });
  return { items, divergences, status };
}

/** o que ainda impede a entrada no estoque (mensagem pronta para a tela) */
export function entryBlockers(n: FiscalNote): string[] {
  const out: string[] = [];
  if (n.installments_status !== undefined && n.installments_status !== 'validada') out.push('confira e valide as parcelas (a soma precisa bater com o total da nota)');
  const b = openBlocking(n.divergences);
  if (b.length) out.push(`${b.length === 1 ? 'há 1 divergência' : `há ${b.length} divergências`} com o pedido esperando Compras/gestão: ${b.map((d) => d.text).join(' ')}`);
  return out;
}
