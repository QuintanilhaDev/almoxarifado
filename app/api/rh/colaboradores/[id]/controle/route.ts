import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE } from '@/lib/almoxarifado/stockData';
import { colabAccess } from '@/lib/pedidos/access';
import { missingP3, p3Fail } from '@/lib/pedidos/server';
import { todayBahia } from '@/lib/pedidos/types';
import { dataOk } from '@/lib/rh/desligamento';
import { controleDoColab, ctrlFail, temControle } from '@/lib/rh/controleServer';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Ficha do colaborador: cada peça do kit (entrega e troca), ASO, cursos e documentos, e o histórico. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Colaborador não encontrado.', 404);
  try {
    const user = await requireUser();
    if (!colabAccess(user)) throw new AccessError(403, 'Você não tem acesso aos colaboradores.');
    const r = await controleDoColab(id);
    if (!r) return fail('Colaborador não encontrado.', 404);
    return NextResponse.json({ ...r, temExigencias: await temControle(), hoje: todayBahia() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}

/** Registra a realização de um ASO, curso ou documento: { requirement_id, done_at, expires_at?, notes? } */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Colaborador não encontrado.', 404);
  const b = await readJson<Record<string, unknown>>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!colabAccess(user, 'edit')) throw new AccessError(403, 'Só o RH registra ASO e cursos.');
    if (!(await temControle())) return ctrlFail();
    const req_id = String(b.requirement_id ?? '');
    if (!UUID_RE.test(req_id)) return fail('Escolha a exigência.');
    const done = dataOk(b.done_at);
    if (!done) return fail('Informe a data de realização.');
    if (done > todayBahia()) return fail('A data de realização não pode ser no futuro.');
    const exp = b.expires_at ? dataOk(b.expires_at) : null;
    if (b.expires_at && !exp) return fail('Data de validade inválida.');
    if (exp && exp <= done) return fail('A validade precisa ser depois da data de realização.');
    const { data: r, error: e0 } = await db().from('requirements').select('id').eq('id', req_id).maybeSingle();
    if (e0) throw e0;
    if (!r) return fail('Exigência não encontrada.', 404);
    const { error } = await db().from('collaborator_records').insert({ collaborator_id: id, requirement_id: req_id, done_at: done, expires_at: exp, notes: String(b.notes ?? '').trim().slice(0, 300) || null, created_by: user.display_name });
    if (error) {
      if (error.code === '23503') return fail('Colaborador não encontrado.', 404);
      throw error;
    }
    await broadcast('collab:update', { by: user.display_name });
    const out = await controleDoColab(id);
    return NextResponse.json({ ...out, temExigencias: true, hoje: todayBahia() });
  } catch (e) {
    return serverError(e);
  }
}

/** Apaga um registro lançado por engano: ?registro=<id> */
export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const rid = new URL(req.url).searchParams.get('registro') ?? '';
  if (!UUID_RE.test(id) || !UUID_RE.test(rid)) return fail('Registro não encontrado.', 404);
  try {
    const user = await requireUser();
    if (!colabAccess(user, 'edit')) throw new AccessError(403, 'Só o RH altera os registros.');
    if (!(await temControle())) return ctrlFail();
    const { data, error } = await db().from('collaborator_records').delete().eq('id', rid).eq('collaborator_id', id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return fail('Registro não encontrado.', 404);
    await broadcast('collab:update', { by: user.display_name });
    const out = await controleDoColab(id);
    return NextResponse.json({ ...out, temExigencias: true, hoje: todayBahia() });
  } catch (e) {
    return serverError(e);
  }
}
