import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE, loadItems, str } from '@/lib/almoxarifado/stockData';
import { almoxOrders, colabAccess, rhOrders } from '@/lib/pedidos/access';
import { missingP3, p3Fail } from '@/lib/pedidos/server';
import { cleanSizes, kitFor, kitLines, loadKits, type KitItem, type SizeField } from '@/lib/pedidos/rh';

export const dynamic = 'force-dynamic';

/**
 * Kits por função (o que cada função recebe e de quanto em quanto tempo troca).
 * ?role=Vigilante&camisa=G&calca=44&calcado=42 devolve as linhas prontas do pedido.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    if (!colabAccess(user) && !rhOrders(user) && !almoxOrders(user)) throw new AccessError(403, 'Você não tem acesso aos kits.');
    const kits = await loadKits();
    const sp = new URL(req.url).searchParams;
    const role = sp.get('role');
    if (role !== null) {
      const kit = kitFor(kits, role);
      if (!kit) return NextResponse.json({ kit: null, lines: [] });
      const sizes = cleanSizes({ camisa: sp.get('camisa'), calca: sp.get('calca'), calcado: sp.get('calcado') });
      return NextResponse.json({ kit, lines: kitLines(kit, sizes, await loadItems()) });
    }
    return NextResponse.json({ kits });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}

const FIELDS: SizeField[] = ['camisa', 'calca', 'calcado'];

/** Cria ou altera o kit de uma função. */
export async function PUT(req: Request) {
  const b = await readJson<{ role?: unknown; items?: unknown; period_months?: unknown; old_role?: unknown }>(req);
  if (!b) return fail('Dados inválidos.');
  const role = str(b.role, 80);
  if (!role) return fail('Informe a função.');
  const months = Number(b.period_months ?? 12);
  if (!Number.isInteger(months) || months < 1 || months > 60) return fail('A troca precisa ser entre 1 e 60 meses.');
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 30) return fail('Adicione de 1 a 30 itens ao kit.');
  const items: KitItem[] = [];
  for (const [n, x] of (b.items as Record<string, unknown>[]).entries()) {
    const name = str(x?.name, 160);
    const qty = Number(x?.qty);
    if (!name) return fail(`Item ${n + 1}: informe o nome.`);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) return fail(`Item ${n + 1}: quantidade entre 1 e 50.`);
    const sf = FIELDS.includes(x?.size_from as SizeField) ? (x.size_from as SizeField) : null;
    const item_id = typeof x?.item_id === 'string' && UUID_RE.test(x.item_id) ? x.item_id : null;
    items.push({ name, qty, size_from: sf, item_id });
  }
  try {
    const user = await requireUser();
    if (!colabAccess(user, 'edit')) throw new AccessError(403, 'Só o RH altera os kits por função.');
    const old = str(b.old_role, 80);
    if (old && old !== role) await db().from('role_kits').delete().eq('role', old);
    const { error } = await db().from('role_kits').upsert({ role, items, period_months: months, updated_by: user.display_name, updated_at: new Date().toISOString() }, { onConflict: 'role' });
    if (error) throw error;
    await broadcast('collab:update', { by: user.display_name });
    return NextResponse.json({ kits: await loadKits() });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}

export async function DELETE(req: Request) {
  const role = new URL(req.url).searchParams.get('role');
  if (!role) return fail('Informe a função.');
  try {
    const user = await requireUser();
    if (!colabAccess(user, 'edit')) throw new AccessError(403, 'Só o RH altera os kits por função.');
    const { error } = await db().from('role_kits').delete().eq('role', role);
    if (error) throw error;
    await broadcast('collab:update', { by: user.display_name });
    return NextResponse.json({ kits: await loadKits() });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
