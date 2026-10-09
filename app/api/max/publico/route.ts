import { NextResponse } from 'next/server';
import { fail, readJson, serverError } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/rateLimit';
import { answerRemote, cleanExamples, cleanText } from '@/lib/max/server/answer';
import { BLOCKED_REPLY, isBlocked } from '@/lib/max/moderation';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

/**
 * A Max da TELA DE LOGIN respondendo livremente (clima, câmbio, IA, Wikipédia).
 * Esta rota é pública — quem ainda não entrou também conversa com ela —, então tem freios
 * para ninguém de fora gastar a cota da IA:
 *   - só aceita chamadas feitas pela própria página do Max Hub (mesma origem);
 *   - frases curtas; 12 pedidos por minuto e 150 por dia por endereço; 1.500 por dia no total.
 * Ela não tem acesso a NENHUM dado do sistema: só conversa.
 */
export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  let sameOrigin = false;
  try {
    sameOrigin = Boolean(origin && host && new URL(origin).host === host);
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin) return fail('Origem não permitida.', 403);

  const body = await readJson<{ text?: unknown; examples?: unknown }>(req);
  const text = cleanText(body?.text, 240);
  if (!text) return fail('Diga o pedido.');
  if (isBlocked(text)) return NextResponse.json({ say: BLOCKED_REPLY, source: 'ia' });
  try {
    const ip = clientKey(req);
    const minute = rateLimit(`pub:m:${ip}`, 12, 60_000);
    const day = rateLimit(`pub:d:${ip}`, 150, 24 * 60 * 60_000);
    const total = rateLimit('pub:total', 1500, 24 * 60 * 60_000);
    if (!minute.ok || !day.ok || !total.ok) {
      return NextResponse.json({ say: 'Preciso de uma pausa rápida. Fale comigo de novo daqui a pouco.', source: 'limite' });
    }
    const ans = await answerRemote(text, { userName: '', sectorName: null, scope: 'login', examples: cleanExamples(body?.examples) });
    return NextResponse.json(ans, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}
