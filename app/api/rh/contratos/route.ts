import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE, fetchAll, loadPostos } from '@/lib/almoxarifado/stockData';
import { colabAccess } from '@/lib/pedidos/access';
import { dataOk } from '@/lib/rh/desligamento';
import { CONTRATO_COLS } from '@/lib/rh/contratos';
import { contratosFail, mapaContratos, temContratos } from '@/lib/rh/contratosServer';

export const dynamic = 'force-dynamic';

/** Contratos (clientes) com quantos colaboradores ativos e postos cada um tem, e todos os postos. */
async function painel() {
  const { contratos, doColab } = await mapaContratos();
  const colabs = await fetchAll<{ client: string | null; posto_id: string | null; company: string | null }>('collaborators', 'client, posto_id, company', { column: 'id' }, (q) => q.eq('active', true));
  const n = new Map<string, number>();
  let semContrato = 0;
  const clientesSem = new Map<string, number>();
  for (const c of colabs) {
    const k = doColab(c);
    if (k) n.set(k.id, (n.get(k.id) ?? 0) + 1);
    else {
      semContrato++;
      if (c.client?.trim()) clientesSem.set(c.client.trim(), (clientesSem.get(c.client.trim()) ?? 0) + 1);
    }
  }
  const postos = await loadPostos();
  const np = new Map<string, number>();
  for (const p of postos) if (p.contract_id) np.set(p.contract_id, (np.get(p.contract_id) ?? 0) + 1);
  return {
    contratos: contratos.map((c) => ({ ...c, colaboradores: n.get(c.id) ?? 0, postos: np.get(c.id) ?? 0 })),
    postos,
    semContrato,
    clientesSemContrato: [...clientesSem.entries()].map(([client, colaboradores]) => ({ client, colaboradores })).sort((a, b) => b.colaboradores - a.colaboradores),
  };
}

export async function GET() {
  try {
    const user = await requireUser();
    if (!colabAccess(user)) throw new AccessError(403, 'Você não tem acesso aos contratos.');
    if (!(await temContratos())) return contratosFail();
    return NextResponse.json({ ...(await painel()), canEdit: colabAccess(user, 'edit') }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}

const txt = (v: unknown, max: number) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
function campos(b: Record<string, unknown>): { error: string } | { row: Record<string, unknown> } {
  const name = txt(b.name, 160);
  if (!name) return { error: 'Informe o nome do contrato (cliente).' };
  const cnpj = String(b.cnpj ?? '').replace(/\D/g, '');
  if (cnpj && cnpj.length !== 14 && cnpj.length !== 11) return { error: 'CNPJ (ou CPF) inválido: confira os números.' };
  const start = b.start_date ? dataOk(b.start_date) : null;
  const end = b.end_date ? dataOk(b.end_date) : null;
  if ((b.start_date && !start) || (b.end_date && !end)) return { error: 'Data de vigência inválida.' };
  if (start && end && end < start) return { error: 'O fim da vigência precisa ser depois do início.' };
  const aliases = Array.isArray(b.aliases) ? [...new Set(b.aliases.map((x) => txt(x, 160)).filter(Boolean) as string[])].filter((a) => a.toLowerCase() !== name.toLowerCase()).slice(0, 30) : [];
  return {
    row: { name, aliases, cnpj: cnpj || null, company: txt(b.company, 80), start_date: start, end_date: end, active: b.active !== false, portaria_social: b.portaria_social === true, block_import: b.block_import === true, notes: txt(b.notes, 400) },
  };
}

export async function POST(req: Request) {
  const b = await readJson<Record<string, unknown>>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!colabAccess(user, 'edit')) throw new AccessError(403, 'Só o RH cadastra contratos.');
    if (!(await temContratos())) return contratosFail();
    const r = campos(b);
    if ('error' in r) return fail(r.error);
    const { data, error } = await db().from('contracts').insert({ ...r.row, created_by: user.display_name, updated_by: user.display_name }).select(CONTRATO_COLS).single();
    if (error) {
      if (error.code === '23505') return fail('Já existe um contrato com esse nome.', 409);
      throw error;
    }
    await broadcast('collab:update', { by: user.display_name });
    return NextResponse.json({ id: data.id, ...(await painel()) });
  } catch (e) {
    return serverError(e);
  }
}

export async function PATCH(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!UUID_RE.test(id)) return fail('Contrato não encontrado.', 404);
  const b = await readJson<Record<string, unknown>>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!colabAccess(user, 'edit')) throw new AccessError(403, 'Só o RH altera contratos.');
    if (!(await temContratos())) return contratosFail();
    const r = campos(b);
    if ('error' in r) return fail(r.error);
    const { data, error } = await db().from('contracts').update({ ...r.row, updated_by: user.display_name, updated_at: new Date().toISOString() }).eq('id', id).select('id').maybeSingle();
    if (error) {
      if (error.code === '23505') return fail('Já existe um contrato com esse nome.', 409);
      throw error;
    }
    if (!data) return fail('Contrato não encontrado.', 404);
    await broadcast('collab:update', { by: user.display_name });
    await broadcast('postos:update', { by: user.display_name });
    return NextResponse.json(await painel());
  } catch (e) {
    return serverError(e);
  }
}

/** Apaga o contrato. Os postos ficam, só sem contrato; os colaboradores não mudam. */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!UUID_RE.test(id)) return fail('Contrato não encontrado.', 404);
  try {
    const user = await requireUser();
    if (!colabAccess(user, 'edit')) throw new AccessError(403, 'Só o RH altera contratos.');
    if (!(await temContratos())) return contratosFail();
    const { data, error } = await db().from('contracts').delete().eq('id', id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return fail('Contrato não encontrado.', 404);
    await broadcast('collab:update', { by: user.display_name });
    await broadcast('postos:update', { by: user.display_name });
    return NextResponse.json(await painel());
  } catch (e) {
    return serverError(e);
  }
}

