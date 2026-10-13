import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireAlmox } from '@/lib/access';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE, intOrNull, str } from '@/lib/almoxarifado/stockData';
import { dbRule, missingP3, p3Fail } from '@/lib/pedidos/server';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Baixa por avaria, perda, descarte ou devolução ao fornecedor (com motivo, auditável). */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Item não encontrado.', 404);
  const b = await readJson<{ qty?: unknown; kind?: unknown; reason?: unknown; note_id?: unknown }>(req);
  const qty = intOrNull(b?.qty);
  if (!qty) return fail('Informe a quantidade.');
  const kind = b?.kind === 'devolucao_fornecedor' ? 'devolucao_fornecedor' : 'perda';
  const reason = str(b?.reason, 300);
  if (!reason) return fail('Diga o motivo da baixa.');
  try {
    const admin = await requireAlmox('estoque', 'edit');
    const { data, error } = await db().rpc('stock_writeoff', {
      p_item: id,
      p_qty: qty,
      p_kind: kind,
      p_reason: reason,
      p_note_id: typeof b?.note_id === 'string' && UUID_RE.test(b.note_id) ? b.note_id : null,
      p_by: admin.display_name,
    });
    if (error) throw error;
    await broadcast('stock:update', { by: admin.display_name });
    return NextResponse.json(data);
  } catch (e) {
    const rule = dbRule(e);
    if (rule) return fail(rule.message, 409);
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
