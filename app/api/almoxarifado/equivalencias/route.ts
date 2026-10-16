import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { UUID_RE, str } from '@/lib/almoxarifado/stockData';
import { notesAccess } from '@/lib/pedidos/access';
import { missingPC, pcFail } from '@/lib/compras/pcServer';

export const dynamic = 'force-dynamic';

/**
 * Equivalência de códigos: CNPJ do fornecedor + código externo + unidade → item interno,
 * com o fator de conversão (ex.: 1 caixa = 10 unidades). Um item interno pode ter vários
 * fornecedores e códigos; o estoque continua um só.
 */
export async function GET() {
  try {
    const user = await requireUser();
    if (!notesAccess(user)) throw new AccessError(403, 'Sem acesso às equivalências.');
    const [{ data: eqs, error }, { data: sups }, { data: items }] = await Promise.all([
      db().from('supplier_items').select('supplier_id, supplier_code, unit_key, unit, description, factor, item_id, validated_by, validated_at, updated_at').limit(20000),
      db().from('suppliers').select('id, name, trade_name, cnpj').limit(20000),
      db().from('stock_items').select('id, name, size, code').limit(20000),
    ]);
    if (error) throw error;
    const sup = new Map((sups ?? []).map((s) => [s.id, s]));
    const it = new Map((items ?? []).map((i) => [i.id, i]));
    const rows = (eqs ?? []).map((e) => {
      const s = sup.get(e.supplier_id);
      const i = it.get(e.item_id);
      return { ...e, supplier: s ? (s.trade_name as string) || (s.name as string) : '—', cnpj: s?.cnpj ?? null, item: i ? `${i.name}${i.size ? ' · ' + i.size : ''}` : 'item removido', item_code: i?.code ?? null };
    });
    rows.sort((a, b) => String(a.supplier).localeCompare(String(b.supplier)) || String(a.supplier_code).localeCompare(String(b.supplier_code)));
    return NextResponse.json({ equivalences: rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (missingPC(e)) return pcFail();
    return serverError(e);
  }
}

/** Cria ou corrige uma equivalência (validada por quem grava). */
export async function POST(req: Request) {
  const b = await readJson<Record<string, unknown>>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!notesAccess(user, 'edit')) throw new AccessError(403, 'Só quem lança notas no Almoxarifado mexe nas equivalências.');
    if (typeof b.supplier_id !== 'string' || !UUID_RE.test(b.supplier_id)) return fail('Escolha o fornecedor.');
    if (typeof b.item_id !== 'string' || !UUID_RE.test(b.item_id)) return fail('Escolha o item do estoque.');
    const code = str(b.code, 60);
    if (!code) return fail('Informe o código do fornecedor.');
    const factor = Number(String(b.factor ?? '1').replace(',', '.'));
    if (!(factor > 0 && factor <= 100000)) return fail('Fator de conversão inválido (ex.: 1 caixa = 10 → fator 10).');
    const unit = str(b.unit, 10);
    const now = new Date().toISOString();
    const { error } = await db()
      .from('supplier_items')
      .upsert(
        { supplier_id: b.supplier_id, supplier_code: code, unit_key: (unit ?? '').toLowerCase(), unit, description: str(b.description, 200), factor, item_id: b.item_id, validated_by: user.display_name, validated_at: now, updated_at: now },
        { onConflict: 'supplier_id,supplier_code,unit_key' },
      );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (missingPC(e)) return pcFail();
    return serverError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    if (!notesAccess(user, 'edit')) throw new AccessError(403, 'Só quem lança notas no Almoxarifado mexe nas equivalências.');
    const sp = new URL(req.url).searchParams;
    const sid = sp.get('supplier_id') ?? '';
    const code = sp.get('code') ?? '';
    if (!UUID_RE.test(sid) || !code) return fail('Equivalência não encontrada.', 404);
    const { error } = await db().from('supplier_items').delete().eq('supplier_id', sid).eq('supplier_code', code).eq('unit_key', (sp.get('unit') ?? '').toLowerCase());
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (missingPC(e)) return pcFail();
    return serverError(e);
  }
}
