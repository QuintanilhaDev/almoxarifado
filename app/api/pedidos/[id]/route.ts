import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE, loadItems, str } from '@/lib/almoxarifado/stockData';
import { almoxOrders, canSeeOrder, opOrders, rhOrders } from '@/lib/pedidos/access';
import { ORDER_COLS, duplicityFlags, event, loadOrder, missingP3, p3Fail, toOrder } from '@/lib/pedidos/server';
import { LIMITS, isRhOrigin, lineLabel, type OrderItem } from '@/lib/pedidos/types';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Pedido não encontrado.', 404);
  try {
    const user = await requireUser();
    const o = await loadOrder(id);
    if (!o || !canSeeOrder(user, o)) return fail('Pedido não encontrado.', 404);
    const { data: del } = await db().from('deliveries').select('id, group_id, item_name, size, qty, returned_qty, receiver, by_name, delivered_at').eq('order_id', id).order('delivered_at', { ascending: false });
    return NextResponse.json({ order: o, deliveries: del ?? [] });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}

/**
 * Mudanças de etapa e de conteúdo:
 *  - forward:  Operação encaminha ao Almoxarifado (pedido "solicitado")
 *  - validate: Operação valida a troca anual aberta pelo RH/DP
 *  - return:   Almoxarifado devolve à área de origem para correção (se nada foi reservado/entregue)
 *  - edit:     a área de origem corrige itens/dados antes de encaminhar
 *  - link:     Almoxarifado liga uma linha ao item certo do estoque
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Pedido não encontrado.', 404);
  const b = await readJson<{ action?: unknown; note?: unknown; items?: unknown; i?: unknown; item_id?: unknown; priority?: unknown; needed_by?: unknown; reason?: unknown }>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    const o = await loadOrder(id);
    if (!o || !canSeeOrder(user, o)) return fail('Pedido não encontrado.', 404);
    const note = str(b.note, 300);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const history = [...o.history];
    const ownerEdit = o.origin === 'operacao' ? opOrders(user, 'edit') : isRhOrigin(o.origin) ? rhOrders(user, 'edit') : almoxOrders(user, 'edit');

    switch (b.action) {
      case 'forward': {
        if (!(o.origin === 'operacao' ? opOrders(user, 'edit') : ownerEdit)) throw new AccessError(403, 'Só a área que abriu o pedido pode encaminhá-lo.');
        if (o.stage !== 'solicitado') return fail('Este pedido já foi encaminhado.', 409);
        patch.stage = 'encaminhado';
        patch.forwarded_by = user.display_name;
        patch.forwarded_at = patch.updated_at;
        history.push(event(user.display_name, `Encaminhado ao Almoxarifado${note ? ': ' + note : ''}`));
        break;
      }
      case 'validate': {
        if (!opOrders(user, 'edit')) throw new AccessError(403, 'Só a Operação valida as trocas.');
        if (o.stage !== 'validacao') return fail('Este pedido não está aguardando validação.', 409);
        patch.stage = 'encaminhado';
        patch.validated_by = user.display_name;
        patch.validated_at = patch.updated_at;
        patch.forwarded_by = user.display_name;
        patch.forwarded_at = patch.updated_at;
        history.push(event(user.display_name, `Validado pela Operação e encaminhado ao Almoxarifado${note ? ': ' + note : ''}`));
        break;
      }
      case 'return': {
        if (!almoxOrders(user, 'edit')) throw new AccessError(403, 'Só o Almoxarifado devolve pedidos para correção.');
        if (o.stage !== 'encaminhado') return fail('Só dá para devolver pedidos que estão com o Almoxarifado.', 409);
        if (o.items.some((l) => l.reserved > 0 || l.delivered > 0)) return fail('Este pedido já tem itens reservados ou entregues. Libere as reservas antes de devolver.', 409);
        if (!note) return fail('Diga o que precisa ser corrigido.');
        patch.stage = o.origin === 'rh_troca' ? 'validacao' : 'solicitado';
        history.push(event(user.display_name, `Devolvido para correção: ${note}`));
        break;
      }
      case 'edit': {
        if (!ownerEdit) throw new AccessError(403, 'Você não pode alterar este pedido.');
        if (!['solicitado', 'validacao'].includes(o.stage)) return fail('Depois de encaminhado, só o Almoxarifado mexe no pedido. Peça a devolução para corrigir.', 409);
        if (b.items !== undefined) {
          if (!Array.isArray(b.items) || !b.items.length || b.items.length > LIMITS.items) return fail('Itens inválidos.');
          const stock = await loadItems();
          const byId = new Map(stock.map((s) => [s.id, s]));
          const lines: OrderItem[] = [];
          for (const [n, x] of (b.items as Record<string, unknown>[]).entries()) {
            const qty = Number(x?.qty);
            if (!Number.isInteger(qty) || qty < 1 || qty > LIMITS.qty) return fail(`Item ${n + 1}: quantidade inválida.`);
            const s = typeof x?.item_id === 'string' ? byId.get(x.item_id) : undefined;
            const name = s?.name ?? str(x?.name, 160);
            if (!name) return fail(`Item ${n + 1}: diga o nome.`);
            lines.push({ item_id: s?.id ?? null, name, size: s?.size ?? str(x?.size, 40), unit: s?.unit ?? 'Cada', qty, reserved: 0, delivered: 0, note: str(x?.note, 200), ...(s ? {} : { check: true }) });
          }
          patch.items = lines;
          patch.flags = await duplicityFlags({ id: o.id, collaborator_id: o.collaborator_id, collaborator_name: o.collaborator_name, items: lines });
        }
        if (b.priority !== undefined) patch.priority = b.priority === 'urgente' ? 'urgente' : 'normal';
        if (b.reason !== undefined) patch.reason = str(b.reason, LIMITS.text);
        if (b.needed_by !== undefined) patch.needed_by = typeof b.needed_by === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.needed_by) ? b.needed_by : null;
        history.push(event(user.display_name, `Pedido corrigido${note ? ': ' + note : ''}`));
        break;
      }
      case 'link': {
        if (!almoxOrders(user, 'edit')) throw new AccessError(403, 'Só o Almoxarifado liga itens ao estoque.');
        const i = Number(b.i);
        const line = o.items[i];
        if (!line) return fail('Linha inválida.');
        if (line.reserved > 0 || line.delivered > 0) return fail('Esta linha já tem reserva ou entrega; não dá para trocar o item.', 409);
        if (typeof b.item_id !== 'string' || !UUID_RE.test(b.item_id)) return fail('Escolha o item do estoque.');
        const { data: s, error } = await db().from('stock_items').select('id, name, size, unit').eq('id', b.item_id).maybeSingle();
        if (error) throw error;
        if (!s) return fail('Item não encontrado.', 404);
        const items = o.items.map((l, k) => (k === i ? { ...l, item_id: s.id, name: s.name, size: s.size, unit: s.unit, check: false } : l));
        patch.items = items;
        history.push(event(user.display_name, `Ligou "${lineLabel(line)}" ao item ${s.name}${s.size ? ' ' + s.size : ''}`));
        break;
      }
      default:
        return fail('Ação inválida.');
    }
    patch.history = history.slice(-200);
    const { data, error } = await db().from('material_orders').update(patch).eq('id', id).eq('updated_at', o.updated_at).select(ORDER_COLS).maybeSingle();
    if (error) throw error;
    if (!data) return fail('Outra pessoa acabou de alterar este pedido. Confira e tente de novo.', 409);
    const out = toOrder(data as Record<string, unknown>);
    await broadcast('order:update', { id, number: out.number, stage: out.stage, by: user.display_name, action: String(b.action) });
    return NextResponse.json({ order: out });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
