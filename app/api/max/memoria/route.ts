import { NextResponse } from 'next/server';
import { requireMaster, requireUser } from '@/lib/access';
import { fail, readJson, serverError } from '@/lib/http';
import { canManageSector, canOpenSector, type HubUser } from '@/lib/permissions';
import { rateLimit } from '@/lib/rateLimit';
import { getSector } from '@/lib/sectors';
import { isBlocked } from '@/lib/max/moderation';
import { cleanText } from '@/lib/max/server/answer';
import { addNote, allLearned, allNotes, feedback, forget, learnedFor, logMiss, memoryEnabled, recentMisses, trusted } from '@/lib/max/server/memory';

export const dynamic = 'force-dynamic';

const SETUP = 'O aprendizado da Max ainda não foi ativado no banco. Rode o arquivo supabase/max_aprendizado.sql no SQL Editor do Supabase.';

/** Tela/setor que a pessoa realmente pode usar (nunca confia no que o navegador manda). */
function place(user: HubUser, body: { scope?: unknown; sector?: unknown } | null) {
  const scope = body?.scope === 'hub' && user.is_master ? 'hub' : 'sector';
  const def = getSector(typeof body?.sector === 'string' ? body.sector : null);
  const sector = scope === 'hub' ? null : def && canOpenSector(user, def.slug) ? def.slug : (user.sector ?? null);
  return { scope, sector };
}

/**
 * GET            → comandos que a Max já aprendeu nesta tela (para responder na hora, sem IA).
 * GET ?painel=1  → (master) tudo: aprendidos, anotações e pedidos não atendidos.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get('painel')) {
      await requireMaster();
      const [learned, notes, misses] = await Promise.all([allLearned(), allNotes(), recentMisses()]);
      return NextResponse.json(
        { enabled: memoryEnabled(), learned: learned.map((l) => ({ ...l, trusted: trusted(l) })), notes, misses },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const user = await requireUser();
    const { scope, sector } = place(user, { scope: url.searchParams.get('scope'), sector: url.searchParams.get('sector') });
    const rows = await learnedFor(scope, sector);
    return NextResponse.json(
      { enabled: memoryEnabled(), learned: rows.filter((r) => r.route).slice(0, 300).map((r) => ({ phrase: r.phrase, route: r.route })) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return serverError(e);
  }
}

/** Retorno de quem usa (👍/👎), pedido não entendido, ou anotação nova (depois do "sim"). */
export async function POST(req: Request) {
  const body = await readJson<{ type?: unknown; phrase?: unknown; good?: unknown; reason?: unknown; answer?: unknown; text?: unknown; scope?: unknown; sector?: unknown }>(req);
  if (!body) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!rateLimit(`memoria:${user.id}`, 40, 60_000).ok) return fail('Muitos pedidos em sequência.', 429);
    const { scope, sector } = place(user, body);

    if (body.type === 'nota') {
      const text = cleanText(body.text, 240);
      if (text.length < 8) return fail('Diga o que é para eu lembrar.');
      if (isBlocked(text)) return fail('Não posso guardar esse tipo de conteúdo.');
      const def = getSector(typeof body.sector === 'string' ? body.sector : null);
      // anotação geral: só master geral · anotação do setor: master do setor
      if (!def && !user.is_master) return fail('Só um usuário master pode ensinar algo para todos os setores.', 403);
      if (def && !canManageSector(user, def.slug)) return fail('Só o master do setor pode me ensinar anotações.', 403);
      const r = await addNote(text, def?.slug ?? null, user.display_name);
      if (r === 'off') return fail(SETUP, 409);
      if (r === 'full') return fail('Minha memória de anotações está cheia (60). Apague alguma no painel master.', 409);
      return NextResponse.json({ ok: true });
    }

    const phrase = cleanText(body.phrase, 300);
    if (!phrase || isBlocked(phrase)) return NextResponse.json({ ok: true });
    const answer = cleanText(body.answer, 300) || null;
    if (body.type === 'feedback') {
      const good = body.good === true;
      const known = await feedback(scope, sector, phrase, good);
      if (!good) await logMiss({ phrase, scope, sector, reason: 'negativo', answer, user: user.display_name });
      return NextResponse.json({ ok: true, known });
    }
    if (body.type === 'falha') {
      const reason = body.reason === 'desistiu' ? 'desistiu' : 'nao_entendeu';
      await logMiss({ phrase, scope, sector, reason, answer, user: user.display_name });
      return NextResponse.json({ ok: true });
    }
    return fail('Tipo inválido.');
  } catch (e) {
    return serverError(e);
  }
}

/** (master) apaga um aprendizado, uma anotação ou um registro de pedido não atendido. */
export async function DELETE(req: Request) {
  const body = await readJson<{ kind?: unknown; id?: unknown }>(req);
  const kind = body?.kind === 'aprendido' || body?.kind === 'nota' || body?.kind === 'falha' ? body.kind : null;
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!kind || !(id === 'todas' || /^[0-9a-f-]{36}$/i.test(id))) return fail('Dados inválidos.');
  try {
    await requireMaster();
    const ok = await forget(kind, id as string);
    return ok ? NextResponse.json({ ok: true }) : fail(SETUP, 409);
  } catch (e) {
    return serverError(e);
  }
}
