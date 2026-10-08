import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { fail, readJson, serverError } from '@/lib/http';
import { rateLimit } from '@/lib/rateLimit';
import { getSector } from '@/lib/sectors';
import { currencyAnswer, currencyIn } from '@/lib/max/server/currency';
import { askLlm, llmConfigured } from '@/lib/max/server/llm';
import { isWeatherQuestion, weatherAnswer } from '@/lib/max/server/weather';
import { looksLikeQuestion, wikiAnswer } from '@/lib/max/server/wiki';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

/**
 * Segunda camada do cérebro da Max, usada só quando as habilidades locais não resolvem.
 * Ordem: clima → câmbio → IA opcional → Wikipédia. Tudo gratuito.
 * Exige login (na tela de entrada a Max responde só com o que é local), para ninguém
 * de fora usar o servidor da empresa como ponte para esses serviços.
 * Só a frase da pessoa sai daqui; nenhum dado do sistema é enviado a terceiros.
 */
export async function POST(req: Request) {
  const body = await readJson<{ text?: unknown; examples?: unknown; scope?: unknown; sector?: unknown }>(req);
  const text = String(body?.text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
  if (!text) return fail('Diga ou digite o pedido.');
  try {
    const user = await requireUser();
    const limit = rateLimit(`max:${user.id}`, 30, 60_000);
    if (!limit.ok) return NextResponse.json({ say: 'Muitos pedidos em sequência. Espere um instante e tente de novo.', source: 'limite' });

    if (isWeatherQuestion(text)) {
      const w = await weatherAnswer(text);
      if (w) return NextResponse.json({ ...w, source: 'clima' });
    }
    if (currencyIn(text)) {
      const c = await currencyAnswer(text);
      if (c) return NextResponse.json({ ...c, source: 'cambio' });
    }
    if (llmConfigured()) {
      const examples = Array.isArray(body?.examples)
        ? body.examples.filter((e): e is string => typeof e === 'string').map((e) => e.slice(0, 120)).slice(0, 40)
        : [];
      const sector = getSector(typeof body?.sector === 'string' ? body.sector : null);
      const ans = await askLlm(text, {
        userName: user.display_name,
        sectorName: sector?.name ?? null,
        scope: body?.scope === 'hub' ? 'hub' : 'sector',
        examples,
      });
      if (ans?.route) return NextResponse.json({ route: ans.route, source: 'ia' });
      if (ans?.say) return NextResponse.json({ say: ans.say, source: 'ia' });
    }
    if (looksLikeQuestion(text)) {
      const w = await wikiAnswer(text);
      if (w) return NextResponse.json({ ...w, source: 'wikipedia' });
    }
    return NextResponse.json({ source: 'nenhuma' });
  } catch (e) {
    return serverError(e);
  }
}
