import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { AccessError, serverError } from '@/lib/http';
import { canSeeOrders, missingPC, pcFail } from '@/lib/compras/pcServer';
import { comprasPainel } from '@/lib/compras/painel';

export const dynamic = 'force-dynamic';

/** Painel de Compras (fila, cotações, pedidos, atrasos, fornecedores) e números da Gestão. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    if (!canSeeOrders(user)) throw new AccessError(403, 'Sem acesso ao painel de Compras.');
    const d = Number(new URL(req.url).searchParams.get('days'));
    return NextResponse.json(await comprasPainel({ days: Number.isInteger(d) && d > 0 && d <= 730 ? d : 365 }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (missingPC(e)) return pcFail();
    return serverError(e);
  }
}
