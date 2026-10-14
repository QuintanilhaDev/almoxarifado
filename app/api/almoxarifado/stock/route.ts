import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireAlmox } from '@/lib/access';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { isMissingColumn } from '@/lib/auth';
import { MISSING_CATEGORIES_SQL, cleanCategories } from '@/lib/almoxarifado/categories';
import { P3_SQL_MSG, catalogFields, dbMessage, intOrNull, loadItems, moneyOrNull, str } from '@/lib/almoxarifado/stockData';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAlmox(['estoque', 'postos', 'solicitacoes'], 'view');
    return NextResponse.json({ items: await loadItems() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}

/** Cadastra um item novo. */
export async function POST(req: Request) {
  const body = await readJson<Record<string, unknown>>(req);
  const name = str(body?.name, 160);
  if (!name) return fail('Dê um nome ao item.');
  const quantity = body?.quantity === '' || body?.quantity == null ? 0 : intOrNull(body.quantity);
  if (quantity === null) return fail('A quantidade precisa ser um número inteiro, zero ou maior.');
  const min = body?.min_quantity === '' || body?.min_quantity == null ? 0 : intOrNull(body.min_quantity);
  if (min === null) return fail('O estoque mínimo precisa ser um número inteiro, zero ou maior.');
  const cost = moneyOrNull(body?.cost);
  if (body?.cost !== '' && body?.cost != null && cost === null) return fail('Custo inválido.');
  const categories = cleanCategories(body?.categories);
  const cf = catalogFields(body ?? {});
  if ('error' in cf) return fail(cf.error);
  const cat = typeof body?.cat_code === 'string' && /^\d{2}$/.test(body.cat_code) ? body.cat_code : null;
  const grp = typeof body?.grp_code === 'string' && /^\d{2}$/.test(body.grp_code) ? body.grp_code : null;
  try {
    const admin = await requireAlmox('estoque', 'edit');
    const { data, error } = await db()
      .from('stock_items')
      .insert({
        name,
        size: str(body?.size, 40),
        unit: str(body?.unit, 20) ?? 'Cada',
        quantity,
        min_quantity: min,
        cost,
        ...(categories.length ? { categories } : {}),
        ...cf.patch,
        created_by: admin.display_name,
      })
      .select('id, name, size')
      .single();
    if (error) {
      if (categories.length && isMissingColumn(error) && !Object.keys(cf.patch).length) return fail(MISSING_CATEGORIES_SQL, 409);
      if (isMissingColumn(error)) return fail(P3_SQL_MSG, 409);
      const m = dbMessage(error);
      if (m) return fail(error.code === '23505' ? 'Esse item (com esse tamanho) já está cadastrado.' : m, 409);
      throw error;
    }
    await db().from('stock_movements').insert({
      item_id: data.id,
      item_name: data.name + (data.size ? ` · ${data.size}` : ''),
      kind: 'criacao',
      quantity,
      before_qty: 0,
      after_qty: quantity,
      by_name: admin.display_name,
    });
    // código do catálogo na hora do cadastro (CC-GG-NNNN, automático)
    let code: string | null = null;
    if (cat && grp) {
      const r = await db().rpc('assign_item_code', { p_item: data.id, p_cat: cat, p_grp: grp });
      if (r.error) {
        const m = dbMessage(r.error);
        if (!m && !isMissingColumn(r.error) && r.error.code !== 'PGRST202') throw r.error;
      } else code = r.data as string;
    }
    await broadcast('stock:update', { by: admin.display_name });
    return NextResponse.json({ id: data.id, code });
  } catch (e) {
    return serverError(e);
  }
}
