import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { fail, readJson, serverError } from '@/lib/http';
import { rateLimit } from '@/lib/rateLimit';
import { getSector } from '@/lib/sectors';
import { answerRemote, cleanExamples, cleanText } from '@/lib/max/server/answer';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

/**
 * Segunda camada do cérebro da Max dentro das ferramentas (exige login).
 * Usada só quando as habilidades locais não resolvem: clima → câmbio → IA opcional → Wikipédia.
 * Só a frase da pessoa sai daqui; nenhum dado do sistema é enviado a terceiros.
 */
export async function POST(req: Request) {
  const body = await readJson<{ text?: unknown; examples?: unknown; scope?: unknown; sector?: unknown; mode?: unknown }>(req);
  const text = cleanText(body?.text);
  if (!text) return fail('Diga ou digite o pedido.');
  try {
    const user = await requireUser();
    const limit = rateLimit(`max:${user.id}`, 30, 60_000);
    if (!limit.ok) return NextResponse.json({ say: 'Muitos pedidos em sequência. Espere um instante e tente de novo.', source: 'limite' });
    const sector = getSector(typeof body?.sector === 'string' ? body.sector : null);
    const ans = await answerRemote(text, {
      userName: user.display_name,
      sectorName: sector?.name ?? null,
      scope: body?.scope === 'hub' ? 'hub' : 'sector',
      examples: cleanExamples(body?.examples),
      routeOnly: body?.mode === 'route',
    });
    return NextResponse.json(ans);
  } catch (e) {
    return serverError(e);
  }
}
