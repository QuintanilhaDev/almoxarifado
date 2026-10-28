import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE, str } from '@/lib/almoxarifado/stockData';
import { comprasEdit } from '@/lib/compras/access';
import { canApprove, canSeeOrders, cleanAttachments, dateOrNull, loadConfig, missingPC, nowIso, pcFail, toPO } from '@/lib/compras/pcServer';
import { cleanDelivery, cleanItems, cleanPayment, loadPO, resumeStatus, syncRequests } from '@/lib/compras/poServer';
import { PO_OPEN, PO_STATUS, approvalHash, brl, poLabel, poTotal, type PurchaseOrder } from '@/lib/compras/pc';
import { addDays, todayBahia } from '@/lib/compras/prazo';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Pedido de compra não encontrado.', 404);
  try {
    const user = await requireUser();
    if (!canSeeOrders(user)) throw new AccessError(403, 'Você não tem acesso aos pedidos de compra.');
    const o = await loadPO(id);
    if (!o) return fail('Pedido de compra não encontrado.', 404);
    // notas ligadas (recebimentos)
    // (uma nota pode atender vários pedidos: vale o principal ou a lista)
    const [a, b] = await Promise.all([
      db().from('fiscal_notes').select('id, number, series, status, received_date, created_at').eq('purchase_order_id', id),
      db().from('fiscal_notes').select('id, number, series, status, received_date, created_at').contains('purchase_order_ids', [id]),
    ]);
    const notes = [...(a.data ?? []), ...(b.error ? [] : b.data ?? [])].filter((n, i, all) => all.findIndex((x) => x.id === n.id) === i).sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)));
    return NextResponse.json({ order: o, notes });
  } catch (e) {
    if (missingPC(e)) return pcFail();
    return serverError(e);
  }
}

/** previsão de chegada pelo prazo (dias úteis ou corridos a partir de `from`, padrão hoje) */
const expectedFrom = (o: Pick<PurchaseOrder, 'delivery'>, from = todayBahia()) => o.delivery.date ?? (o.delivery.days !== null && o.delivery.days !== undefined ? addDays(from, o.delivery.days, o.delivery.business) : null);
/** dia (Salvador) de um horário ISO */
const dayBahia = (isoAt: string) => new Date(Date.parse(isoAt) - 3 * 3_600_000).toISOString().slice(0, 10);

/** fornecedor ainda pode ser contratado? (homologado e ativo) */
async function supplierBlock(o: PurchaseOrder): Promise<string | null> {
  if (!o.supplier_id) return null;
  const { data: s } = await db().from('suppliers').select('name, homologation, active').eq('id', o.supplier_id).maybeSingle();
  if (!s) return null;
  if (s.active === false) return `${s.name} está desativado no cadastro de fornecedores. Reative ou troque o fornecedor.`;
  if (s.homologation !== 'homologado') return `${s.name} ${s.homologation === 'bloqueado' ? 'está bloqueado' : 'ainda não foi homologado'}. Valide o fornecedor (aba Fornecedores) antes de contratar.`;
  return null;
}

/** quem mexeu no pedido desde a última aprovação (emitiu, alterou ou mandou para aprovação) */
function authorsSinceApproval(o: PurchaseOrder): Set<string> {
  const out = new Set<string>(o.created_by ? [o.created_by] : []);
  let k = o.history.length - 1;
  while (k >= 0 && !/^Aprovado/.test(o.history[k].what)) k--;
  for (const h of o.history.slice(k + 1)) if (/^(Alterado|Enviado para aprovação)/.test(h.what)) out.add(h.by);
  return out;
}

/**
 * Ações no pedido de compra:
 *  edit     — rascunho/aguardando: livre. Depois de aprovado: exige motivo; se mudar item,
 *             quantidade, preço, fornecedor, custos ou pagamento, volta para aprovação.
 *  submit   — manda para aprovação (abaixo da alçada configurada, aprova sozinho)
 *  approve  — aprova (master geral ou "Aprovação de compras"; quem emitiu não aprova o próprio)
 *  reject   — devolve para rascunho com o motivo
 *  send     — registra o envio ao fornecedor e calcula a previsão de chegada
 *  confirm  — fornecedor confirmou (com a data prometida)
 *  cancel   — cancela; se já recebeu parte, encerra o saldo que faltava
 *  attach   — troca os anexos
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Pedido de compra não encontrado.', 404);
  const b = await readJson<Record<string, unknown>>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    const o = await loadPO(id);
    if (!o) return fail('Pedido de compra não encontrado.', 404);
    const action = String(b.action ?? '');
    const by = user.display_name;
    const at = nowIso();
    const label = poLabel(o.number);
    const isApprover = canApprove(user);
    if (action === 'approve' || action === 'reject') {
      if (!isApprover) throw new AccessError(403, 'Só quem tem a permissão "Aprovação de compras" (ou o master geral) aprova pedidos.');
    } else if (!comprasEdit(user)) throw new AccessError(403, 'Só o setor de Compras (com edição) mexe nos pedidos de compra.');
    if (o.status === 'cancelado') return fail('Este pedido foi cancelado.', 409);
    if (o.status === 'concluido' && action !== 'attach') return fail('Este pedido já foi concluído.', 409);
    if (typeof b.expected === 'string' && b.expected !== o.status) return fail(`Este pedido acabou de mudar para "${PO_STATUS[o.status].label}". Confira antes de continuar.`, 409, { order: o });
    // aprovar/recusar só a versão que a pessoa viu
    if ((action === 'approve' || action === 'reject') && typeof b.version === 'string' && b.version !== o.updated_at) {
      return fail(`O ${poLabel(o.number)} foi alterado depois que você abriu. Confira a versão nova antes de decidir.`, 409, { order: o });
    }

    const patch: Record<string, unknown> = {};
    const events: string[] = [];
    const cfg = await loadConfig();

    if (action === 'edit') {
      const reason = str(b.reason, 400);
      const after = PO_OPEN.includes(o.status);
      if (after && !reason) return fail('O pedido já foi aprovado: diga o motivo da alteração (fica no histórico).');
      const next: PurchaseOrder = { ...o };
      if ('items' in b) {
        const items = cleanItems(b.items, o.items);
        if (typeof items === 'string') return fail(items);
        next.items = items;
      }
      for (const k of ['freight', 'other_costs', 'discount'] as const) if (k in b) next[k] = Number(b[k]) > 0 ? Math.round(Number(b[k]) * 100) / 100 : 0;
      if ('payment' in b) next.payment = cleanPayment(b.payment);
      if ('delivery' in b) next.delivery = cleanDelivery(b.delivery, cfg.delivery_location);
      if ('notes' in b) next.notes = str(b.notes, 1000);
      if ('expected_date' in b) next.expected_date = dateOrNull(b.expected_date);
      // prazo mudou (e o fornecedor ainda não confirmou): refaz a previsão, contando do envio
      const delivChanged = (o.delivery.days ?? null) !== (next.delivery.days ?? null) || o.delivery.date !== next.delivery.date || o.delivery.business !== next.delivery.business;
      const manualDate = 'expected_date' in b && next.expected_date !== o.expected_date;
      if (delivChanged && !manualDate && !o.confirmed_at && (o.sent_at || o.expected_date)) next.expected_date = expectedFrom(next, o.sent_at ? dayBahia(o.sent_at) : todayBahia());
      if ('promised_date' in b && o.confirmed_at) next.promised_date = dateOrNull(b.promised_date);
      next.total = poTotal(next);
      Object.assign(patch, { items: next.items, freight: next.freight, other_costs: next.other_costs, discount: next.discount, payment: next.payment, delivery: next.delivery, notes: next.notes, expected_date: next.expected_date, promised_date: next.promised_date, total: next.total });
      const diff: string[] = [];
      if (o.total !== next.total) diff.push(`total ${brl(o.total)} → ${brl(next.total)}`);
      for (const i of next.items) {
        const p = o.items.find((x) => x.key === i.key);
        if (!p) diff.push(`+ ${i.name} (${i.qty})`);
        else if (p.qty !== i.qty || p.unit_price !== i.unit_price) diff.push(`${i.name}: ${p.qty} × ${brl(p.unit_price)} → ${i.qty} × ${brl(i.unit_price)}`);
      }
      for (const p of o.items) if (!next.items.some((x) => x.key === p.key)) diff.push(`− ${p.name}`);
      if ((o.delivery.days ?? null) !== (next.delivery.days ?? null) || o.delivery.date !== next.delivery.date) diff.push('prazo de entrega');
      if (JSON.stringify(o.payment) !== JSON.stringify(next.payment)) diff.push('pagamento');
      if (after && o.approved_hash && approvalHash(next) !== o.approved_hash) {
        patch.status = 'aguardando_aprovacao';
        events.push(`Alterado depois da aprovação (${reason}): ${diff.join('; ') || 'condições'}. Voltou para aprovação.`);
      } else events.push(`Alterado${reason ? ` (${reason})` : ''}${diff.length ? ': ' + diff.join('; ') : ''}`);
    } else if (action === 'submit') {
      if (o.status !== 'rascunho') return fail('Só rascunho vai para aprovação.', 409);
      const blocked = await supplierBlock(o);
      if (blocked) return fail(blocked, 409);
      if (!o.items.length) return fail('O pedido precisa ter itens.');
      const total = poTotal(o);
      if (total < cfg.approval_min) {
        const snapshot = { items: o.items, freight: o.freight, other_costs: o.other_costs, discount: o.discount, payment: o.payment, delivery: o.delivery };
        Object.assign(patch, { status: 'aprovado', approval: { by: 'Alçada automática', at, note: `Abaixo de ${brl(cfg.approval_min)}`, total, auto: true, snapshot }, approved_hash: approvalHash(o), total, expected_date: o.expected_date ?? expectedFrom(o) });
        events.push(`Aprovado pela alçada (total ${brl(total)}, abaixo de ${brl(cfg.approval_min)})`);
      } else {
        patch.status = 'aguardando_aprovacao';
        events.push(`Enviado para aprovação (total ${brl(total)})`);
      }
    } else if (action === 'approve') {
      if (o.status !== 'aguardando_aprovacao') return fail('Este pedido não está aguardando aprovação.', 409);
      // quem emitiu ou alterou o pedido não aprova (vale também para o master: README "Quem emitiu não aprova")
      if (authorsSinceApproval(o).has(by)) return fail('Quem emitiu ou alterou o pedido não aprova a própria versão. Peça a outra pessoa com a permissão de aprovação.', 409);
      const blocked = await supplierBlock(o);
      if (blocked) return fail(blocked, 409);
      const note = str(b.note, 300);
      const resumed = o.approval ? resumeStatus(o) : 'aprovado';
      const snapshot = { items: o.items, freight: o.freight, other_costs: o.other_costs, discount: o.discount, payment: o.payment, delivery: o.delivery };
      Object.assign(patch, { status: resumed, approval: { by, at, note, total: poTotal(o), snapshot }, approved_hash: approvalHash(o) });
      if (!o.expected_date && !o.sent_at) patch.expected_date = expectedFrom(o);
      events.push(`Aprovado por ${by}${note ? `: ${note}` : ''}`);
    } else if (action === 'reject') {
      if (o.status !== 'aguardando_aprovacao') return fail('Este pedido não está aguardando aprovação.', 409);
      const note = str(b.note, 300);
      if (!note) return fail('Diga o motivo da recusa.');
      const snap = o.approval?.snapshot;
      if (snap) {
        // recusou a ALTERAÇÃO: o pedido volta a ser exatamente o que tinha sido aprovado
        // não volta para uma versão que "perde" o que já chegou (linha saiu ou ficou menor que o recebido)
        const lost = o.items.find((i) => i.received > 0 && (snap.items.find((x) => x.key === i.key)?.qty ?? 0) < i.received);
        if (lost) return fail(`Não dá para voltar ao aprovado: ${lost.name} já teve ${lost.received} recebido(s) e a versão aprovada não comporta. Ajuste o pedido e aprove a alteração.`, 409);
        const items = snap.items.map((i) => ({ ...i, received: o.items.find((x) => x.key === i.key)?.received ?? 0 }));
        const back: PurchaseOrder = { ...o, ...snap, items };
        Object.assign(patch, { items, freight: snap.freight, other_costs: snap.other_costs, discount: snap.discount, payment: snap.payment, delivery: snap.delivery, total: poTotal(back), status: resumeStatus(back) });
        events.push(`Alteração recusada por ${by}: ${note}. O pedido voltou ao que tinha sido aprovado.`);
      } else {
        patch.status = 'rascunho';
        events.push(`Devolvido para ajuste por ${by}: ${note}`);
      }
    } else if (action === 'send') {
      if (o.status !== 'aprovado') return fail(o.status === 'aguardando_aprovacao' ? 'O pedido ainda não foi aprovado.' : 'Este pedido já foi enviado.', 409);
      const blocked = await supplierBlock(o);
      if (blocked) return fail(blocked, 409);
      const via = str(b.via, 40) ?? 'e-mail';
      // a previsão passa a contar a partir de hoje (data fixa combinada continua valendo)
      Object.assign(patch, { status: 'enviado', sent_at: at, sent_by: by, sent_via: via, expected_date: expectedFrom(o) ?? o.expected_date });
      events.push(`Enviado ao fornecedor por ${via}`);
    } else if (action === 'confirm') {
      if (!['aprovado', 'enviado'].includes(o.status)) return fail('Só pedido aprovado ou enviado recebe a confirmação do fornecedor.', 409);
      const promised = dateOrNull(b.promised_date);
      if (!promised) return fail('Informe a data de entrega que o fornecedor confirmou.');
      Object.assign(patch, { status: 'confirmado', confirmed_at: at, confirmed_by: by, promised_date: promised, sent_at: o.sent_at ?? at, sent_by: o.sent_by ?? by });
      events.push(`Fornecedor confirmou a entrega para ${promised.split('-').reverse().join('/')}${str(b.note, 200) ? ` — ${str(b.note, 200)}` : ''}`);
    } else if (action === 'cancel') {
      const reason = str(b.reason, 300);
      if (!reason) return fail('Diga o motivo do cancelamento.');
      // nota ligada ainda sem entrada: resolve a nota antes (senão o estoque entraria num pedido cancelado)
      const [na, nb] = await Promise.all([
        db().from('fiscal_notes').select('number, status').eq('purchase_order_id', id),
        db().from('fiscal_notes').select('number, status').contains('purchase_order_ids', [id]),
      ]);
      const pending = [...(na.data ?? []), ...(nb.error ? [] : nb.data ?? [])].filter((n) => !['lancada', 'estornada'].includes(String(n.status)));
      if (pending.length) return fail(`Há nota ligada a este pedido ainda sem entrada completa (NF ${[...new Set(pending.map((n) => n.number))].join(', ')}). Lance, estorne ou desligue a nota antes de cancelar.`, 409);
      const got = o.items.some((i) => i.received > 0);
      if (got) {
        Object.assign(patch, { status: 'concluido', cancel_reason: reason });
        events.push(`Saldo a receber cancelado: ${reason}`);
      } else {
        Object.assign(patch, { status: 'cancelado', cancel_reason: reason });
        events.push(`Pedido cancelado: ${reason}`);
      }
    } else if (action === 'attach') {
      patch.attachments = cleanAttachments(b.attachments).map((a) => ({ ...a, at: a.at ?? at, by: a.by ?? by }));
      events.push('Anexos atualizados');
    } else {
      return fail('Ação inválida.');
    }

    patch.updated_at = at;
    patch.history = [...o.history, ...events.map((what) => ({ at, by, what }))].slice(-120);
    const { data, error } = await db().from('purchase_orders').update(patch).eq('id', id).eq('updated_at', o.updated_at).select('*').maybeSingle();
    if (error) throw error;
    if (!data) return fail(`Outra pessoa alterou o ${label} agora. Confira e tente de novo.`, 409);
    const order = toPO(data as Record<string, unknown>);
    if (['approve', 'cancel', 'send', 'confirm', 'submit'].includes(action) || patch.status) await syncRequests(order.request_ids, by);
    await broadcast('purchase:update', { by, order: id, status: order.status });
    return NextResponse.json({ order });
  } catch (e) {
    if (missingPC(e)) return pcFail();
    return serverError(e);
  }
}
