import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, serverError } from '@/lib/http';
import { UUID_RE } from '@/lib/almoxarifado/stockData';
import { canSeeOrders, loadConfig, missingPC, pcFail, toQuote } from '@/lib/compras/pcServer';
import { rfqEmail, rfqPdf } from '@/lib/compras/pdf';
import { quoteLabel } from '@/lib/compras/pc';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Solicitação de orçamento para um fornecedor da cotação:
 *  ?proposal=<id>             → PDF
 *  ?proposal=<id>&format=email → assunto, texto e e-mail do fornecedor (para abrir no programa de e-mail)
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Cotação não encontrada.', 404);
  try {
    const user = await requireUser();
    if (!canSeeOrders(user)) throw new AccessError(403, 'Sem acesso às cotações.');
    const { data } = await db().from('purchase_quotes').select('*').eq('id', id).maybeSingle();
    if (!data) return fail('Cotação não encontrada.', 404);
    const q = toQuote(data as Record<string, unknown>);
    const sp = new URL(req.url).searchParams;
    const p = q.proposals.find((x) => x.id === sp.get('proposal')) ?? null;
    const cfg = await loadConfig();
    if (sp.get('format') === 'email') {
      let to: string | null = null;
      if (p) {
        const { data: s } = await db().from('suppliers').select('email').eq('id', p.supplier_id).maybeSingle();
        to = (s?.email as string) ?? null;
      }
      return NextResponse.json({ to, ...rfqEmail(q, p, cfg, user.display_name) });
    }
    const buf = await rfqPdf(q, p, cfg, user.display_name);
    return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${quoteLabel(q.number).replace(' ', '-')}${p ? '-' + p.supplier_name.replace(/[^\w]+/g, '_').slice(0, 30) : ''}.pdf"` } });
  } catch (e) {
    if (missingPC(e)) return pcFail();
    return serverError(e);
  }
}
