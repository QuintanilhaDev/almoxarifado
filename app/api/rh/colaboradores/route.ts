import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { rateLimit } from '@/lib/rateLimit';
import { almoxOrders, colabAccess, opOrders, rhOrders } from '@/lib/pedidos/access';
import { missingP3, p3Fail } from '@/lib/pedidos/server';
import { collabFields } from '@/lib/pedidos/rh';
import { collabCols, temDesligamento } from '@/lib/rh/desligamento';
import { fetchAll } from '@/lib/almoxarifado/stockData';

export const dynamic = 'force-dynamic';

/** Cadastro de colaboradores. Leitura: RH, Operação e Almoxarifado (para pedidos e entregas). */
export async function GET() {
  try {
    const user = await requireUser();
    if (!colabAccess(user) && !rhOrders(user) && !opOrders(user) && !almoxOrders(user)) throw new AccessError(403, 'Você não tem acesso aos colaboradores.');
    // em páginas: o banco devolve no máximo 1.000 linhas por consulta
    const data = await fetchAll('collaborators', await collabCols(), { column: 'name', tiebreak: 'id' });
    return NextResponse.json({ collaborators: data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}

type Row = Record<string, unknown>;

/** Novo colaborador, ou importação da planilha ({ rows: [...] }, atualiza pela matrícula ou, sem ela, pelo nome). */
export async function POST(req: Request) {
  const b = await readJson<Row & { rows?: unknown }>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!colabAccess(user, 'edit')) throw new AccessError(403, 'Só o RH cadastra colaboradores.');
    if (!rateLimit(`colab:${user.id}`, 30, 60_000).ok) return fail('Muitas alterações em sequência. Espere um instante.', 429);
    const postos = await fetchAll('postos', 'id, name', { column: 'id' });
    const ps = (postos ?? []) as { id: string; name: string }[];
    // sem o desligamento.sql ainda não existe a coluna do cliente
    const semCliente = !(await temDesligamento());

    if (Array.isArray(b.rows)) {
      if (b.rows.length > 5000) return fail('No máximo 5000 linhas por planilha.');
      const errors: string[] = [];
      let created = 0;
      let updated = 0;
      let unchanged = 0;
      // matrícula sem zeros à esquerda e sem pontuação: "00123" e "123" são a mesma pessoa
      const matKey = (v: unknown) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '') || String(v ?? '').trim();
      const existing = await fetchAll<Row>('collaborators', await collabCols(), { column: 'id' });
      const byMat = new Map(((existing ?? []) as unknown as Row[]).filter((e) => e.matricula).map((e) => [matKey(e.matricula), e]));
      // linha sem matrícula: acha pelo nome (como o name_key do banco), primeiro entre quem também não tem matrícula
      const nameKey = (v: unknown) => String(v ?? '').trim().toLowerCase();
      const semMat = new Map<string, Row[]>();
      const todos = new Map<string, Row[]>();
      for (const e of (existing ?? []) as unknown as Row[]) {
        const k = nameKey(e.name);
        todos.set(k, [...(todos.get(k) ?? []), e]);
        if (!e.matricula) semMat.set(k, [...(semMat.get(k) ?? []), e]);
      }
      const usados = new Set<string>();
      const porNome = (name: unknown): Row | undefined => {
        const k = nameKey(name);
        // homônimos sem matrícula: cada linha da planilha casa com um deles, na ordem
        const livre = (semMat.get(k) ?? []).find((e) => !usados.has(String(e.id)));
        if (livre) return livre;
        const t = todos.get(k) ?? [];
        return t.length === 1 && !usados.has(String(t[0].id)) ? t[0] : undefined;
      };
      // separa: quem já existe (mesma matrícula) é atualizado só no que mudou; o resto entra em lotes
      const fresh: { n: number; nome: string; row: Row }[] = [];
      const patches: { nome: string; id: string; patch: Row }[] = [];
      const seen = new Map<string, string>();
      const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
      for (const [n, raw] of (b.rows as Row[]).entries()) {
        const r = collabFields(raw ?? {}, ps);
        const nome = String((raw ?? {}).name ?? (raw ?? {}).nome ?? `linha ${n + 1}`);
        if ('error' in r) {
          errors.push(`${nome}: ${r.error}`);
          continue;
        }
        if (semCliente) delete r.row.client;
        const mat = r.row.matricula ? matKey(r.row.matricula) : null;
        const cur = mat ? byMat.get(mat) : porNome(r.row.name);
        if (cur) {
          usados.add(String(cur.id));
          // só o que veio preenchido na planilha e está diferente do cadastro
          const patch: Row = {};
          for (const [k, v] of Object.entries(r.row)) {
            // posto da planilha que não bate com nenhum cadastrado: o posto_id antigo não vale mais
            if (k === 'posto_id' && r.row.posto_name) {
              if (!igual(cur.posto_id, v)) patch.posto_id = v ?? null;
              continue;
            }
            if (v === null || v === undefined || (k === 'sizes' && !Object.keys(v as object).length) || k === 'matricula') continue;
            const novo = k === 'sizes' ? { ...((cur.sizes as object) ?? {}), ...(v as object) } : v;
            if (!igual(cur[k], novo)) patch[k] = novo;
          }
          if (!Object.keys(patch).length) unchanged++;
          else patches.push({ nome, id: String(cur.id), patch: { ...patch, updated_at: new Date().toISOString() } });
          continue;
        }
        if (mat && seen.has(mat)) {
          errors.push(`${nome}: matrícula ${r.row.matricula} repetida na planilha (${seen.get(mat)})`);
          continue;
        }
        if (mat) seen.set(mat, nome);
        fresh.push({ n, nome, row: { ...r.row, created_by: user.display_name } });
      }
      // atualizações em paralelo (10 por vez): uma planilha inteira cabe no tempo do servidor
      for (let i = 0; i < patches.length; i += 10) {
        await Promise.all(
          patches.slice(i, i + 10).map(async (x) => {
            const { error } = await db().from('collaborators').update(x.patch).eq('id', x.id);
            if (error) errors.push(`${x.nome}: ${error.message}`);
            else updated++;
          }),
        );
      }
      for (let i = 0; i < fresh.length; i += 500) {
        const chunk = fresh.slice(i, i + 500);
        const { error } = await db()
          .from('collaborators')
          .insert(chunk.map((c) => c.row));
        if (!error) {
          created += chunk.length;
          continue;
        }
        // lote recusado (ex.: matrícula que já existe): tenta um por um para salvar o resto
        for (const c of chunk) {
          const { error: e1 } = await db().from('collaborators').insert(c.row);
          if (e1) errors.push(`${c.nome}: ${e1.code === '23505' ? 'matrícula já cadastrada' : e1.message}`);
          else created++;
        }
      }
      await broadcast('collab:update', { by: user.display_name });
      return NextResponse.json({ created, updated, unchanged, errors: errors.slice(0, 50) });
    }

    const r = collabFields(b, ps);
    if ('error' in r) return fail(r.error);
    if (semCliente) delete r.row.client;
    const { data, error } = await db()
      .from('collaborators')
      .insert({ ...r.row, created_by: user.display_name })
      .select(await collabCols())
      .single();
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
