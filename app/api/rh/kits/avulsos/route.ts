import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { colabAccess } from '@/lib/pedidos/access';
import { AVULSOS_KEY, carregarAvulsos } from '@/lib/rh/avulsos';

export const dynamic = 'force-dynamic';

/** EPI extras (avulsos): fora do kit da função, cada entrega com o próprio vencimento. */
export async function GET() {
  try {
    const user = await requireUser();
    if (!colabAccess(user)) throw new AccessError(403, 'Você não tem acesso aos kits.');
    return NextResponse.json({ avulsos: await carregarAvulsos() });
  } catch (e) {
    return serverError(e);
  }
}

/** { items: [{ name, period_months }] } substitui a lista */
export async function PUT(req: Request) {
  const b = await readJson<{ items?: unknown }>(req);
  if (!b || !Array.isArray(b.items)) return fail('Dados inválidos.');
  if (b.items.length > 100) return fail('No máximo 100 itens avulsos.');
  const items: { name: string; period_months: number }[] = [];
  const seen = new Set<string>();
  for (const [n, x] of b.items.entries()) {
    const o = (x ?? {}) as Record<string, unknown>;
    const name = String(o.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!name) continue;
    const pm = Number(o.period_months);
    if (!Number.isInteger(pm) || pm < 1 || pm > 60) return fail(`Item ${n + 1}: o vencimento precisa ser entre 1 e 60 meses.`);
    if (seen.has(name.toLowerCase())) return fail(`"${name}" está repetido.`);
    seen.add(name.toLowerCase());
    items.push({ name, period_months: pm });
  }
  try {
    const user = await requireUser();
    if (!colabAccess(user, 'edit')) throw new AccessError(403, 'Só o RH altera os kits.');
    const { error } = await db().from('hub_meta').upsert({ key: AVULSOS_KEY, value: { items, updated_by: user.display_name, updated_at: new Date().toISOString() } }, { onConflict: 'key' });
    if (error) throw error;
    await broadcast('collab:update', { by: user.display_name });
    return NextResponse.json({ avulsos: items });
  } catch (e) {
    return serverError(e);
  }
}
