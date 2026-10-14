import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireAlmox } from '@/lib/access';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE, dbMessage, loadItems } from '@/lib/almoxarifado/stockData';
import { suggestClass } from '@/lib/catalog';
import { missingP3, p3Fail } from '@/lib/pedidos/server';

export const dynamic = 'force-dynamic';

/** Sugestão automática de categoria/grupo para todos os itens ainda sem código. */
export async function GET() {
  try {
    await requireAlmox('estoque', 'edit');
    const items = (await loadItems()).filter((i) => !i.code);
    return NextResponse.json({ items: items.map((i) => ({ id: i.id, name: i.name, size: i.size, ...suggestClass(i.name) })) });
  } catch (e) {
    return serverError(e);
  }
}

/** Grava os códigos confirmados (cada item recebe o próximo número do seu grupo). */
export async function POST(req: Request) {
  const b = await readJson<{ items?: unknown }>(req);
  if (!Array.isArray(b?.items) || !b.items.length) return fail('Nenhum item para classificar.');
  if (b.items.length > 2000) return fail('Itens demais de uma vez.');
  try {
    const admin = await requireAlmox('estoque', 'edit');
    let done = 0;
    const errors: string[] = [];
    for (const x of b.items as Record<string, unknown>[]) {
      const id = String(x?.id ?? '');
      const cat = String(x?.cat ?? '');
      const grp = String(x?.grp ?? '');
      if (!UUID_RE.test(id) || !/^\d{2}$/.test(cat) || !/^\d{2}$/.test(grp)) continue;
      const { error } = await db().rpc('assign_item_code', { p_item: id, p_cat: cat, p_grp: grp });
      if (error) {
        if (missingP3(error)) return p3Fail();
        errors.push(dbMessage(error) ?? 'erro');
      } else done++;
    }
    if (done) await broadcast('stock:update', { by: admin.display_name });
    return NextResponse.json({ done, errors: errors.slice(0, 10) });
  } catch (e) {
    return serverError(e);
  }
}
