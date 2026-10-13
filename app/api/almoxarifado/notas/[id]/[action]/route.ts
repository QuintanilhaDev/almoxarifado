import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE, str } from '@/lib/almoxarifado/stockData';
import { notesAccess } from '@/lib/pedidos/access';
import { ORDER_COLS, dbRule, missingP3, p3Fail, toOrder } from '@/lib/pedidos/server';
import { NOTE_COLS, toNote } from '@/lib/notas/server';
import { orderLabel } from '@/lib/pedidos/types';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string; action: string }> };

/**
 * post:    dá entrada no que foi conferido (tudo ou parte). Ao completar a nota, a solicitação
 *          de compra ligada vira "Entregue" e o retorno lista os pedidos que esperavam esses itens.
 * reverse: estorna a nota (movimentos novos; a entrada original fica no histórico).
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id, action } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Nota não encontrada.', 404);
  const b = (await readJson<{ lines?: unknown; reason?: unknown }>(req)) ?? {};
  try {
    const user = await requireUser();
    if (!notesAccess(user, 'edit')) throw new AccessError(403, 'Só quem lança notas no Almoxarifado pode fazer isso.');
    const by = user.display_name;
    if (action === 'post') {
      if (!Array.isArray(b.lines) || !b.lines.length) return fail('Informe o que foi recebido.');
      const lines = (b.lines as Record<string, unknown>[]).map((x) => ({ i: Number(x?.i), item_id: typeof x?.item_id === 'string' && UUID_RE.test(x.item_id) ? x.item_id : null, qty: Number(x?.qty) }));
      if (lines.some((l) => !Number.isInteger(l.i) || !Number.isFinite(l.qty) || l.qty < 0)) return fail('Quantidades inválidas.');
      const { data, error } = await db().rpc('post_fiscal_note', { p_note: id, p_lines: lines.filter((l) => l.qty > 0), p_by: by });
      if (error) throw error;
      const { data: n } = await db().from('fiscal_notes').select(NOTE_COLS).eq('id', id).single();
      const note = toNote(n as Record<string, unknown>);
      // compra atendida
      let purchase: { number: number } | null = null;
      if (note.purchase_request_id && note.status === 'lancada') {
        const { data: pr } = await db().from('purchase_requests').select('id, number, status, history').eq('id', note.purchase_request_id).maybeSingle();
        if (pr && !['entregue', 'cancelada', 'recusada'].includes(pr.status as string)) {
          const now = new Date().toISOString();
          await db()
            .from('purchase_requests')
            .update({ status: 'entregue', updated_at: now, history: [...((pr.history as unknown[]) ?? []), { at: now, by, status: 'entregue', note: `Recebida no Almoxarifado pela NF ${note.number}` }] })
            .eq('id', pr.id);
          purchase = { number: Number(pr.number) };
          await broadcast('purchase:update', { id: pr.id, number: pr.number, status: 'entregue', by, changed: true });
        }
      }
      // pedidos que esperavam estes itens (para reservar agora)
      const received = new Set(note.items.filter((l) => l.item_id && l.received > 0).map((l) => l.item_id));
      const { data: os } = await db().from('material_orders').select(ORDER_COLS).eq('stage', 'encaminhado').limit(300);
      const waiting = (os ?? [])
        .map((r) => toOrder(r as Record<string, unknown>))
        .map((o) => ({ id: o.id, number: o.number, label: orderLabel(o.number), who: o.collaborator_name ?? o.posto_name, lines: o.items.map((l, i) => ({ i, l })).filter(({ l }) => l.item_id && received.has(l.item_id) && l.qty - l.delivered - l.reserved > 0).map(({ i, l }) => ({ i, name: l.name, size: l.size, missing: l.qty - l.delivered - l.reserved })) }))
        .filter((o) => o.lines.length);
      await broadcast('note:update', { id, by });
      await broadcast('stock:update', { by });
      return NextResponse.json({ result: data, note, purchase, waiting });
    }
    if (action === 'reverse') {
      const reason = str(b.reason, 300);
      if (!reason) return fail('Diga o motivo do estorno.');
      const { data, error } = await db().rpc('reverse_fiscal_note', { p_note: id, p_reason: reason, p_by: by });
      if (error) throw error;
      await broadcast('note:update', { id, by });
      await broadcast('stock:update', { by });
      return NextResponse.json({ result: data });
    }
    return fail('Ação inválida.', 404);
  } catch (e) {
    const rule = dbRule(e);
    if (rule) return fail(rule.message, 409);
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
