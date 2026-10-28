import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE } from '@/lib/almoxarifado/stockData';
import { colabAccess } from '@/lib/pedidos/access';
import { missingP3, p3Fail } from '@/lib/pedidos/server';
import { todayBahia } from '@/lib/pedidos/types';
import { deslFail, desligados, itemDevolucao, temDesligamento } from '@/lib/rh/desligamento';
import { DEV_COLS } from '@/lib/rh/devolucao';

export const dynamic = 'force-dynamic';

/** Desligados e a devolução de cada um (?pendentes=1 só quem ainda deve itens). */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    if (!colabAccess(user)) throw new AccessError(403, 'Você não tem acesso aos colaboradores.');
    if (!(await temDesligamento())) return deslFail();
    const q = new URL(req.url).searchParams;
    const lista = await desligados({ pendentes: q.get('pendentes') === '1' });
    return NextResponse.json({ desligados: lista }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}

/** Inclui um item na conferência de um colaborador já desligado (ex.: crachá, rádio). */
export async function POST(req: Request) {
  const b = await readJson<Record<string, unknown>>(req);
  if (!b || typeof b.collaborator_id !== 'string' || !UUID_RE.test(b.collaborator_id)) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!colabAccess(user, 'edit')) throw new AccessError(403, 'Só o RH registra devoluções.');
    if (!(await temDesligamento())) return deslFail();
    const { data: c } = await db().from('collaborators').select('id, active, dismissed_at').eq('id', b.collaborator_id).maybeSingle();
    if (!c) return fail('Colaborador não encontrado.', 404);
    if (c.active) return fail('A conferência da devolução é feita no desligamento. Este colaborador está ativo.', 409);
    const r = itemDevolucao({ ...b, source: 'manual' }, todayBahia());
    if ('error' in r) return fail(r.error);
    const { data, error } = await db()
      .from('collaborator_returns')
      .insert({ ...r.row, collaborator_id: c.id, created_by: user.display_name, updated_by: user.display_name, history: [{ at: new Date().toISOString(), by: user.display_name, what: 'Item incluído na conferência' }] })
      .select(DEV_COLS)
      .single();
    if (error) throw error;
    await broadcast('collab:update', { by: user.display_name });
    return NextResponse.json({ item: data });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
