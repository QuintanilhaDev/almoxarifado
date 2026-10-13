import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireAlmox } from '@/lib/access';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { canManageSector } from '@/lib/permissions';
import { UUID_RE, intOrNull, str } from '@/lib/almoxarifado/stockData';
import { dbRule, missingP3, p3Fail } from '@/lib/pedidos/server';

export const dynamic = 'force-dynamic';

/** Aplica a contagem física: só os itens que divergiram mudam, cada um com movimento de inventário. */
export async function POST(req: Request) {
  const b = await readJson<{ lines?: unknown; note?: unknown }>(req);
  if (!Array.isArray(b?.lines) || !b.lines.length) return fail('Nenhuma contagem informada.');
  if (b.lines.length > 5000) return fail('Contagem grande demais de uma vez.');
  const lines: { item_id: string; counted: number }[] = [];
  for (const x of b.lines as Record<string, unknown>[]) {
    const counted = intOrNull(x?.counted);
    if (typeof x?.item_id !== 'string' || !UUID_RE.test(x.item_id) || counted === null) return fail('Contagem inválida.');
    lines.push({ item_id: x.item_id, counted });
  }
  try {
    const admin = await requireAlmox('estoque', 'edit');
    // aprovação do ajuste de inventário: master do setor (Projeto 3, seção 8)
    if (!canManageSector(admin, 'almoxarifado')) return fail('Ajustes de inventário precisam da aprovação do master do Almoxarifado.', 403);
    const { data, error } = await db().rpc('inventory_apply', { p_lines: lines, p_note: str(b?.note, 200) ?? 'Ajuste de inventário', p_by: admin.display_name });
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
