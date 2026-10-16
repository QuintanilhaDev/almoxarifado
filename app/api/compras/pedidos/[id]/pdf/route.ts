import { requireUser } from '@/lib/access';
import { AccessError, fail, serverError } from '@/lib/http';
import { UUID_RE } from '@/lib/almoxarifado/stockData';
import { canSeeOrders, loadConfig, missingPC, pcFail } from '@/lib/compras/pcServer';
import { loadPO } from '@/lib/compras/poServer';
import { poPdf } from '@/lib/compras/pdf';
import { poLabel } from '@/lib/compras/pc';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** PDF do pedido de compra (para mandar ao fornecedor ou imprimir). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Pedido não encontrado.', 404);
  try {
    const user = await requireUser();
    if (!canSeeOrders(user)) throw new AccessError(403, 'Sem acesso aos pedidos de compra.');
    const o = await loadPO(id);
    if (!o) return fail('Pedido não encontrado.', 404);
    const buf = await poPdf(o, await loadConfig(), user.display_name);
    return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${poLabel(o.number).replace(' ', '-')}.pdf"` } });
  } catch (e) {
    if (missingPC(e)) return pcFail();
    return serverError(e);
  }
}
