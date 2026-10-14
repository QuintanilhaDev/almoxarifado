import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { canManageSector } from '@/lib/permissions';
import { UUID_RE, loadItems, str } from '@/lib/almoxarifado/stockData';
import { almoxOrders, canSeeOrder, opOrders, rhOrders } from '@/lib/pedidos/access';
import { dbRule, event, loadOrder, missingP3, p3Fail, purchaseForOrder } from '@/lib/pedidos/server';
import { isRhOrigin, lineLabel, type MaterialOrder } from '@/lib/pedidos/types';
import type { StockItem } from '@/lib/almoxarifado/types';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string; action: string }> };
type Line = { i: number; qty: number };

function parseLines(v: unknown, o: MaterialOrder): Line[] | string {
  if (!Array.isArray(v) || !v.length) return 'Escolha os itens e as quantidades.';
  const out: Line[] = [];
  for (const x of v as Record<string, unknown>[]) {
    const i = Number(x?.i);
    const qty = Number(x?.qty);
    if (!Number.isInteger(i) || !o.items[i]) return 'Linha do pedido inválida.';
    if (!Number.isInteger(qty) || qty < 0 || qty > 100_000) return `"${lineLabel(o.items[i])}": quantidade inválida.`;
    if (qty > 0) out.push({ i, qty });
  }
  return out.length ? out : 'Informe pelo menos uma quantidade maior que zero.';
}

/**
 * Plano automático (Projeto 3, fluxo B/C): reserva o que há disponível sem furar o mínimo
 * e pede compra do que falta. Só calcula; a tela mostra e a pessoa confirma.
 */
function autoPlan(o: MaterialOrder, stock: Map<string, StockItem>, openPurchases: Set<string>) {
  const freeLeft = new Map<string, number>();
  return o.items.map((l, i) => {
    const need = Math.max(0, l.qty - l.delivered - l.reserved);
    if (!need) return { i, reserve: 0, purchase: 0, minimum: false, pending: false };
    const pending = Boolean(l.purchase_id && openPurchases.has(l.purchase_id)); // já tem compra a caminho
    if (!l.item_id) return { i, reserve: 0, purchase: pending ? 0 : need, minimum: false, pending };
    const s = stock.get(l.item_id);
    if (!s) return { i, reserve: 0, purchase: pending ? 0 : need, minimum: false, pending };
    const free = freeLeft.get(s.id) ?? s.quantity - s.reserved;
    const allowed = Math.max(0, Math.min(free, free - s.min_quantity));
    const reserve = Math.min(need, s.min_quantity > 0 ? allowed : free);
    freeLeft.set(s.id, free - reserve);
    const short = need - reserve;
    const minimum = short > 0 && Math.min(need, free) > reserve; // daria para reservar mais furando o mínimo
    return { i, reserve, purchase: pending ? 0 : short, minimum, pending };
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const { id, action } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Pedido não encontrado.', 404);
  const b = (await readJson<{ lines?: unknown; force?: unknown; receiver?: unknown; reason?: unknown; confirm?: unknown }>(req)) ?? {};
  try {
    const user = await requireUser();
    const o = await loadOrder(id);
    if (!o || !canSeeOrder(user, o)) return fail('Pedido não encontrado.', 404);
    const almoxEdit = almoxOrders(user, 'edit');
    // liberação excepcional abaixo do mínimo: só master do Almoxarifado (ou geral)
    const force = b.force === true;
    if (force && !canManageSector(user, 'almoxarifado')) throw new AccessError(403, 'Só o master do Almoxarifado pode autorizar a liberação abaixo do estoque mínimo.');
    const by = user.display_name;
    let result: unknown = null;

    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await db().rpc(fn, args);
      if (error) throw error;
      return data;
    };

    switch (action) {
      case 'reserve': {
        if (!almoxEdit) throw new AccessError(403, 'Só o Almoxarifado reserva material.');
        const lines = parseLines(b.lines, o);
        if (typeof lines === 'string') return fail(lines);
        result = await rpc('order_reserve', { p_order: id, p_lines: lines, p_force: force, p_by: by });
        break;
      }
      case 'deliver': {
        if (!almoxEdit) throw new AccessError(403, 'Só o Almoxarifado entrega material.');
        const lines = parseLines(b.lines, o);
        if (typeof lines === 'string') return fail(lines);
        result = await rpc('order_deliver', { p_order: id, p_lines: lines, p_receiver: str(b.receiver, 120) ?? o.collaborator_name, p_force: force, p_by: by });
        break;
      }
      case 'release': {
        if (!almoxEdit) throw new AccessError(403, 'Só o Almoxarifado mexe nas reservas.');
        result = await rpc('order_release', { p_order: id, p_lines: Array.isArray(b.lines) ? b.lines : null, p_by: by });
        break;
      }
      case 'cancel': {
        const canCancel = almoxEdit || (o.origin === 'operacao' && opOrders(user, 'edit')) || (isRhOrigin(o.origin) && rhOrders(user, 'edit'));
        if (!canCancel) throw new AccessError(403, 'Você não pode cancelar este pedido.');
        if (!almoxEdit && o.items.some((l) => l.delivered > 0)) return fail('Parte já foi entregue: peça ao Almoxarifado para encerrar.', 409);
        const reason = str(b.reason, 300);
        if (!reason) return fail('Diga o motivo do cancelamento.');
        result = await rpc('order_cancel', { p_order: id, p_reason: reason, p_by: by });
        break;
      }
      case 'purchase':
      case 'auto': {
        if (!almoxEdit) throw new AccessError(403, 'Só o Almoxarifado pede compras pelo pedido.');
        if (o.stage !== 'encaminhado') return fail('Este pedido não está com o Almoxarifado.', 409);
        const stock = new Map((await loadItems()).map((s) => [s.id, s]));
        const pIds = [...new Set(o.items.map((l) => l.purchase_id).filter(Boolean) as string[])];
        const openPurchases = new Set<string>();
        if (pIds.length) {
          const { data: ps } = await db().from('purchase_requests').select('id, status').in('id', pIds);
          for (const p of ps ?? []) if (['nova', 'em_cotacao', 'comprada'].includes(p.status as string)) openPurchases.add(p.id as string);
        }
        const plan = autoPlan(o, stock, openPurchases);
        let buy: Line[];
        let reserve: Line[] = [];
        if (action === 'auto') {
          if (b.confirm !== true) return NextResponse.json({ plan }); // só mostra o plano
          reserve = plan.filter((p) => p.reserve > 0).map((p) => ({ i: p.i, qty: p.reserve }));
          buy = plan.filter((p) => p.purchase > 0).map((p) => ({ i: p.i, qty: p.purchase }));
        } else {
          const lines = parseLines(b.lines, o);
          if (typeof lines === 'string') return fail(lines);
          buy = lines;
        }
        if (reserve.length) await rpc('order_reserve', { p_order: id, p_lines: reserve, p_force: false, p_by: by });
        let purchase: { id: string; number: number } | null = null;
        if (buy.length) {
          const fresh = (await loadOrder(id))!;
          purchase = await purchaseForOrder(fresh, buy, { id: user.id, name: by }, stock);
          const items = fresh.items.map((l, k) => (buy.some((x) => x.i === k) ? { ...l, purchase_id: purchase!.id, purchase_number: purchase!.number } : l));
          const history = [...fresh.history, event(by, `Compra solicitada (${purchase.number}) do que falta: ${buy.map((x) => `${x.qty} ${lineLabel(fresh.items[x.i])}`).join(', ')}`)];
          // só liga se ninguém mexeu no pedido nesse meio tempo; senão desfaz a compra recém-criada
          const { data: upd, error } = await db().from('material_orders').update({ items, history, updated_at: new Date().toISOString() }).eq('id', id).eq('updated_at', fresh.updated_at).select('id').maybeSingle();
          if (error || !upd) {
            await db().from('purchase_requests').update({ status: 'cancelada', updated_at: new Date().toISOString() }).eq('id', purchase.id);
            if (error) throw error;
            return fail('Outra pessoa acabou de mexer neste pedido. Confira e confirme de novo.', 409);
          }
          await broadcast('purchase:new', { id: purchase.id, number: purchase.number, by, priority: o.priority, count: buy.length });
        }
        result = { reserved: reserve.reduce((t, x) => t + x.qty, 0), purchase };
        break;
      }
      default:
        return fail('Ação inválida.', 404);
    }
    await broadcast('order:update', { id, number: o.number, by, action });
    if (action === 'deliver' || action === 'reserve' || action === 'release' || action === 'cancel' || action === 'auto') await broadcast('stock:update', { by });
    return NextResponse.json({ ok: true, result, order: await loadOrder(id) });
  } catch (e) {
    const rule = dbRule(e);
    if (rule) return fail(rule.message, 409, { minimum: rule.minimum });
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
