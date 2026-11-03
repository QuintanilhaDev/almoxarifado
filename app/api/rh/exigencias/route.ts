import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE } from '@/lib/almoxarifado/stockData';
import { colabAccess } from '@/lib/pedidos/access';
import { carregarExigencias, ctrlFail, REQ_COLS, temControle } from '@/lib/rh/controleServer';
import type { TipoExig } from '@/lib/rh/controle';

export const dynamic = 'force-dynamic';

/** Exigências (ASO, cursos, reciclagens, documentos): a quem se aplicam, validade e antecedência do alerta. */
export async function GET() {
  try {
    const user = await requireUser();
    if (!colabAccess(user)) throw new AccessError(403, 'Você não tem acesso aos colaboradores.');
    if (!(await temControle())) return ctrlFail();
    return NextResponse.json({ exigencias: await carregarExigencias() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}

const lista = (v: unknown) =>
  Array.isArray(v)
    ? [...new Set(v.map((x) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)).filter(Boolean))].slice(0, 200)
    : [];

function campos(b: Record<string, unknown>): { error: string } | { row: Record<string, unknown> } {
  const name = String(b.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!name) return { error: 'Informe o nome da exigência.' };
  const kind = (['aso', 'curso', 'documento'] as TipoExig[]).includes(b.kind as TipoExig) ? (b.kind as TipoExig) : 'curso';
  const validity = Number(b.validity_months);
  if (!Number.isInteger(validity) || validity < 1 || validity > 120) return { error: 'A validade precisa ser entre 1 e 120 meses.' };
  const alert = Number(b.alert_days ?? 60);
  if (!Number.isInteger(alert) || alert < 0 || alert > 365) return { error: 'O alerta precisa ser entre 0 e 365 dias antes.' };
  const notes = String(b.notes ?? '').trim().slice(0, 300) || null;
  return { row: { name, kind, validity_months: validity, alert_days: alert, roles: lista(b.roles), clients: lista(b.clients), companies: lista(b.companies), notes, active: b.active !== false } };
}

export async function POST(req: Request) {
  const b = await readJson<Record<string, unknown>>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!colabAccess(user, 'edit')) throw new AccessError(403, 'Só o RH cadastra exigências.');
    if (!(await temControle())) return ctrlFail();
    const r = campos(b);
    if ('error' in r) return fail(r.error);
    const { error } = await db().from('requirements').insert({ ...r.row, created_by: user.display_name, updated_by: user.display_name }).select(REQ_COLS).single();
    if (error) {
      if (error.code === '23505') return fail('Já existe uma exigência com esse nome.', 409);
      throw error;
    }
    await broadcast('collab:update', { by: user.display_name });
    return NextResponse.json({ exigencias: await carregarExigencias() });
  } catch (e) {
    return serverError(e);
  }
}

export async function PATCH(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!UUID_RE.test(id)) return fail('Exigência não encontrada.', 404);
  const b = await readJson<Record<string, unknown>>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!colabAccess(user, 'edit')) throw new AccessError(403, 'Só o RH altera exigências.');
    if (!(await temControle())) return ctrlFail();
    const r = campos(b);
    if ('error' in r) return fail(r.error);
    const { data, error } = await db().from('requirements').update({ ...r.row, updated_by: user.display_name, updated_at: new Date().toISOString() }).eq('id', id).select('id').maybeSingle();
    if (error) {
      if (error.code === '23505') return fail('Já existe uma exigência com esse nome.', 409);
      throw error;
    }
    if (!data) return fail('Exigência não encontrada.', 404);
    await broadcast('collab:update', { by: user.display_name });
    return NextResponse.json({ exigencias: await carregarExigencias() });
  } catch (e) {
    return serverError(e);
  }
}

/** Apaga só exigência sem nenhum registro; com registros, desative (o histórico fica). */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!UUID_RE.test(id)) return fail('Exigência não encontrada.', 404);
  try {
    const user = await requireUser();
    if (!colabAccess(user, 'edit')) throw new AccessError(403, 'Só o RH altera exigências.');
    if (!(await temControle())) return ctrlFail();
    const { count, error: e1 } = await db().from('collaborator_records').select('id', { count: 'exact', head: true }).eq('requirement_id', id);
    if (e1) throw e1;
    if (count) return fail(`Essa exigência tem ${count} registro(s) de colaboradores. Desative em vez de apagar, para manter o histórico.`, 409);
    const { error } = await db().from('requirements').delete().eq('id', id);
    if (error) throw error;
    await broadcast('collab:update', { by: user.display_name });
    return NextResponse.json({ exigencias: await carregarExigencias() });
  } catch (e) {
    return serverError(e);
  }
}
