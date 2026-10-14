import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE } from '@/lib/almoxarifado/stockData';
import { almoxOrders } from '@/lib/pedidos/access';
import { missingP3, p3Fail } from '@/lib/pedidos/server';
import { orderFromRequest, type RequestLike } from '@/lib/pedidos/fromRequest';
import { orderLabel } from '@/lib/pedidos/types';

export const dynamic = 'force-dynamic';

/** "Criar pedido" na Caixa de entrada: a solicitação do formulário vira pedido de material (itens já ligados ao estoque). */
export async function POST(req: Request) {
  const b = await readJson<{ request_id?: unknown }>(req);
  if (!b || typeof b.request_id !== 'string' || !UUID_RE.test(b.request_id)) return fail('Solicitação inválida.');
  try {
    const user = await requireUser();
    if (!almoxOrders(user, 'edit')) throw new AccessError(403, 'Só quem edita os pedidos de material no Almoxarifado pode fazer isso.');
    const { data: r, error } = await db().from('requests').select('*').eq('id', b.request_id).maybeSingle();
    if (error) throw error;
    if (!r) return fail('Solicitação não encontrada.', 404);
    if (r.order_id) {
      const { data: o } = await db().from('material_orders').select('id, number').eq('id', r.order_id).maybeSingle();
      if (o) return fail(`Esta solicitação já virou o pedido ${orderLabel(Number(o.number))}.`, 409, { order_id: o.id });
    }
    const order = await orderFromRequest(r as RequestLike, { by: user.display_name, byId: user.id, stage: 'encaminhado' });
    await broadcast('order:new', { id: order.id, number: order.number, origin: order.origin, stage: order.stage, by: user.display_name });
    await broadcast('request:update', { id: r.id, by: user.display_name });
    return NextResponse.json({ order });
  } catch (e) {
    if ((e as { code?: string }).code === 'NOITEMS') return fail((e as Error).message, 422);
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
