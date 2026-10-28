import { NextResponse } from 'next/server';
import { fetchAll } from '@/lib/almoxarifado/stockData';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE } from '@/lib/almoxarifado/stockData';
import { almoxOrders, colabAccess, opOrders, rhOrders } from '@/lib/pedidos/access';
import { ORDER_COLS, missingP3, p3Fail, toOrder } from '@/lib/pedidos/server';
import { collabFields } from '@/lib/pedidos/rh';
import { collabCols, temDesligamento } from '@/lib/rh/desligamento';
import { ARQUIVADO, DEV_COLS } from '@/lib/rh/devolucao';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Ficha do colaborador: dados, tudo o que recebeu (termos), os pedidos e, se desligado, a devolução. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Colaborador não encontrado.', 404);
  try {
    const user = await requireUser();
    if (!colabAccess(user) && !rhOrders(user) && !opOrders(user) && !almoxOrders(user)) throw new AccessError(403, 'Você não tem acesso aos colaboradores.');
    const desl = await temDesligamento();
    const [c, d, o, r] = await Promise.all([
      db()
        .from('collaborators')
        .select(await collabCols())
        .eq('id', id)
        .maybeSingle(),
      db()
        .from('deliveries')
        .select('id, group_id, order_number, kind, item_name, size, item_code, ca_number, qty, returned_qty, receiver, by_name, delivered_at')
        .eq('collaborator_id', id)
        .order('delivered_at', { ascending: false })
        .limit(500),
      db().from('material_orders').select(ORDER_COLS).eq('collaborator_id', id).order('created_at', { ascending: false }).limit(100),
      desl ? db().from('collaborator_returns').select(DEV_COLS).eq('collaborator_id', id).order('created_at').limit(500) : Promise.resolve({ data: null, error: null }),
    ]);
    if (c.error) throw c.error;
    if (!c.data) return fail('Colaborador não encontrado.', 404);
    return NextResponse.json({ collaborator: c.data, deliveries: d.data ?? [], orders: (o.data ?? []).map((x) => toOrder(x as Record<string, unknown>)), returns: r.data ?? [], desligamento: desl });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Colaborador não encontrado.', 404);
  const b = await readJson<Record<string, unknown>>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!colabAccess(user, 'edit')) throw new AccessError(403, 'Só o RH altera o cadastro dos colaboradores.');
    const desl = await temDesligamento();
    const cols = await collabCols();
    const { data: cur, error: e0 } = await db().from('collaborators').select(cols).eq('id', id).maybeSingle();
    if (e0) throw e0;
    if (!cur) return fail('Colaborador não encontrado.', 404);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (Object.keys(b).some((k) => k !== 'active')) {
      const postos = await fetchAll<{ id: string; name: string }>('postos', 'id, name', { column: 'id' });
      const atual = { ...(cur as unknown as Record<string, unknown>) };
      // trocou o nome do posto sem escolher outro da lista: o posto antigo não pode "voltar"
      if ('posto_name' in b && !('posto_id' in b)) atual.posto_id = null;
      const r = collabFields({ ...atual, ...b, sizes: b.sizes ?? atual.sizes }, (postos ?? []) as { id: string; name: string }[]);
      if ('error' in r) return fail(r.error);
      if (!desl) delete r.row.client;
      Object.assign(patch, r.row);
    }
    if ('active' in b) {
      patch.active = b.active !== false;
      // com o desligamento ativado, sair da empresa passa pela conferência da devolução
      if (desl && !patch.active && (cur as unknown as { active: boolean }).active) return fail('Use "Registrar desligamento" na ficha: ele confere a devolução do fardamento.', 409);
      // reativado: sai da lista de desligados (as devoluções registradas ficam no histórico)
      if (desl && patch.active) Object.assign(patch, { dismissed_at: null, dismissal_reason: null, dismissal_notes: null, dismissed_by: null });
    }
    const { data, error } = await db().from('collaborators').update(patch).eq('id', id).select(cols).maybeSingle();
    if (error) {
      if (error.code === '23505') return fail('Já existe outro colaborador com essa matrícula.', 409);
      throw error;
    }
    // reativado: a conferência do desligamento anterior vai para o histórico (não conta mais como pendente)
    if (desl && 'active' in b && patch.active && !(cur as unknown as { active: boolean }).active) {
      const { data: rs } = await db().from('collaborator_returns').select('id, history').eq('collaborator_id', id).limit(1000);
      const quando = new Date().toISOString();
      for (const r of rs ?? []) {
        const h = Array.isArray(r.history) ? r.history : [];
        if (h.some((x: { what?: string }) => String(x?.what ?? '').startsWith(ARQUIVADO))) continue;
        await db().from('collaborator_returns').update({ history: [...h, { at: quando, by: user.display_name, what: `${ARQUIVADO}: colaborador reativado` }] }).eq('id', r.id);
      }
    }
    await broadcast('collab:update', { by: user.display_name });
    return NextResponse.json({ collaborator: data });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
