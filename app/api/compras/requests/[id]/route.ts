import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE, str } from '@/lib/almoxarifado/stockData';
import { almoxEdit, canSeePurchases, comprasEdit } from '@/lib/compras/access';
import { COLS, missingTable, setupFail, toRequest } from '@/lib/compras/server';
import { COMPRAS_STATUSES, LIMITS, STATUS_LABEL, isPurchaseStatus, type PurchaseStatus } from '@/lib/compras/types';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/**
 * Muda o andamento de uma solicitação de compra.
 *  - Compras: nova → em cotação → comprada → entregue (ou recusada), com resposta.
 *  - Almoxarifado: só cancela, e só enquanto ainda está "nova".
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Solicitação não encontrada.', 404);
  const body = await readJson<{ status?: unknown; response?: unknown; expected?: unknown }>(req);
  if (!body) return fail('Dados inválidos.');
  const status = body.status;
  if (status !== undefined && !isPurchaseStatus(status)) return fail('Status inválido.');
  const hasResponse = 'response' in body;
  if (status === undefined && !hasResponse) return fail('Nada para alterar.');
  try {
    const user = await requireUser();
    if (!canSeePurchases(user)) throw new AccessError(403, 'Você não tem acesso às solicitações de compra.');
    const { data: cur, error: e1 } = await db().from('purchase_requests').select(COLS).eq('id', id).maybeSingle();
    if (e1) {
      if (missingTable(e1)) return setupFail();
      throw e1;
    }
    if (!cur) return fail('Solicitação não encontrada.', 404);
    const row = toRequest(cur as Record<string, unknown>);
    // alguém mudou antes de mim? (duas pessoas de Compras na mesma solicitação)
    if (isPurchaseStatus(body.expected) && body.expected !== row.status) {
      return fail(`Esta solicitação acabou de ser marcada como "${STATUS_LABEL[row.status]}" por outra pessoa. Confira antes de mudar.`, 409, { request: row });
    }
    if (row.status === 'cancelada') return fail('Esta solicitação foi cancelada pelo Almoxarifado e não pode mais ser alterada.', 409);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    let next: PurchaseStatus = row.status;
    let note: string | null = null;
    if (status === 'cancelada') {
      if (!almoxEdit(user)) throw new AccessError(403, 'Só o Almoxarifado pode cancelar uma solicitação de compra.');
      if (row.status !== 'nova') return fail('Compras já começou a cuidar desta solicitação. Para cancelar agora, fale com o setor de Compras.', 409);
      next = 'cancelada';
    } else {
      if (!comprasEdit(user)) throw new AccessError(403, 'Só o setor de Compras pode mudar o andamento ou responder.');
      if (status !== undefined) {
        if (!COMPRAS_STATUSES.includes(status as PurchaseStatus)) return fail('Status inválido.');
        next = status as PurchaseStatus;
        // voltar para "nova" reabriria o cancelamento pelo Almoxarifado
        if (next === 'nova' && row.status !== 'nova') return fail('Uma solicitação que já andou não volta para "Nova".', 409);
      }
      if (hasResponse) {
        note = str(body.response, LIMITS.response);
        patch.response = note;
      }
      patch.handled_by = user.display_name;
    }
    const changed = next !== row.status;
    if (!changed && !hasResponse) return NextResponse.json({ request: row });
    if (changed) patch.status = next;
    patch.history = [...row.history, { at: patch.updated_at, by: user.display_name, status: next, note }].slice(-60);

    // grava só se ninguém mexeu desde a leitura (duas pessoas ao mesmo tempo não se atropelam)
    const { data, error } = await db().from('purchase_requests').update(patch).eq('id', id).eq('updated_at', (cur as { updated_at: string }).updated_at).select(COLS).maybeSingle();
    if (error) throw error;
    if (!data) return fail('Outra pessoa acabou de alterar esta solicitação. Confira e tente de novo.', 409);
    const out = toRequest(data as Record<string, unknown>);
    await broadcast('purchase:update', { id, number: out.number, status: out.status, by: user.display_name, changed });
    return NextResponse.json({ request: out });
  } catch (e) {
    return serverError(e);
  }
}
