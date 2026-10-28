import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE } from '@/lib/almoxarifado/stockData';
import { colabAccess } from '@/lib/pedidos/access';
import { missingP3, p3Fail } from '@/lib/pedidos/server';
import { todayBahia } from '@/lib/pedidos/types';
import { deslFail, itemDevolucao, temDesligamento } from '@/lib/rh/desligamento';
import { DEV_COLS, STATUS_DEV, type Devolucao } from '@/lib/rh/devolucao';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Atualiza a devolução de um item (situação, quantidade, data, observação), com histórico. */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Item não encontrado.', 404);
  const b = await readJson<Record<string, unknown>>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!colabAccess(user, 'edit')) throw new AccessError(403, 'Só o RH registra devoluções.');
    if (!(await temDesligamento())) return deslFail();
    const { data: cur, error: e0 } = await db().from('collaborator_returns').select(DEV_COLS).eq('id', id).maybeSingle();
    if (e0) throw e0;
    if (!cur) return fail('Item não encontrado.', 404);
    const atual = cur as unknown as Devolucao;
    const r = itemDevolucao({ ...atual, ...b, item_name: atual.item_name, source: atual.source, qty_delivered: atual.qty_delivered }, todayBahia());
    if ('error' in r) return fail(r.error);
    const mudou: string[] = [];
    if (r.row.status !== atual.status) mudou.push(`${STATUS_DEV[atual.status]} → ${STATUS_DEV[r.row.status as Devolucao['status']]}`);
    if (r.row.qty_returned !== atual.qty_returned) mudou.push(`devolvido ${atual.qty_returned} → ${r.row.qty_returned}`);
    if (r.row.returned_at !== atual.returned_at) mudou.push(`data ${r.row.returned_at ?? '—'}`);
    if ((r.row.notes ?? null) !== (atual.notes ?? null)) mudou.push('observação');
    if (!mudou.length) return NextResponse.json({ item: cur });
    const history = [...(Array.isArray(atual.history) ? atual.history : []), { at: new Date().toISOString(), by: user.display_name, what: mudou.join(', ') }].slice(-50);
    const { data, error } = await db()
      .from('collaborator_returns')
      .update({ status: r.row.status, qty_returned: r.row.qty_returned, returned_at: r.row.returned_at, notes: r.row.notes, history, updated_by: user.display_name, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(DEV_COLS)
      .single();
    if (error) throw error;
    await broadcast('collab:update', { by: user.display_name });
    return NextResponse.json({ item: data });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
