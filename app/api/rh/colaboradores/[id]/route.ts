import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE } from '@/lib/almoxarifado/stockData';
import { almoxOrders, colabAccess, opOrders, rhOrders } from '@/lib/pedidos/access';
import { ORDER_COLS, missingP3, p3Fail, toOrder } from '@/lib/pedidos/server';
import { COLLAB_COLS, collabFields } from '@/lib/pedidos/rh';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Ficha do colaborador: dados, tudo o que recebeu (termos) e os pedidos. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Colaborador não encontrado.', 404);
  try {
    const user = await requireUser();
    if (!colabAccess(user) && !rhOrders(user) && !opOrders(user) && !almoxOrders(user)) throw new AccessError(403, 'Você não tem acesso aos colaboradores.');
    const [c, d, o] = await Promise.all([
      db().from('collaborators').select(COLLAB_COLS).eq('id', id).maybeSingle(),
      db().from('deliveries').select('id, group_id, order_number, kind, item_name, size, item_code, ca_number, qty, returned_qty, receiver, by_name, delivered_at').eq('collaborator_id', id).order('delivered_at', { ascending: false }).limit(500),
      db().from('material_orders').select(ORDER_COLS).eq('collaborator_id', id).order('created_at', { ascending: false }).limit(100),
    ]);
    if (c.error) throw c.error;
    if (!c.data) return fail('Colaborador não encontrado.', 404);
    return NextResponse.json({ collaborator: c.data, deliveries: d.data ?? [], orders: (o.data ?? []).map((r) => toOrder(r as Record<string, unknown>)) });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Colaborador não encontrado.', 404);
  const b = await readJson<Record<string, unknown>>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!colabAccess(user, 'edit')) throw new AccessError(403, 'Só o RH altera o cadastro dos colaboradores.');
    const { data: cur, error: e0 } = await db().from('collaborators').select(COLLAB_COLS).eq('id', id).maybeSingle();
    if (e0) throw e0;
    if (!cur) return fail('Colaborador não encontrado.', 404);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (Object.keys(b).some((k) => k !== 'active')) {
      const { data: postos } = await db().from('postos').select('id, name').limit(2000);
      const r = collabFields({ ...cur, ...b, sizes: b.sizes ?? cur.sizes }, (postos ?? []) as { id: string; name: string }[]);
      if ('error' in r) return fail(r.error);
      Object.assign(patch, r.row);
    }
    if ('active' in b) patch.active = b.active !== false;
    const { data, error } = await db().from('collaborators').update(patch).eq('id', id).select(COLLAB_COLS).maybeSingle();
    if (error) {
      if (error.code === '23505') return fail('Já existe outro colaborador com essa matrícula.', 409);
      throw error;
    }
    await broadcast('collab:update', { by: user.display_name });
    return NextResponse.json({ collaborator: data });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
