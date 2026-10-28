import 'server-only';
import { fetchAll } from '../almoxarifado/stockData';
import { db } from '../supabaseAdmin';
import { normalize } from '../max/text';
import { loadItems } from '../almoxarifado/stockData';
import type { Answer } from '../almoxarifado/types';
import { ORDER_COLS, duplicityFlags, event, formToLines, toOrder } from './server';
import type { MaterialOrder, OrderStage } from './types';

export interface RequestLike {
  id: string;
  protocol: number;
  email: string;
  collaborator: string | null;
  posto: string | null;
  answers: Answer[];
  order_id?: string | null;
}

/**
 * Solicitação do formulário dos supervisores → pedido de material da Operação.
 * Os itens, tamanhos e quantidade vêm das respostas; o que não for reconhecido com
 * certeza fica marcado para alguém ligar ao item certo do estoque.
 */
export async function orderFromRequest(r: RequestLike, opts: { by: string; byId?: string | null; stage: OrderStage }): Promise<MaterialOrder> {
  const stock = await loadItems();
  const items = formToLines(r.answers ?? [], stock);
  if (!items.length) throw Object.assign(new Error('A solicitação não tem itens reconhecíveis. Crie o pedido manualmente.'), { code: 'NOITEMS' });
  // posto pelo nome
  let posto: { id: string; name: string } | null = null;
  if (r.posto) {
    const data = await fetchAll<{ id: string; name: string }>('postos', 'id, name', { column: 'id' });
    const key = normalize(r.posto);
    posto = ((data ?? []) as { id: string; name: string }[]).find((p) => normalize(p.name) === key) ?? null;
  }
  // colaborador pelo nome (só se houver um único com esse nome)
  type Collab = { id: string; matricula: string | null; role: string | null; company: string | null };
  let collab: Collab | null = null;
  if (r.collaborator) {
    const { data } = await db().from('collaborators').select('id, matricula, role, company').eq('name_key', r.collaborator.trim().toLowerCase()).eq('active', true).limit(2);
    if (data && data.length === 1) collab = data[0] as Collab;
  }
  const reasonA = (r.answers ?? []).find((a) => /motivo|observa|justific/.test(normalize(`${a.fieldId} ${a.label}`)));
  const reason = reasonA?.value ? String(Array.isArray(reasonA.value) ? reasonA.value.join(', ') : reasonA.value).slice(0, 600) : null;
  const flags = await duplicityFlags({ collaborator_id: collab?.id ?? null, collaborator_name: r.collaborator, items });
  const now = new Date().toISOString();
  const history = [event(opts.by, `Criado a partir da solicitação do formulário nº ${r.protocol} (${r.email})`)];
  if (opts.stage === 'encaminhado') history.push(event(opts.by, 'Encaminhado ao Almoxarifado'));
  const { data, error } = await db()
    .from('material_orders')
    .insert({
      origin: 'operacao',
      stage: opts.stage,
      posto_id: posto?.id ?? null,
      posto_name: posto?.name ?? r.posto,
      collaborator_id: collab?.id ?? null,
      collaborator_name: r.collaborator,
      matricula: collab?.matricula ?? null,
      role: collab?.role ?? null,
      company: collab?.company ?? null,
      reason,
      requester: opts.by,
      requester_id: opts.byId ?? null,
      supervisor: r.email,
      source_request_id: r.id,
      items,
      flags,
      history,
      forwarded_by: opts.stage === 'encaminhado' ? opts.by : null,
      forwarded_at: opts.stage === 'encaminhado' ? now : null,
    })
    .select(ORDER_COLS)
    .single();
  if (error) throw error;
  const order = toOrder(data as Record<string, unknown>);
  await db().from('requests').update({ order_id: order.id }).eq('id', r.id);
  return order;
}
