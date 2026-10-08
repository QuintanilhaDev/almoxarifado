import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireAlmox } from '@/lib/access';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE, dbMessage, intOrNull, moneyOrNull, str } from '@/lib/almoxarifado/stockData';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Onde o item está (postos) e as últimas movimentações dele. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Item não encontrado.', 404);
  try {
    await requireAlmox(['estoque', 'postos'], 'view');
    const [lines, moves] = await Promise.all([
      db().from('posto_stock').select('quantity, postos(id, name)').eq('item_id', id),
      db().from('stock_movements').select('*').eq('item_id', id).order('created_at', { ascending: false }).limit(40),
    ]);
    if (lines.error) throw lines.error;
    if (moves.error) throw moves.error;
    const at_postos = (lines.data ?? [])
      .map((l) => {
        const p = (Array.isArray(l.postos) ? l.postos[0] : l.postos) as { id: string; name: string } | null;
        return { posto_id: p?.id ?? '', posto_name: p?.name ?? '—', quantity: l.quantity as number };
      })
      .sort((a, b) => a.posto_name.localeCompare(b.posto_name, 'pt-BR'));
    return NextResponse.json({ at_postos, movements: moves.data ?? [] });
  } catch (e) {
    return serverError(e);
  }
}

/** Edita os dados do item. O saldo muda só por movimentação (entrada, saída, ajuste). */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Item não encontrado.', 404);
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail('Dados inválidos.');
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ('name' in body) {
    const name = str(body.name, 160);
    if (!name) return fail('Dê um nome ao item.');
    patch.name = name;
  }
  if ('size' in body) patch.size = str(body.size, 40);
  if ('unit' in body) patch.unit = str(body.unit, 20) ?? 'Cada';
  if ('min_quantity' in body) {
    const m = body.min_quantity === '' || body.min_quantity == null ? 0 : intOrNull(body.min_quantity);
    if (m === null) return fail('O estoque mínimo precisa ser um número inteiro, zero ou maior.');
    patch.min_quantity = m;
  }
  if ('cost' in body) {
    const c = moneyOrNull(body.cost);
    if (body.cost !== '' && body.cost != null && c === null) return fail('Custo inválido.');
    patch.cost = c;
  }
  try {
    const admin = await requireAlmox('estoque', 'edit');
    const { data, error } = await db().from('stock_items').update(patch).eq('id', id).select('id').maybeSingle();
    if (error) {
      if (error.code === '23505') return fail('Já existe outro item com esse nome e tamanho.', 409);
      const m = dbMessage(error);
      if (m) return fail(m, 400);
      throw error;
    }
    if (!data) return fail('Item não encontrado.', 404);
    await broadcast('stock:update', { by: admin.display_name });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Item não encontrado.', 404);
  try {
    const admin = await requireAlmox('estoque', 'edit');
    const { data: item, error: e1 } = await db()
      .from('stock_items')
      .select('id, name, size, quantity')
      .eq('id', id)
      .maybeSingle();
    if (e1) throw e1;
    if (!item) return fail('Item não encontrado.', 404);
    const { data: lines } = await db().from('posto_stock').select('quantity').eq('item_id', id);
    const atPostos = (lines ?? []).reduce((a, l) => a + (l.quantity as number), 0);
    const { error: e2 } = await db().from('stock_items').delete().eq('id', id);
    if (e2) throw e2;
    await db().from('stock_movements').insert({
      item_id: null,
      item_name: item.name + (item.size ? ` · ${item.size}` : ''),
      kind: 'exclusao',
      quantity: (item.quantity as number) + atPostos,
      before_qty: item.quantity,
      after_qty: null,
      note: atPostos ? `Havia ${atPostos} nos postos` : null,
      by_name: admin.display_name,
    });
    await broadcast('stock:update', { by: admin.display_name });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
