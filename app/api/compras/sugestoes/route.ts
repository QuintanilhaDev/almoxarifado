import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { AccessError, serverError } from '@/lib/http';
import { UUID_RE } from '@/lib/almoxarifado/stockData';
import { canSeeOrders, missingPC, pcFail } from '@/lib/compras/pcServer';
import { suggestSuppliers } from '@/lib/compras/suggest';

export const dynamic = 'force-dynamic';

/** Fornecedores sugeridos para itens do estoque: ?items=<id>,<id> */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    if (!canSeeOrders(user)) throw new AccessError(403, 'Sem acesso.');
    const ids = (new URL(req.url).searchParams.get('items') ?? '').split(',').filter((x) => UUID_RE.test(x)).slice(0, 60);
    const hints = await suggestSuppliers(ids.map((id) => ({ key: id, item_id: id, name: '' })));
    return NextResponse.json({ hints });
  } catch (e) {
    if (missingPC(e)) return pcFail();
    return serverError(e);
  }
}
