import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { UUID_RE } from '@/lib/almoxarifado/stockData';
import { SUPPLIER_COLS, supplierEdit, supplierFields, supplierView } from '@/lib/compras/fornecedores';
import { missingSuppliers, suppliersSetup } from '@/lib/compras/fornecedoresServer';

export const dynamic = 'force-dynamic';

/** Notas fiscais de um fornecedor (as mais recentes). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return fail('Fornecedor inválido.', 404);
    const user = await requireUser();
    if (!supplierView(user)) throw new AccessError(403, 'Você não tem acesso aos fornecedores.');
    const { data, error } = await db()
      .from('fiscal_notes')
      .select('id, number, series, issue_date, status, totals, created_at')
      .eq('supplier_id', id)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    return NextResponse.json({ notes: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (missingSuppliers(e)) return suppliersSetup();
    return serverError(e);
  }
}

/** Edita o fornecedor, ou só ativa/desativa ({ active }). Fornecedor não é apagado: as notas continuam ligadas a ele. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const b = await readJson(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return fail('Fornecedor inválido.', 404);
    const user = await requireUser();
    if (!supplierEdit(user)) throw new AccessError(403, 'Só o setor Compras edita fornecedores.');
    const now = new Date().toISOString();
    let patch: Record<string, unknown>;
    if (Object.keys(b).length === 1 && typeof b.active === 'boolean') patch = { active: b.active, updated_at: now };
    else {
      const r = supplierFields(b);
      if ('error' in r) return fail(r.error.charAt(0).toUpperCase() + r.error.slice(1) + '.');
      patch = { ...r.row, updated_at: now };
      if (typeof b.active === 'boolean') patch.active = b.active;
    }
    const { data, error } = await db().from('suppliers').update(patch).eq('id', id).select(SUPPLIER_COLS).maybeSingle();
    if (error) {
      if (error.code === '23505') return fail('Já existe outro fornecedor com este CNPJ/CPF.', 409);
      throw error;
    }
    if (!data) return fail('Fornecedor não encontrado.', 404);
    return NextResponse.json({ supplier: data });
  } catch (e) {
    if (missingSuppliers(e)) return suppliersSetup();
    return serverError(e);
  }
}
