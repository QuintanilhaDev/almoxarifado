import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { rateLimit } from '@/lib/rateLimit';
import { SUPPLIER_COLS, nameKey, supplierEdit, supplierFields, supplierView, type Supplier } from '@/lib/compras/fornecedores';
import { missingSuppliers, suppliersSetup } from '@/lib/compras/fornecedoresServer';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

/** Lista de fornecedores com o resumo das notas fiscais de cada um. */
export async function GET() {
  try {
    const user = await requireUser();
    if (!supplierView(user)) throw new AccessError(403, 'Você não tem acesso aos fornecedores.');
    const { data, error } = await db().from('suppliers').select(SUPPLIER_COLS).order('name').limit(10000);
    if (error) throw error;
    // resumo das notas (sem as estornadas)
    const stats = new Map<string, { n: number; last: string | null; total: number }>();
    const { data: notes } = await db().from('fiscal_notes').select('supplier_id, issue_date, created_at, totals, status').neq('status', 'estornada').limit(50000);
    for (const n of (notes ?? []) as { supplier_id: string | null; issue_date: string | null; created_at: string; totals: { total?: number } | null }[]) {
      if (!n.supplier_id) continue;
      const s = stats.get(n.supplier_id) ?? { n: 0, last: null, total: 0 };
      s.n++;
      const d = n.issue_date ?? n.created_at?.slice(0, 10) ?? null;
      if (d && (!s.last || d > s.last)) s.last = d;
      s.total += Number(n.totals?.total ?? 0) || 0;
      stats.set(n.supplier_id, s);
    }
    const suppliers = ((data ?? []) as unknown as Supplier[]).map((s) => {
      const st = stats.get(s.id);
      return { ...s, active: s.active !== false, notes_count: st?.n ?? 0, last_note: st?.last ?? null, total: Math.round((st?.total ?? 0) * 100) / 100 };
    });
    return NextResponse.json({ suppliers, canEdit: supplierEdit(user) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (missingSuppliers(e)) return suppliersSetup();
    return serverError(e);
  }
}

/** Novo fornecedor, ou importação da planilha ({ rows: [...] }: atualiza pelo CNPJ ou, sem CNPJ, pelo nome). */
export async function POST(req: Request) {
  const b = await readJson<Row & { rows?: unknown }>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!supplierEdit(user)) throw new AccessError(403, 'Só o setor Compras cadastra fornecedores.');
    if (!rateLimit(`forn:${user.id}`, 40, 60_000).ok) return fail('Muitas alterações em sequência. Espere um instante.', 429);
    const now = new Date().toISOString();

    const { data: existing, error: exErr } = await db().from('suppliers').select('id, name, cnpj').limit(20000);
    if (exErr) throw exErr;
    const byDoc = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const e of (existing ?? []) as { id: string; name: string; cnpj: string | null }[]) {
      if (e.cnpj) byDoc.set(e.cnpj, e.id);
      byName.set(nameKey(e.name), e.id);
    }

    if (!Array.isArray(b.rows)) {
      const r = supplierFields(b);
      if ('error' in r) return fail(r.error.charAt(0).toUpperCase() + r.error.slice(1) + '.');
      if (r.row.cnpj && byDoc.has(r.row.cnpj)) return fail('Já existe um fornecedor com este CNPJ/CPF.', 409);
      const { data, error } = await db()
        .from('suppliers')
        .insert({ ...r.row, active: true, created_by: user.display_name, updated_at: now })
        .select(SUPPLIER_COLS)
        .single();
      if (error) {
        if (error.code === '23505') return fail('Já existe um fornecedor com este CNPJ/CPF.', 409);
        throw error;
      }
      return NextResponse.json({ supplier: data });
    }

    if (b.rows.length > 5000) return fail('No máximo 5000 linhas por planilha.');
    const errors: string[] = [];
    let created = 0;
    let updated = 0;
    const fresh: { n: number; row: Row }[] = [];
    const seenDoc = new Map<string, number>();
    const seenName = new Map<string, number>();
    for (const [n, raw] of (b.rows as Row[]).entries()) {
      const r = supplierFields(raw ?? {});
      if ('error' in r) {
        errors.push(`Linha ${n + 2}: ${r.error}`);
        continue;
      }
      const key = nameKey(r.row.name);
      const id = (r.row.cnpj ? byDoc.get(r.row.cnpj) : undefined) ?? (!r.row.cnpj ? byName.get(key) : undefined);
      if (id) {
        // só atualiza o que veio preenchido na planilha
        const patch: Row = { updated_at: now };
        for (const [k, v] of Object.entries(r.row)) if (v !== null && v !== undefined) patch[k] = v;
        const { error } = await db().from('suppliers').update(patch).eq('id', id);
        if (error) errors.push(`Linha ${n + 2}: ${error.message}`);
        else updated++;
        continue;
      }
      const dupe = r.row.cnpj ? seenDoc.get(r.row.cnpj) : seenName.get(key);
      if (dupe !== undefined) {
        errors.push(`Linha ${n + 2}: ${r.row.cnpj ? 'CNPJ' : 'fornecedor'} repetido na planilha (linha ${dupe + 2})`);
        continue;
      }
      if (r.row.cnpj) seenDoc.set(r.row.cnpj, n);
      else seenName.set(key, n);
      fresh.push({ n, row: { ...r.row, active: true, created_by: user.display_name, updated_at: now } });
    }
    for (let i = 0; i < fresh.length; i += 500) {
      const chunk = fresh.slice(i, i + 500);
      const { error } = await db().from('suppliers').insert(chunk.map((c) => c.row));
      if (!error) {
        created += chunk.length;
        continue;
      }
      // lote recusado: tenta um por um para dizer qual linha deu problema
      for (const c of chunk) {
        const { error: e1 } = await db().from('suppliers').insert(c.row);
        if (e1) errors.push(`Linha ${c.n + 2}: ${e1.code === '23505' ? 'CNPJ já cadastrado' : e1.message}`);
        else created++;
      }
    }
    return NextResponse.json({ created, updated, errors });
  } catch (e) {
    if (missingSuppliers(e)) return suppliersSetup();
    return serverError(e);
  }
}
