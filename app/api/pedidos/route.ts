import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { rateLimit } from '@/lib/rateLimit';
import { normalize } from '@/lib/max/text';
import { UUID_RE, loadItems, str } from '@/lib/almoxarifado/stockData';
import { colabAccess, opOrders, originsOf, rhOrders, scopeAllowed, type OrderScope } from '@/lib/pedidos/access';
import { ORDER_COLS, duplicityFlags, event, getConfig, lineFor, missingP3, p3Fail, toOrder } from '@/lib/pedidos/server';
import { cleanSizes, kitFor, kitLines, loadKits } from '@/lib/pedidos/rh';
import { LIMITS, orderLabel, type OrderItem, type OrderOrigin, type OrderStage } from '@/lib/pedidos/types';

export const dynamic = 'force-dynamic';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Painel de pedidos. ?scope=almox|operacao|rh (cada área vê a sua parte; master vê tudo). */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const scope = (new URL(req.url).searchParams.get('scope') || 'almox') as OrderScope;
    if (!['almox', 'operacao', 'rh'].includes(scope)) return fail('Painel inválido.');
    if (!scopeAllowed(user, scope)) throw new AccessError(403, 'Você não tem acesso a este painel de pedidos.');
    const origins = originsOf(scope);
    let q = db().from('material_orders').select(ORDER_COLS).order('created_at', { ascending: false }).limit(600);
    if (scope === 'operacao') q = q.in('origin', ['operacao', 'rh_troca']); // a Operação também valida as trocas anuais
    else if (origins) q = q.in('origin', origins);
    const { data, error } = await q;
    if (error) {
      if (missingP3(error)) return p3Fail();
      throw error;
    }
    let orders = (data ?? []).map((r) => toOrder(r as Record<string, unknown>));
    if (scope === 'operacao') orders = orders.filter((o) => o.origin === 'operacao' || o.stage === 'validacao' || o.validated_by);
    // compras ligadas (status) e disponível agora de cada item
    const pIds = [...new Set(orders.flatMap((o) => o.items.map((l) => l.purchase_id).filter(Boolean) as string[]))];
    const purchases: Record<string, { status: string; number: number; expected_date: string | null; supplier: string | null }> = {};
    if (pIds.length) {
      const { data: ps } = await db().from('purchase_requests').select('id, number, status, expected_date, supplier').in('id', pIds);
      for (const p of ps ?? []) purchases[p.id as string] = { status: p.status as string, number: Number(p.number), expected_date: (p.expected_date as string) ?? null, supplier: (p.supplier as string) ?? null };
    }
    const items = await loadItems();
    const free: Record<string, number> = {};
    for (const i of items) free[i.id] = i.quantity - i.reserved;
    return NextResponse.json({ orders, purchases, free, config: await getConfig() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}

interface NewOrderBody {
  type?: unknown;
  forward?: unknown;
  posto_id?: unknown;
  posto_name?: unknown;
  collaborator_id?: unknown;
  collaborator_name?: unknown;
  matricula?: unknown;
  role?: unknown;
  company?: unknown;
  sizes?: unknown;
  start_date?: unknown;
  needed_by?: unknown;
  priority?: unknown;
  reason?: unknown;
  supervisor?: unknown;
  items?: unknown;
}

/** Novo pedido: Operação (Uesley) ou RH/DP (admissão / troca extraordinária). */
export async function POST(req: Request) {
  const b = await readJson<NewOrderBody>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!rateLimit(`pedido:${user.id}`, 30, 60_000).ok) return fail('Muitos pedidos em sequência. Espere um instante.', 429);
    const type = String(b.type || '') as OrderOrigin;
    if (!['operacao', 'rh_admissao', 'rh_extra'].includes(type)) return fail('Tipo de pedido inválido.');
    if (type === 'operacao' && !opOrders(user, 'edit')) throw new AccessError(403, 'Só a Operação pode abrir pedidos operacionais.');
    if (type !== 'operacao' && !rhOrders(user, 'edit')) throw new AccessError(403, 'Só o RH/DP pode abrir pedidos de admissão e troca.');

    const reason = str(b.reason, LIMITS.text);
    if (type === 'rh_extra' && !reason) return fail('Troca extraordinária precisa de justificativa (desgaste, perda ou mudança de função).');
    const dates: Record<string, string | null> = {};
    for (const k of ['start_date', 'needed_by'] as const) {
      const v = b[k] ? String(b[k]) : '';
      if (v && (!DATE_RE.test(v) || !Number.isFinite(Date.parse(v)))) return fail('Data inválida.');
      dates[k] = v || null;
    }
    if (type === 'rh_admissao' && !dates.start_date) return fail('Informe a data de início do colaborador.');

    // ----- colaborador -----
    let collab: { id: string | null; name: string | null; matricula: string | null; role: string | null; posto_id: string | null; posto_name: string | null; company: string | null } = {
      id: null,
      name: str(b.collaborator_name, 120),
      matricula: str(b.matricula, 40),
      role: str(b.role, 80),
      posto_id: typeof b.posto_id === 'string' && UUID_RE.test(b.posto_id) ? b.posto_id : null,
      posto_name: str(b.posto_name, 120),
      company: str(b.company, 80),
    };
    if (typeof b.collaborator_id === 'string' && b.collaborator_id) {
      if (!UUID_RE.test(b.collaborator_id)) return fail('Colaborador inválido.');
      const { data: c, error } = await db().from('collaborators').select('id, name, matricula, role, posto_id, posto_name, company').eq('id', b.collaborator_id).maybeSingle();
      if (error) throw error;
      if (!c) return fail('Colaborador não encontrado.', 404);
      collab = { id: c.id, name: c.name, matricula: c.matricula, role: collab.role ?? c.role, posto_id: collab.posto_id ?? c.posto_id, posto_name: collab.posto_name ?? c.posto_name, company: collab.company ?? c.company };
    }
    if (type !== 'operacao' && !collab.name) return fail('Informe o colaborador.');
    if (collab.posto_id && !collab.posto_name) {
      const { data: p } = await db().from('postos').select('name').eq('id', collab.posto_id).maybeSingle();
      collab.posto_name = (p?.name as string) ?? null;
    } else if (!collab.posto_id && collab.posto_name) {
      // posto digitado: liga ao cadastro quando o nome bate
      const { data: ps } = await db().from('postos').select('id, name').limit(2000);
      const key = normalize(collab.posto_name);
      const hit = ((ps ?? []) as { id: string; name: string }[]).find((p) => normalize(p.name) === key);
      if (hit) collab = { ...collab, posto_id: hit.id, posto_name: hit.name };
    }
    // admissão de alguém que ainda não está cadastrado: o cadastro é criado junto (com os tamanhos)
    if (!collab.id && collab.name && type === 'rh_admissao' && (colabAccess(user, 'edit') || rhOrders(user, 'edit'))) {
      const sizes = cleanSizes(b.sizes);
      const { data: nc, error } = await db()
        .from('collaborators')
        .insert({ name: collab.name, matricula: collab.matricula, role: collab.role, posto_id: collab.posto_id, posto_name: collab.posto_name, company: collab.company, admitted_at: dates.start_date, sizes, created_by: user.display_name })
        .select('id')
        .single();
      if (error && error.code === '23505') return fail('Já existe um colaborador com essa matrícula. Escolha-o na lista.', 409);
      if (error) throw error;
      collab.id = nc.id as string;
    }

    // ----- itens -----
    // admissão sem itens: usa o kit da função com os tamanhos do colaborador
    if (type === 'rh_admissao' && (!Array.isArray(b.items) || !b.items.length)) {
      const kit = kitFor(await loadKits(), collab.role);
      if (!kit) return fail(collab.role ? `A função "${collab.role}" ainda não tem kit cadastrado. Adicione os itens à mão ou cadastre o kit em Colaboradores.` : 'Informe a função para usar o kit, ou adicione os itens.');
      let sizes = cleanSizes(b.sizes);
      if (!Object.keys(sizes).length && collab.id) {
        const { data: c } = await db().from('collaborators').select('sizes').eq('id', collab.id).maybeSingle();
        sizes = cleanSizes(c?.sizes);
      }
      b.items = kitLines(kit, sizes, await loadItems()).map((l) => (l.item_id ? { item_id: l.item_id, qty: l.qty } : { name: l.name, size: l.size, qty: l.qty, note: l.note }));
    }
    if (!Array.isArray(b.items) || !b.items.length) return fail('Adicione pelo menos um item.');
    if (b.items.length > LIMITS.items) return fail(`No máximo ${LIMITS.items} itens por pedido.`);
    const stock = await loadItems();
    const byId = new Map(stock.map((s) => [s.id, s]));
    const lines: OrderItem[] = [];
    for (const [n, x] of (b.items as Record<string, unknown>[]).entries()) {
      const qty = Number(x?.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > LIMITS.qty) return fail(`Item ${n + 1}: quantidade precisa ser inteira entre 1 e ${LIMITS.qty}.`);
      const note = str(x?.note, 200);
      if (typeof x?.item_id === 'string' && x.item_id) {
        const s = byId.get(x.item_id);
        if (!s) return fail(`Item ${n + 1}: não existe mais no estoque.`, 409);
        lines.push({ item_id: s.id, name: s.name, size: s.size, unit: s.unit, qty, reserved: 0, delivered: 0, note });
      } else {
        const name = str(x?.name, 160);
        if (!name) return fail(`Item ${n + 1}: diga o nome do item.`);
        lines.push(lineFor(name, str(x?.size, 40), qty, stock, note));
      }
    }

    const stage: OrderStage = type === 'operacao' && b.forward === false ? 'solicitado' : 'encaminhado';
    const flags = await duplicityFlags({ collaborator_id: collab.id, collaborator_name: collab.name, items: lines });
    const now = new Date().toISOString();
    const history = [event(user.display_name, type === 'operacao' ? 'Pedido registrado pela Operação' : type === 'rh_admissao' ? 'Kit de admissão solicitado pelo RH/DP' : 'Troca extraordinária solicitada pelo RH/DP')];
    if (stage === 'encaminhado') history.push(event(user.display_name, 'Encaminhado ao Almoxarifado'));
    const { data, error } = await db()
      .from('material_orders')
      .insert({
        origin: type,
        stage,
        priority: b.priority === 'urgente' ? 'urgente' : 'normal',
        needed_by: dates.needed_by,
        start_date: dates.start_date,
        company: collab.company,
        posto_id: collab.posto_id,
        posto_name: collab.posto_name,
        collaborator_id: collab.id,
        collaborator_name: collab.name,
        matricula: collab.matricula,
        role: collab.role,
        reason,
        requester: user.display_name,
        requester_id: user.id,
        supervisor: str(b.supervisor, 120),
        items: lines,
        flags,
        history,
        forwarded_by: stage === 'encaminhado' ? user.display_name : null,
        forwarded_at: stage === 'encaminhado' ? now : null,
      })
      .select(ORDER_COLS)
      .single();
    if (error) {
      if (missingP3(error)) return p3Fail();
      throw error;
    }
    const order = toOrder(data as Record<string, unknown>);
    await broadcast('order:new', { id: order.id, number: order.number, origin: order.origin, stage: order.stage, by: user.display_name });
    return NextResponse.json({ order, label: orderLabel(order.number) });
  } catch (e) {
    return serverError(e);
  }
}
