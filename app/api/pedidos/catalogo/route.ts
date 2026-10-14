import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, serverError } from '@/lib/http';
import { loadItems } from '@/lib/almoxarifado/stockData';
import { almoxOrders, colabAccess, opOrders, rhOrders } from '@/lib/pedidos/access';

export const dynamic = 'force-dynamic';

/** O que quem abre pedidos precisa para montar um: itens ativos (com o disponível), postos e funções com kit. */
export async function GET() {
  try {
    const user = await requireUser();
    if (!opOrders(user) && !rhOrders(user) && !almoxOrders(user) && !colabAccess(user)) throw new AccessError(403, 'Você não tem acesso aos pedidos de material.');
    const [items, postos, kits] = await Promise.all([
      loadItems(),
      db().from('postos').select('id, name').order('name_key').limit(3000),
      db().from('role_kits').select('role').order('role'),
    ]);
    return NextResponse.json(
      {
        items: items.filter((i) => i.active !== false).map((i) => ({ id: i.id, code: i.code, name: i.name, size: i.size, unit: i.unit, available: Math.max(0, i.quantity - i.reserved) })),
        postos: postos.data ?? [],
        roles: (kits.data ?? []).map((k) => k.role as string),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return serverError(e);
  }
}
