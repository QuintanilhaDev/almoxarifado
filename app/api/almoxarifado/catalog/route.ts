import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireAlmox } from '@/lib/access';
import { fail, readJson, serverError } from '@/lib/http';
import { str } from '@/lib/almoxarifado/stockData';
import { CATEGORIES } from '@/lib/catalog';
import { missingP3, p3Fail } from '@/lib/pedidos/server';

export const dynamic = 'force-dynamic';

/** Grupos do catálogo (CC-GG). */
export async function GET() {
  try {
    await requireAlmox(['estoque', 'pedidos', 'notas', 'compras'], 'view');
    const { data, error } = await db().from('catalog_groups').select('cat, grp, name').order('cat').order('grp');
    if (error) {
      if (missingP3(error)) return NextResponse.json({ categories: CATEGORIES, groups: [], ready: false });
      throw error;
    }
    return NextResponse.json({ categories: CATEGORIES, groups: data ?? [], ready: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}

/** Novo grupo numa categoria (o número é o próximo livre). */
export async function POST(req: Request) {
  const b = await readJson<{ cat?: unknown; name?: unknown }>(req);
  const cat = String(b?.cat ?? '');
  const name = str(b?.name, 60);
  if (!CATEGORIES.some((c) => c.cat === cat)) return fail('Categoria inválida.');
  if (!name) return fail('Dê um nome ao grupo.');
  try {
    await requireAlmox('estoque', 'edit');
    const { data: g, error } = await db().from('catalog_groups').select('grp, name').eq('cat', cat);
    if (error) {
      if (missingP3(error)) return p3Fail();
      throw error;
    }
    if ((g ?? []).some((x) => String(x.name).toLowerCase() === name.toLowerCase())) return fail('Já existe um grupo com esse nome nesta categoria.', 409);
    const next = Math.max(0, ...(g ?? []).map((x) => Number(x.grp))) + 1;
    if (next > 99) return fail('Esta categoria chegou ao limite de 99 grupos.', 409);
    const grp = String(next).padStart(2, '0');
    const { error: e2 } = await db().from('catalog_groups').insert({ cat, grp, name });
    if (e2) throw e2;
    return NextResponse.json({ cat, grp, name });
  } catch (e) {
    return serverError(e);
  }
}
