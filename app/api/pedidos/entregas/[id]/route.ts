import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE, str } from '@/lib/almoxarifado/stockData';
import { almoxOrders } from '@/lib/pedidos/access';
import { dbRule, missingP3, p3Fail } from '@/lib/pedidos/server';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Devolução/troca: o colaborador devolve o que recebeu. Em bom estado volta ao saldo; senão, só registra. */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Entrega não encontrada.', 404);
  const b = await readJson<{ qty?: unknown; good?: unknown; reason?: unknown }>(req);
  if (!b) return fail('Dados inválidos.');
  const qty = Number(b.qty);
  if (!Number.isInteger(qty) || qty < 1) return fail('Informe quantas unidades voltaram.');
  const reason = str(b.reason, 300);
  if (!reason) return fail('Diga o motivo da devolução (ex.: tamanho errado, desligamento, desgaste).');
  try {
    const user = await requireUser();
    if (!almoxOrders(user, 'edit')) throw new AccessError(403, 'Só o Almoxarifado registra devoluções.');
    const { error } = await db().rpc('delivery_return', { p_delivery: id, p_qty: qty, p_good: b.good !== false, p_reason: reason, p_by: user.display_name });
    if (error) throw error;
    await broadcast('stock:update', { by: user.display_name });
    await broadcast('order:update', { by: user.display_name, action: 'return' });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const rule = dbRule(e);
    if (rule) return fail(rule.message, 409);
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
