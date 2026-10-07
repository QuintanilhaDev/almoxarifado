import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { currentAdmin, unauthorized } from '@/lib/auth';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE, dbMessage, intOrNull, str } from '@/lib/stockData';

export const dynamic = 'force-dynamic';

const KINDS = ['entrada', 'saida', 'ajuste', 'transferencia', 'devolucao', 'baixa_posto'];
const NEEDS_POSTO = ['transferencia', 'devolucao', 'baixa_posto'];

/**
 * Movimenta UM item. Para "ajuste", `quantity` é o novo saldo do almoxarifado.
 * Para os demais, é a quantidade movimentada (sempre maior que zero).
 */
export async function POST(req: Request) {
  const body = await readJson<{ item_id?: string; kind?: string; quantity?: unknown; posto_id?: string; note?: string }>(req);
  const kind = String(body?.kind || '');
  if (!KINDS.includes(kind)) return fail('Tipo de movimentação inválido.');
  if (!body?.item_id || !UUID_RE.test(body.item_id)) return fail('Item não encontrado.', 404);
  const qty = intOrNull(body.quantity);
  if (qty === null) return fail('Informe a quantidade (número inteiro).');
  if (kind !== 'ajuste' && qty < 1) return fail('Informe uma quantidade maior que zero.');
  let posto: string | null = null;
  if (NEEDS_POSTO.includes(kind)) {
    if (!body.posto_id || !UUID_RE.test(body.posto_id)) return fail('Escolha o posto.');
    posto = body.posto_id;
  }
  try {
    const admin = await currentAdmin();
    if (!admin) return unauthorized();
    const { data, error } = await db().rpc('stock_move', {
      p_item: body.item_id,
      p_kind: kind,
      p_qty: qty,
      p_posto: posto,
      p_note: str(body.note, 200),
      p_by: admin.display_name,
    });
    if (error) {
      const m = dbMessage(error);
      if (m) return fail(m, 400);
      throw error;
    }
    await broadcast('stock:update', { by: admin.display_name });
    if (posto) await broadcast('postos:update', { by: admin.display_name });
    return NextResponse.json(data ?? { ok: true });
  } catch (e) {
    return serverError(e);
  }
}
