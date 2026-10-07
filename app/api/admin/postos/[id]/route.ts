import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { currentAdmin, unauthorized } from '@/lib/auth';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE, dbMessage, str } from '@/lib/stockData';
import type { PostoStockLine } from '@/lib/types';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** O que há no posto (item a item). */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Posto não encontrado.', 404);
  try {
    if (!(await currentAdmin())) return unauthorized();
    const { data: posto, error: e1 } = await db().from('postos').select('id').eq('id', id).maybeSingle();
    if (e1) throw e1;
    if (!posto) return fail('Posto não encontrado.', 404);
    const { data, error } = await db()
      .from('posto_stock')
      .select('quantity, stock_items(id, name, size, unit)')
      .eq('posto_id', id)
      .limit(5000);
    if (error) throw error;
    const lines: PostoStockLine[] = (data ?? [])
      .map((l) => {
        const it = (Array.isArray(l.stock_items) ? l.stock_items[0] : l.stock_items) as {
          id: string;
          name: string;
          size: string | null;
          unit: string;
        } | null;
        return it ? { item_id: it.id, name: it.name, size: it.size, unit: it.unit, quantity: l.quantity as number } : null;
      })
      .filter((x): x is PostoStockLine => x !== null)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || (a.size ?? '').localeCompare(b.size ?? '', 'pt-BR', { numeric: true }));
    return NextResponse.json({ lines });
  } catch (e) {
    return serverError(e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Posto não encontrado.', 404);
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail('Dados inválidos.');
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ('name' in body) {
    const name = str(body.name, 120);
    if (!name) return fail('Dê um nome ao posto.');
    patch.name = name;
  }
  if ('code' in body) patch.code = str(body.code, 40);
  if ('city' in body) patch.city = str(body.city, 80);
  if ('address' in body) patch.address = str(body.address, 200);
  if ('supervisor' in body) patch.supervisor = str(body.supervisor, 120);
  if ('notes' in body) patch.notes = str(body.notes, 400);
  try {
    const admin = await currentAdmin();
    if (!admin) return unauthorized();
    const { data, error } = await db().from('postos').update(patch).eq('id', id).select('id').maybeSingle();
    if (error) {
      if (error.code === '23505') return fail('Já existe um posto com esse nome.', 409);
      throw error;
    }
    if (!data) return fail('Posto não encontrado.', 404);
    await broadcast('postos:update', { by: admin.display_name });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}

/** Remove o posto. O que estava nele volta para o almoxarifado (com histórico). */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Posto não encontrado.', 404);
  try {
    const admin = await currentAdmin();
    if (!admin) return unauthorized();
    const { data, error } = await db().rpc('remove_posto', { p_posto: id, p_by: admin.display_name });
    if (error) {
      const m = dbMessage(error);
      if (m) return fail(m, 404);
      throw error;
    }
    await broadcast('postos:update', { by: admin.display_name });
    await broadcast('stock:update', { by: admin.display_name });
    return NextResponse.json(data ?? { ok: true });
  } catch (e) {
    return serverError(e);
  }
}
