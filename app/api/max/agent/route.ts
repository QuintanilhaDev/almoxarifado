import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { fail, readJson, serverError } from '@/lib/http';
import { rateLimit } from '@/lib/rateLimit';
import { BLOCKED_REPLY, isBlocked, redactSecrets } from '@/lib/max/moderation';
import { runAgent } from '@/lib/max/server/agent';
import { cleanExamples, cleanHint, cleanText } from '@/lib/max/server/answer';
import { place } from '@/lib/max/server/place';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * A Max como agente (exige login): a IA usa ferramentas para consultar e preparar ações no sistema
 * e para pesquisar na web. Alterações voltam como "pendentes": só são gravadas depois do "sim"
 * da pessoa, pelas rotas normais do sistema.
 */
export async function POST(req: Request) {
  const body = await readJson<{ text?: unknown; examples?: unknown; scope?: unknown; sector?: unknown; history?: unknown; hint?: unknown }>(req);
  const text = cleanText(body?.text);
  if (!text) return fail('Diga ou digite o pedido.');
  try {
    const user = await requireUser();
    if (isBlocked(text)) return NextResponse.json({ say: BLOCKED_REPLY, source: 'ia' });
    const limit = rateLimit(`agente:${user.id}`, 20, 60_000);
    if (!limit.ok) return NextResponse.json({ say: 'Muitos pedidos em sequência. Espere um instante e tente de novo.', source: 'limite' });
    const history = Array.isArray(body?.history)
      ? body.history
          .filter((h): h is { role: string; content: string } => Boolean(h) && typeof (h as { content?: unknown }).content === 'string')
          .slice(-6)
          // senhas de pedidos anteriores não voltam para a IA
          .map((h) => ({ role: h.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: redactSecrets(cleanText(h.content, 400)) }))
          .filter((h) => h.content && !isBlocked(h.content))
      : [];
    // tela/setor conferidos com o acesso da pessoa (memória e anotações dependem disso)
    const { scope, sector } = place(user, body);
    const ans = await runAgent(user, { text, scope, sector, examples: cleanExamples(body?.examples), history, hint: cleanHint(body?.hint) });
    return NextResponse.json(ans, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}
