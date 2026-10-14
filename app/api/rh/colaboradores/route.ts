import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { rateLimit } from '@/lib/rateLimit';
import { almoxOrders, colabAccess, opOrders, rhOrders } from '@/lib/pedidos/access';
import { missingP3, p3Fail } from '@/lib/pedidos/server';
import { COLLAB_COLS, collabFields } from '@/lib/pedidos/rh';

export const dynamic = 'force-dynamic';

/** Cadastro de colaboradores. Leitura: RH, Operação e Almoxarifado (para pedidos e entregas). */
export async function GET() {
  try {
    const user = await requireUser();
    if (!colabAccess(user) && !rhOrders(user) && !opOrders(user) && !almoxOrders(user)) throw new AccessError(403, 'Você não tem acesso aos colaboradores.');
    const { data, error } = await db().from('collaborators').select(COLLAB_COLS).order('name').limit(10000);
    if (error) throw error;
    return NextResponse.json({ collaborators: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}

type Row = Record<string, unknown>;

/** Novo colaborador, ou importação da planilha ({ rows: [...] }, atualiza pela matrícula). */
export async function POST(req: Request) {
  const b = await readJson<Row & { rows?: unknown }>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!colabAccess(user, 'edit')) throw new AccessError(403, 'Só o RH cadastra colaboradores.');
    if (!rateLimit(`colab:${user.id}`, 30, 60_000).ok) return fail('Muitas alterações em sequência. Espere um instante.', 429);
    const { data: postos } = await db().from('postos').select('id, name').limit(2000);
    const ps = (postos ?? []) as { id: string; name: string }[];

    if (Array.isArray(b.rows)) {
      if (b.rows.length > 3000) return fail('No máximo 3000 linhas por planilha.');
      const errors: string[] = [];
      let created = 0;
      let updated = 0;
      const { data: existing } = await db().from('collaborators').select('id, matricula, name_key').limit(20000);
      const byMat = new Map((existing ?? []).filter((e) => e.matricula).map((e) => [String(e.matricula), e.id as string]));
      // separa: quem já existe (mesma matrícula) é atualizado; o resto entra de uma vez, em lotes
      const fresh: { n: number; row: Row }[] = [];
      const seen = new Map<string, number>();
      for (const [n, raw] of (b.rows as Row[]).entries()) {
        const r = collabFields(raw ?? {}, ps);
        if ('error' in r) {
          errors.push(`Linha ${n + 2}: ${r.error}`);
          continue;
        }
        const mat = r.row.matricula ? String(r.row.matricula) : null;
        const id = mat ? byMat.get(mat) : undefined;
        if (id) {
          // só atualiza o que veio preenchido na planilha
          const patch: Row = { updated_at: new Date().toISOString() };
          for (const [k, v] of Object.entries(r.row)) if (v !== null && v !== undefined && !(k === 'sizes' && !Object.keys(v as object).length)) patch[k] = v;
          const { error } = await db().from('collaborators').update(patch).eq('id', id);
          if (error) errors.push(`Linha ${n + 2}: ${error.message}`);
          else updated++;
          continue;
        }
        if (mat && seen.has(mat)) {
          errors.push(`Linha ${n + 2}: matrícula ${mat} repetida na planilha (linha ${seen.get(mat)! + 2})`);
          continue;
        }
        if (mat) seen.set(mat, n);
        fresh.push({ n, row: { ...r.row, created_by: user.display_name } });
      }
      for (let i = 0; i < fresh.length; i += 500) {
        const chunk = fresh.slice(i, i + 500);
        const { error } = await db().from('collaborators').insert(chunk.map((c) => c.row));
        if (!error) {
          created += chunk.length;
          continue;
        }
        // lote recusado (ex.: matrícula que já existe): tenta um por um para salvar o resto
        for (const c of chunk) {
          const { error: e1 } = await db().from('collaborators').insert(c.row);
          if (e1) errors.push(`Linha ${c.n + 2}: ${e1.code === '23505' ? 'matrícula repetida' : e1.message}`);
          else created++;
        }
      }
      await broadcast('collab:update', { by: user.display_name });
      return NextResponse.json({ created, updated, errors: errors.slice(0, 50) });
    }

    const r = collabFields(b, ps);
    if ('error' in r) return fail(r.error);
    const { data, error } = await db().from('collaborators').insert({ ...r.row, created_by: user.display_name }).select(COLLAB_COLS).single();
    if (error) {
      if (error.code === '23505') return fail('Já existe um colaborador com essa matrícula.', 409);
      throw error;
    }
    await broadcast('collab:update', { by: user.display_name });
    return NextResponse.json({ collaborator: data });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
