import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE } from '@/lib/almoxarifado/stockData';
import { colabAccess } from '@/lib/pedidos/access';
import { missingP3, p3Fail } from '@/lib/pedidos/server';
import { todayBahia } from '@/lib/pedidos/types';
import { collabCols, dataOk, deslFail, itemDevolucao, itensEntregues, temDesligamento } from '@/lib/rh/desligamento';
import { DEV_COLS, MOTIVOS } from '@/lib/rh/devolucao';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** O que o colaborador recebeu, para conferir a devolução no desligamento. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Colaborador não encontrado.', 404);
  try {
    const user = await requireUser();
    if (!colabAccess(user)) throw new AccessError(403, 'Você não tem acesso aos colaboradores.');
    if (!(await temDesligamento())) return deslFail();
    const { data: c, error } = await db().from('collaborators').select('id, name').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!c) return fail('Colaborador não encontrado.', 404);
    const r = await itensEntregues(c as { id: string; name: string });
    return NextResponse.json({ ...r, motivos: MOTIVOS, hoje: todayBahia() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}

/**
 * Registra o desligamento: data, motivo, observação e a conferência de cada item
 * (devolvido / pendente / não devolvido). O cadastro fica inativo (sai dos alertas),
 * mas o histórico continua e as pendências seguem visíveis em "Devoluções".
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Colaborador não encontrado.', 404);
  const b = await readJson<{ date?: unknown; reason?: unknown; notes?: unknown; items?: unknown }>(req);
  if (!b) return fail('Dados inválidos.');
  const date = dataOk(b.date);
  if (!date) return fail('Informe a data do desligamento.');
  if (date > todayBahia()) return fail('A data do desligamento não pode ser no futuro.');
  const items = Array.isArray(b.items) ? (b.items as Record<string, unknown>[]) : [];
  if (items.length > 300) return fail('Itens demais na conferência.');
  try {
    const user = await requireUser();
    if (!colabAccess(user, 'edit')) throw new AccessError(403, 'Só o RH registra desligamentos.');
    if (!(await temDesligamento())) return deslFail();
    const cols = await collabCols();
    const { data: cur, error: e0 } = await db().from('collaborators').select(cols).eq('id', id).maybeSingle();
    if (e0) throw e0;
    if (!cur) return fail('Colaborador não encontrado.', 404);
    const c = cur as unknown as { name: string; active: boolean; posto_name: string | null; admitted_at: string | null };
    if (!c.active) return fail('Este colaborador já está desligado.', 409);
    if (c.admitted_at && date < c.admitted_at) return fail('A data do desligamento é anterior à admissão.');
    const rows: Record<string, unknown>[] = [];
    for (const x of items) {
      const r = itemDevolucao(x ?? {}, date);
      if ('error' in r) return fail(r.error);
      rows.push({
        ...r.row,
        collaborator_id: id,
        created_by: user.display_name,
        updated_by: user.display_name,
        history: [
          {
            at: new Date().toISOString(),
            by: user.display_name,
            what: `Conferido no desligamento: ${r.row.status === 'devolvido' ? `devolveu ${r.row.qty_returned}` : r.row.status === 'nao_devolvido' ? 'não devolvido' : 'pendente'}`,
          },
        ],
      });
    }
    let novos: string[] = [];
    if (rows.length) {
      const { data: ins, error } = await db().from('collaborator_returns').insert(rows).select('id');
      if (error) throw error;
      novos = (ins ?? []).map((x) => x.id as string);
    }
    // posto: se o cadastro não tem, fica o último posto da planilha de fardamento
    let posto = c.posto_name;
    if (!posto) posto = (await itensEntregues({ id, name: c.name })).postoPlanilha;
    const patch: Record<string, unknown> = {
      active: false,
      dismissed_at: date,
      dismissal_reason: typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim().slice(0, 80) : null,
      dismissal_notes: typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim().slice(0, 500) : null,
      dismissed_by: user.display_name,
      updated_at: new Date().toISOString(),
    };
    if (posto && !c.posto_name) patch.posto_name = posto;
    const { data, error } = await db().from('collaborators').update(patch).eq('id', id).select(cols).maybeSingle();
    if (error) {
      // não deixa a conferência solta se o cadastro não foi atualizado
      if (novos.length) await db().from('collaborator_returns').delete().in('id', novos);
      throw error;
    }
    const { data: dev } = await db().from('collaborator_returns').select(DEV_COLS).eq('collaborator_id', id).order('created_at');
    await broadcast('collab:update', { by: user.display_name });
    return NextResponse.json({ collaborator: data, returns: dev ?? [] });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
