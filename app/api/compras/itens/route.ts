import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { AccessError, serverError } from '@/lib/http';
import { loadItems } from '@/lib/almoxarifado/stockData';
import { canSeeOrders } from '@/lib/compras/pcServer';

export const dynamic = 'force-dynamic';

/** Itens do estoque para montar pedidos de compra (Compras não precisa ver o estoque todo). */
export async function GET() {
  try {
    const user = await requireUser();
    if (!canSeeOrders(user)) throw new AccessError(403, 'Sem acesso.');
    const items = await loadItems();
    return NextResponse.json(
      { items: items.filter((i) => i.active !== false).map((i) => ({ id: i.id, code: i.code, name: i.name, size: i.size, unit: i.unit, available: Math.max(0, i.quantity - (i.reserved ?? 0)), min: i.min_quantity, cost: i.cost })) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return serverError(e);
  }
}
