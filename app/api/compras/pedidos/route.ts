import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE, fetchAll, str } from '@/lib/almoxarifado/stockData';
import { comprasEdit } from '@/lib/compras/access';
import { canSeeOrders, cleanAttachments, loadConfig, missingPC, nowIso, pcFail, toPO } from '@/lib/compras/pcServer';
import { cleanDelivery, cleanItems, cleanPayment } from '@/lib/compras/poServer';
import { PO_OPEN, poLabel, poTotal } from '@/lib/compras/pc';

export const dynamic = 'force-dynamic';

/** Pedidos de compra (Compras edita; Almoxarifado, Financeiro e quem aprova consultam). */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    if (!canSeeOrders(user)) throw new AccessError(403, 'Você não tem acesso aos pedidos de compra.');
    // ?open=1: só os que ainda recebem (todos, sem o teto dos 500 mais recentes)
    if (new URL(req.url).searchParams.get('open') === '1') {
      try {
        const rows = await fetchAll<Record<string, unknown>>('purchase_orders', '*', { column: 'number', tiebreak: 'id' }, (q) => q.in('status', PO_OPEN));
        return NextResponse.json({ orders: rows.map((r) => toPO(r)) }, { headers: { 'Cache-Control': 'no-store' } });
      } catch (e) {
        if (missingPC(e)) return pcFail();
        throw e;
      }
    }
    const { data, error } = await db().from('purchase_orders').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) {
      if (missingPC(error)) return pcFail();
      throw error;
    }
    return NextResponse.json({ orders: (data ?? []).map((r) => toPO(r as Record<string, unknown>)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}

/**
 * Pedido de compra direto, sem cotação (fornecedor exclusivo, contrato — ex.: Marvin).
 * Exige o motivo da compra direta. Nasce em rascunho.
 */
export async function POST(req: Request) {
  const b = await readJson<Record<string, unknown>>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!comprasEdit(user)) throw new AccessError(403, 'Só o setor de Compras (com edição) emite pedidos de compra.');
    if (typeof b.supplier_id !== 'string' || !UUID_RE.test(b.supplier_id)) return fail('Escolha o fornecedor.');
    const reason = str(b.reason, 400);
    if (!reason || reason.length < 5) return fail('Diga por que esta compra é direta, sem cotação (ex.: fornecedor exclusivo, item do contrato).');
    const { data: s } = await db().from('suppliers').select('id, name, trade_name, cnpj, homologation, lead_days, lead_business, payment_terms').eq('id', b.supplier_id).maybeSingle();
    if (!s) return fail('Fornecedor não encontrado.', 404);
    if (s.homologation === 'bloqueado') return fail(`O fornecedor ${s.name} está bloqueado.`, 409);
    const items = cleanItems(b.items);
    if (typeof items === 'string') return fail(items);
    const requestIds = Array.isArray(b.request_ids) ? [...new Set(b.request_ids.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))].slice(0, 30) : [];
    // pedido parecido ainda vivo para o mesmo fornecedor e as mesmas solicitações?
    if (requestIds.length && b.force !== true) {
      const { data: same } = await db().from('purchase_orders').select('number, status, request_ids').eq('supplier_id', s.id).neq('status', 'cancelado');
      const dup = (same ?? []).find((o) => requestIds.some((id) => ((o.request_ids as string[]) ?? []).includes(id)));
      if (dup) return fail(`Já existe o ${poLabel(Number(dup.number))} deste fornecedor para a mesma solicitação. Confira antes de emitir outro.`, 409, { duplicate: true });
    }
    const cfg = await loadConfig();
    // prazo padrão: o do item com este fornecedor (o maior), senão o do fornecedor
    const ids = items.map((i) => i.item_id).filter(Boolean) as string[];
    let lead: { days: number | null; business: boolean; mode: 'pronta' | 'producao' } = { days: (s.lead_days as number) ?? null, business: s.lead_business !== false, mode: 'pronta' };
    if (ids.length) {
      const { data: sp } = await db().from('supplier_products').select('item_id, lead_days, lead_business, mode').eq('supplier_id', s.id).in('item_id', ids);
      const longest = (sp ?? []).filter((x) => x.lead_days !== null).sort((a, z) => Number(z.lead_days) - Number(a.lead_days))[0];
      if (longest) lead = { days: Number(longest.lead_days), business: longest.lead_business !== false, mode: longest.mode === 'producao' ? 'producao' : 'pronta' };
    }
    const delivery = cleanDelivery(b.delivery ?? { ...lead, location: cfg.delivery_location }, cfg.delivery_location);
    if (delivery.days === null && !delivery.date && lead.days !== null) Object.assign(delivery, { days: lead.days, business: lead.business, mode: lead.mode });
    const draft = {
      status: 'rascunho',
      request_ids: requestIds,
      supplier_id: s.id,
      supplier_name: (s.trade_name as string) || (s.name as string),
      cnpj: (s.cnpj as string) ?? null,
      items,
      freight: Number(b.freight) > 0 ? Math.round(Number(b.freight) * 100) / 100 : 0,
      other_costs: Number(b.other_costs) > 0 ? Math.round(Number(b.other_costs) * 100) / 100 : 0,
      discount: Number(b.discount) > 0 ? Math.round(Number(b.discount) * 100) / 100 : 0,
      payment: cleanPayment(b.payment ?? { mode: 'avista', days: s.payment_terms }),
      delivery,
      notes: str(b.notes, 1000),
      attachments: cleanAttachments(b.attachments),
      created_by: user.display_name,
      history: [{ at: nowIso(), by: user.display_name, what: `Pedido direto (sem cotação): ${reason}` }],
    };
    const { data, error } = await db().from('purchase_orders').insert({ ...draft, total: poTotal(draft) }).select('*').single();
    if (error) {
      if (missingPC(error)) return pcFail();
      throw error;
    }
    const order = toPO(data as Record<string, unknown>);
    await broadcast('purchase:update', { by: user.display_name, order: order.id });
    return NextResponse.json({ order });
  } catch (e) {
    if (missingPC(e)) return pcFail();
    return serverError(e);
  }
}
