import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { AccessError, fail, serverError } from '@/lib/http';
import { UUID_RE, fetchAll } from '@/lib/almoxarifado/stockData';
import { almoxOrders, colabAccess, rhOrders } from '@/lib/pedidos/access';
import { missingP3, p3Fail } from '@/lib/pedidos/server';

export const dynamic = 'force-dynamic';
const COLS = 'id, group_id, order_id, order_number, origin, kind, collaborator_id, collaborator_name, matricula, role, posto_name, item_id, item_name, size, item_code, ca_number, qty, returned_qty, receiver, by_name, delivered_at';

/** Entregas (termos). ?collaborator=<id> | ?group=<termo> | ?days=90 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    if (!almoxOrders(user) && !rhOrders(user) && !colabAccess(user)) throw new AccessError(403, 'Você não tem acesso às entregas.');
    const sp = new URL(req.url).searchParams;
    const collab = sp.get('collaborator');
    const group = sp.get('group');
    if (collab && !UUID_RE.test(collab)) return fail('Colaborador inválido.');
    if (!collab && group && !UUID_RE.test(group)) return fail('Termo inválido.');
    const days = Math.min(730, Math.max(1, Number(sp.get('days')) || 90));
    // todas as linhas (o Supabase devolve no máximo 1000 por consulta)
    const data = await fetchAll<Record<string, unknown>>('deliveries', COLS, { column: 'delivered_at', ascending: false, tiebreak: 'id' }, (q) =>
      collab ? q.eq('collaborator_id', collab) : group ? q.eq('group_id', group) : q.gte('delivered_at', new Date(Date.now() - days * 86_400_000).toISOString()),
    );
    return NextResponse.json({ deliveries: data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
