import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { currentAdmin, unauthorized } from '@/lib/auth';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE, dbMessage, intOrNull, str } from '@/lib/stockData';

export const dynamic = 'force-dynamic';

/** Envia vários itens ao mesmo posto (tudo ou nada). */
export async function POST(req: Request) {
  const body = await readJson<{ posto_id?: string; lines?: { item_id?: string; quantity?: unknown }[]; note?: string; kind?: string }>(req);
  if (!body?.posto_id || !UUID_RE.test(body.posto_id)) return fail('Escolha o posto.');
  const kind = body.kind === 'devolucao' ? 'devolucao' : 'transferencia';
  if (!Array.isArray(body.lines) || body.lines.length === 0) return fail('Escolha pelo menos um item.');
  if (body.lines.length > 300) return fail('Envie no máximo 300 itens por vez.');
  const lines: { item_id: string; quantity: number }[] = [];
  for (const l of body.lines) {
    const q = intOrNull(l?.quantity);
    if (!l?.item_id || !UUID_RE.test(l.item_id) || q === null || q < 1) {
      return fail('Confira os itens: cada um precisa de uma quantidade maior que zero.');
    }
    lines.push({ item_id: l.item_id, quantity: q });
  }
  try {
    const admin = await currentAdmin();
    if (!admin) return unauthorized();
    const { data, error } = await db().rpc('stock_move_many', {
      p_kind: kind,
      p_posto: body.posto_id,
      p_lines: lines,
      p_note: str(body.note, 200),
      p_by: admin.display_name,
    });
    if (error) {
      const m = dbMessage(error);
      if (m) return fail(m, 400);
      throw error;
    }
    await broadcast('stock:update', { by: admin.display_name });
    await broadcast('postos:update', { by: admin.display_name });
    return NextResponse.json(data ?? { ok: true });
  } catch (e) {
    return serverError(e);
  }
}
