import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE, loadItems, str } from '@/lib/almoxarifado/stockData';
import { colabAccess, rhOrders } from '@/lib/pedidos/access';
import { ORDER_COLS, duplicityFlags, event, getConfig, missingP3, p3Fail, toOrder } from '@/lib/pedidos/server';
import { COLLAB_COLS, kitFor, kitLines, loadKits, tradeRows, type Collaborator } from '@/lib/pedidos/rh';
import { lineLabel, orderLabel } from '@/lib/pedidos/types';

export const dynamic = 'force-dynamic';

/** Troca anual: quem vence, quem está perto e a demanda consolidada para o Almoxarifado se preparar. */
export async function GET() {
  try {
    const user = await requireUser();
    if (!rhOrders(user) && !colabAccess(user)) throw new AccessError(403, 'Você não tem acesso à troca anual.');
    const cfg = await getConfig();
    const { rows, kits, noKit } = await tradeRows({ alertDays: cfg.tradeAlertDays, extraResets: cfg.extraResetsCycle });
    const stock = await loadItems();
    const byId = new Map(stock.map((s) => [s.id, s]));
    const demand = new Map<string, { item_id: string | null; name: string; size: string | null; qty: number; available: number | null; people: number }>();
    for (const r of rows) {
      if ((r.status !== 'vencida' && r.status !== 'proxima') || r.open_order) continue;
      const kit = kitFor(kits, r.collaborator.role);
      if (!kit) continue;
      for (const l of kitLines(kit, r.collaborator.sizes ?? {}, stock)) {
        const key = l.item_id ?? `?${lineLabel(l)}`;
        const cur = demand.get(key) ?? { item_id: l.item_id, name: l.name, size: l.size, qty: 0, available: l.item_id ? (byId.get(l.item_id)?.quantity ?? 0) - (byId.get(l.item_id)?.reserved ?? 0) : null, people: 0 };
        cur.qty += l.qty;
        cur.people += 1;
        demand.set(key, cur);
      }
    }
    const list = [...demand.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || String(a.size).localeCompare(String(b.size), 'pt-BR', { numeric: true }));
    return NextResponse.json({ rows, kits, noKit, demand: list, config: cfg }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}

/** Abre os pedidos de troca (um por colaborador, com o kit da função e os tamanhos dele). Vão para a Operação validar. */
export async function POST(req: Request) {
  const b = await readJson<{ collaborator_ids?: unknown; needed_by?: unknown; note?: unknown }>(req);
  if (!b || !Array.isArray(b.collaborator_ids) || !b.collaborator_ids.length) return fail('Escolha os colaboradores.');
  if (b.collaborator_ids.length > 300) return fail('No máximo 300 colaboradores por vez.');
  if (b.collaborator_ids.some((x) => typeof x !== 'string' || !UUID_RE.test(x))) return fail('Colaborador inválido.');
  const needed = typeof b.needed_by === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.needed_by) ? b.needed_by : null;
  try {
    const user = await requireUser();
    if (!rhOrders(user, 'edit')) throw new AccessError(403, 'Só o RH/DP abre as trocas.');
    const kits = await loadKits();
    const stock = await loadItems();
    const { data: cs, error } = await db().from('collaborators').select(COLLAB_COLS).in('id', b.collaborator_ids as string[]);
    if (error) throw error;
    const { data: open } = await db().from('material_orders').select('collaborator_id, number').eq('origin', 'rh_troca').in('stage', ['validacao', 'encaminhado', 'solicitado']).in('collaborator_id', b.collaborator_ids as string[]);
    const openBy = new Map((open ?? []).map((o) => [o.collaborator_id as string, Number(o.number)]));
    const created: { id: string; number: number; name: string }[] = [];
    const skipped: string[] = [];
    for (const c of (cs ?? []) as Collaborator[]) {
      if (openBy.has(c.id)) {
        skipped.push(`${c.name}: já tem a troca ${orderLabel(openBy.get(c.id)!)} em aberto`);
        continue;
      }
      const kit = kitFor(kits, c.role);
      if (!kit) {
        skipped.push(`${c.name}: a função "${c.role ?? 'sem função'}" não tem kit cadastrado`);
        continue;
      }
      const items = kitLines(kit, c.sizes ?? {}, stock);
      const flags = await duplicityFlags({ collaborator_id: c.id, collaborator_name: c.name, items });
      const { data, error: e2 } = await db()
        .from('material_orders')
        .insert({
          origin: 'rh_troca',
          stage: 'validacao',
          needed_by: needed,
          company: c.company,
          posto_id: c.posto_id,
          posto_name: c.posto_name,
          collaborator_id: c.id,
          collaborator_name: c.name,
          matricula: c.matricula,
          role: c.role,
          reason: str(b.note, 300) ?? `Troca periódica (a cada ${kit.period_months} meses)`,
          requester: user.display_name,
          requester_id: user.id,
          items,
          flags,
          history: [event(user.display_name, 'Troca anual aberta pelo RH/DP; aguardando a validação da Operação')],
        })
        .select(ORDER_COLS)
        .single();
      if (e2) throw e2;
      const o = toOrder(data as Record<string, unknown>);
      created.push({ id: o.id, number: o.number, name: c.name });
    }
    if (created.length) await broadcast('order:new', { count: created.length, origin: 'rh_troca', stage: 'validacao', by: user.display_name });
    return NextResponse.json({ created, skipped });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
