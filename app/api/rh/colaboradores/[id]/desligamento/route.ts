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
    // primeiro o cadastro, e só se ainda estiver ativo: dois cliques (ou duas pessoas) não registram duas vezes
    const { data, error } = await db().from('collaborators').update(patch).eq('id', id).eq('active', true).select(cols).maybeSingle();
    if (error) throw error;
    if (!data) return fail('Este colaborador já está desligado.', 409);
    if (rows.length) {
      const { error: e1 } = await db().from('collaborator_returns').insert(rows);
      if (e1) {
        // a conferência não entrou: o cadastro volta como estava
        await db().from('collaborators').update({ active: true, dismissed_at: null, dismissal_reason: null, dismissal_notes: null, dismissed_by: null, posto_name: c.posto_name }).eq('id', id);
        throw e1;
      }
    }
    // pedidos de material ainda abertos para a pessoa: a tela avisa para cancelar ou concluir
    const { data: abertos } = await db().from('material_orders').select('number, origin, stage').eq('collaborator_id', id).in('stage', ['solicitado', 'validacao', 'encaminhado']).limit(50);
    const { data: dev } = await db().from('collaborator_returns').select(DEV_COLS).eq('collaborator_id', id).order('created_at');
    await broadcast('collab:update', { by: user.display_name });
    return NextResponse.json({ collaborator: data, returns: dev ?? [], pedidosAbertos: (abertos ?? []).map((o) => Number(o.number)) });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
