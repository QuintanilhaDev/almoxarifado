import 'server-only';
import { db } from '../supabaseAdmin';

/**
 * Estoque de devolução Fard/EPI (transitório): cada peça devolvida por um colaborador entra aqui
 * e espera a avaliação do Almoxarifado (higienização e entrada no estoque, ou descarte).
 * Um lote por item da devolução (collaborator_returns.id).
 */
export type StatusLote = 'aguardando' | 'higienizacao' | 'reaproveitado' | 'descartado';
export const STATUS_LOTE: Record<StatusLote, string> = { aguardando: 'Aguardando avaliação', higienizacao: 'Em higienização', reaproveitado: 'Reaproveitado (entrou no estoque)', descartado: 'Descartado' };
export interface Lote {
  id: string;
  return_id: string | null;
  collaborator_id: string | null;
  collaborator_name: string | null;
  item_name: string;
  size: string | null;
  qty: number;
  received_at: string;
  status: StatusLote;
  stock_item_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  notes: string | null;
  history: { at: string; by: string; what: string }[];
  created_at: string;
}
export const LOTE_COLS = 'id, return_id, collaborator_id, collaborator_name, item_name, size, qty, received_at, status, stock_item_id, decided_by, decided_at, notes, history, created_at';

let cache: { ok: boolean; at: number } | null = null;
export async function temEstoqueDevolucao(): Promise<boolean> {
  if (cache && (cache.ok || Date.now() - cache.at < 60_000)) return cache.ok;
  const a = await db().from('return_stock').select('id').limit(1);
  cache = { ok: !a.error, at: Date.now() };
  return cache.ok;
}

/**
 * Deixa o lote do estoque de devolução igual ao que o RH registrou no item da devolução.
 * Devolvido (com quantidade) → lote aguardando avaliação; voltou para pendente/não devolvido → sai do estoque.
 * Lote já avaliado pelo Almoxarifado não muda: devolve o motivo.
 */
export async function sincronizarLote(
  item: { id: string; collaborator_id: string; item_name: string; size: string | null; qty_returned: number; status: string; returned_at: string | null },
  colabName: string | null,
  by: string,
): Promise<string | null> {
  if (!(await temEstoqueDevolucao())) return null;
  const quer = item.status === 'nao_devolvido' ? 0 : Math.max(0, Number(item.qty_returned) || 0);
  const { data: cur, error } = await db().from('return_stock').select(LOTE_COLS).eq('return_id', item.id);
  if (error) throw error;
  const lotes = (cur ?? []) as Lote[];
  const now = new Date().toISOString();
  // algum pedaço já avaliado pelo Almoxarifado: a quantidade total não muda mais por aqui
  const avaliado = lotes.find((l) => l.status !== 'aguardando');
  if (avaliado) {
    if (lotes.reduce((t, l) => t + l.qty, 0) === quer) return null;
    return `Esta peça já foi avaliada no Almoxarifado (${STATUS_LOTE[avaliado.status].toLowerCase()}). Peça ao Almoxarifado para ajustar o estoque de devolução antes de mudar a quantidade.`;
  }
  const lote = lotes[0] ?? null;
  if (!lote) {
    if (!quer) return null;
    const { error: e1 } = await db()
      .from('return_stock')
      .insert({ return_id: item.id, collaborator_id: item.collaborator_id, collaborator_name: colabName, item_name: item.item_name, size: item.size, qty: quer, received_at: item.returned_at ?? now.slice(0, 10), created_by: by, history: [{ at: now, by, what: `Entrou no estoque de devolução: ${quer}` }] });
    if (e1) throw e1;
    return null;
  }
  if (!quer) {
    const { error: e2 } = await db().from('return_stock').delete().eq('id', lote.id).eq('status', 'aguardando');
    if (e2) throw e2;
    return null;
  }
  if (lote.qty !== quer || (item.returned_at && item.returned_at !== lote.received_at)) {
    const history = [...(lote.history ?? []), { at: now, by, what: `Quantidade devolvida ${lote.qty} → ${quer}` }].slice(-50);
    const { error: e3 } = await db().from('return_stock').update({ qty: quer, received_at: item.returned_at ?? lote.received_at, history }).eq('id', lote.id).eq('status', 'aguardando');
    if (e3) throw e3;
  }
  return null;
}
