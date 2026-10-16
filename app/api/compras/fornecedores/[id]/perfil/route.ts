import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { UUID_RE, str } from '@/lib/almoxarifado/stockData';
import { SUPPLIER_COLS_PC, supplierEdit, supplierView } from '@/lib/compras/fornecedores';
import { intOr, missingPC, money, nowIso, pcFail, toPO } from '@/lib/compras/pcServer';
import { supplierPerformance } from '@/lib/compras/painel';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Ficha do fornecedor: homologação, condições, itens com prazo, desempenho e preços. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Fornecedor inválido.', 404);
  try {
    const user = await requireUser();
    if (!supplierView(user)) throw new AccessError(403, 'Você não tem acesso aos fornecedores.');
    const { data: s, error } = await db().from('suppliers').select(SUPPLIER_COLS_PC).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!s) return fail('Fornecedor não encontrado.', 404);
    const [{ data: prods }, { data: eqs }, { data: os }, { data: items }] = await Promise.all([
      db().from('supplier_products').select('*').eq('supplier_id', id),
      db().from('supplier_items').select('supplier_code, unit, unit_key, description, factor, item_id, validated_by, validated_at').eq('supplier_id', id),
      db().from('purchase_orders').select('*').eq('supplier_id', id).order('created_at', { ascending: false }).limit(200),
      db().from('stock_items').select('id, name, size, unit, code').limit(20000),
    ]);
    const label = (iid: string) => {
      const it = (items ?? []).find((x) => x.id === iid);
      return it ? `${it.name}${it.size ? ' · ' + it.size : ''}` : 'item removido';
    };
    const orders = (os ?? []).map((r) => toPO(r as Record<string, unknown>));
    const perf = (await supplierPerformance([id]))[id] ?? null;
    // histórico de preços por item (pedidos aprovados em diante)
    const prices: { item: string; item_id: string | null; at: string; price: number; order: number }[] = [];
    for (const o of orders.filter((x) => !['rascunho', 'aguardando_aprovacao', 'cancelado'].includes(x.status))) {
      for (const i of o.items) prices.push({ item: `${i.name}${i.size ? ' · ' + i.size : ''}`, item_id: i.item_id, at: o.approval?.at ?? o.created_at, price: i.unit_price, order: o.number });
    }
    return NextResponse.json({
      supplier: s,
      products: (prods ?? []).map((p) => ({ ...p, label: label(String(p.item_id)) })),
      equivalences: (eqs ?? []).map((e) => ({ ...e, label: label(String(e.item_id)) })),
      orders: orders.slice(0, 30).map((o) => ({ id: o.id, number: o.number, status: o.status, total: o.total, created_at: o.created_at, due: o.promised_date ?? o.expected_date })),
      performance: perf,
      prices: prices.slice(0, 200),
    });
  } catch (e) {
    if (missingPC(e)) return pcFail();
    return serverError(e);
  }
}

/**
 * Atualiza a parte de Compras do fornecedor:
 *  homologation (pendente/homologado/bloqueado, com observação), exclusividade, prazo e
 *  pagamento padrão, marcas; e os itens que ele fornece, com prazo de cada um
 *  (products: [{item_id, lead_days, lead_business, mode, in_contract, confirmed, exclusive, note}]),
 *  remove_item: tira um item da lista.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Fornecedor inválido.', 404);
  const b = await readJson<Record<string, unknown>>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!supplierEdit(user)) throw new AccessError(403, 'Só o setor Compras edita fornecedores.');
    const at = nowIso();
    const by = user.display_name;
    const patch: Record<string, unknown> = {};
    if ('homologation' in b) {
      if (!['pendente', 'homologado', 'bloqueado'].includes(String(b.homologation))) return fail('Situação de homologação inválida.');
      const note = str(b.homologation_note, 400);
      if (b.homologation === 'bloqueado' && !note) return fail('Diga o motivo do bloqueio.');
      Object.assign(patch, { homologation: b.homologation, homologation_note: note, homologated_by: by, homologated_at: at });
    }
    if ('exclusive' in b) patch.exclusive = b.exclusive === true;
    if ('lead_days' in b) {
      const d = b.lead_days === null || b.lead_days === '' ? null : intOr(b.lead_days);
      if (d !== null && (d < 0 || d > 365)) return fail('Prazo padrão inválido (0 a 365 dias).');
      patch.lead_days = d;
    }
    if ('lead_business' in b) patch.lead_business = b.lead_business !== false;
    if ('payment_terms' in b) patch.payment_terms = str(b.payment_terms, 120);
    if ('brands' in b) patch.brands = str(b.brands, 200);
    if (Object.keys(patch).length) {
      const { error } = await db().from('suppliers').update({ ...patch, updated_at: at }).eq('id', id);
      if (error) throw error;
    }
    if (Array.isArray(b.products)) {
      const rows = [];
      for (const p of (b.products as Record<string, unknown>[]).slice(0, 300)) {
        if (typeof p?.item_id !== 'string' || !UUID_RE.test(p.item_id)) continue;
        const d = p.lead_days === null || p.lead_days === '' || p.lead_days === undefined ? null : intOr(p.lead_days);
        if (d !== null && (d < 0 || d > 365)) return fail('Prazo do item inválido (0 a 365 dias).');
        rows.push({
          supplier_id: id,
          item_id: p.item_id,
          lead_days: d,
          lead_business: p.lead_business !== false,
          mode: p.mode === 'producao' ? 'producao' : 'pronta',
          in_contract: p.in_contract === true,
          confirmed: p.confirmed === true,
          exclusive: p.exclusive === true,
          last_price: money(p.last_price),
          note: str(p.note, 200),
          updated_by: by,
          updated_at: at,
        });
      }
      if (rows.length) {
        const { error } = await db().from('supplier_products').upsert(rows, { onConflict: 'supplier_id,item_id' });
        if (error) throw error;
      }
    }
    if (typeof b.remove_item === 'string' && UUID_RE.test(b.remove_item)) {
      const { error } = await db().from('supplier_products').delete().eq('supplier_id', id).eq('item_id', b.remove_item);
      if (error) throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (missingPC(e)) return pcFail();
    return serverError(e);
  }
}
