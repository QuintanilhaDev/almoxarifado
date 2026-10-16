import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE, str } from '@/lib/almoxarifado/stockData';
import { comprasEdit } from '@/lib/compras/access';
import { canSeeOrders, cleanAttachments, dateOrNull, intOr, loadConfig, missingPC, money, nowIso, pcFail, toPO, toQuote } from '@/lib/compras/pcServer';
import { toRequest } from '@/lib/compras/server';
import {
  poLabel,
  poTotal,
  proposalExpired,
  proposalGoods,
  quoteLabel,
  recommend,
  type POItem,
  type Proposal,
  type ProposalLine,
  type Quote,
} from '@/lib/compras/pc';
import { todayBahia } from '@/lib/compras/prazo';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

async function load(id: string): Promise<Quote | null> {
  const { data, error } = await db().from('purchase_quotes').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toQuote(data as Record<string, unknown>) : null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Cotação não encontrada.', 404);
  try {
    const user = await requireUser();
    if (!canSeeOrders(user)) throw new AccessError(403, 'Você não tem acesso às cotações.');
    const q = await load(id);
    if (!q) return fail('Cotação não encontrada.', 404);
    return NextResponse.json({ quote: q });
  } catch (e) {
    if (missingPC(e)) return pcFail();
    return serverError(e);
  }
}


/** limpa a proposta que veio da tela (nada de confiar no navegador) */
function cleanProposal(raw: Record<string, unknown>, q: Quote, base: Proposal | null, by: string): Proposal | string {
  const pay = (raw.payment ?? {}) as Record<string, unknown>;
  const del = (raw.delivery ?? {}) as Record<string, unknown>;
  const status = raw.status === 'recebida' || raw.status === 'recusada' ? raw.status : 'aguardando';
  const lines: ProposalLine[] = [];
  for (const it of q.items) {
    const l = (Array.isArray(raw.lines) ? (raw.lines as Record<string, unknown>[]) : []).find((x) => x?.key === it.key) ?? {};
    const price = money(l.unit_price);
    const first = money(l.first_price);
    const qty = l.qty === null || l.qty === undefined || l.qty === '' ? null : intOr(l.qty);
    if (qty !== null && (qty < 1 || qty > 1_000_000)) return `Quantidade inválida em ${it.name}.`;
    lines.push({
      key: it.key,
      unit_price: price,
      first_price: first !== null && price !== null && first >= price ? first : null,
      qty,
      brand: str(l.brand, 60),
      model: str(l.model, 80),
      ext_code: str(l.ext_code, 60),
      warranty: str(l.warranty, 60),
      adherence: l.adherence === 'parcial' || l.adherence === 'nao' ? l.adherence : 'total',
      available: l.available !== false,
      note: str(l.note, 200),
    });
  }
  if (status === 'recebida' && !lines.some((l) => l.unit_price !== null && l.available)) return 'Proposta recebida precisa ter o preço de pelo menos um item.';
  const days = del.days === null || del.days === undefined || del.days === '' ? null : intOr(del.days);
  if (days !== null && (days < 0 || days > 365)) return 'Prazo de entrega inválido (0 a 365 dias).';
  const inst = intOr(pay.installments, 1) ?? 1;
  if (inst < 1 || inst > 48) return 'Número de parcelas inválido (1 a 48).';
  return {
    id: base?.id ?? crypto.randomUUID(),
    supplier_id: base?.supplier_id ?? String(raw.supplier_id),
    supplier_name: base?.supplier_name ?? '',
    cnpj: base?.cnpj ?? null,
    homologation: base?.homologation ?? 'pendente',
    status,
    sent_at: dateOrNull(raw.sent_at) ?? base?.sent_at ?? todayBahia(),
    sent_via: str(raw.sent_via, 30) ?? base?.sent_via ?? null,
    returned_at: status === 'aguardando' ? null : dateOrNull(raw.returned_at) ?? base?.returned_at ?? todayBahia(),
    valid_until: dateOrNull(raw.valid_until),
    payment: { mode: pay.mode === 'parcelado' ? 'parcelado' : 'avista', installments: pay.mode === 'parcelado' ? inst : 1, days: str(pay.days, 60), note: str(pay.note, 200) },
    delivery: { days, business: del.business !== false, mode: del.mode === 'producao' ? 'producao' : 'pronta', date: dateOrNull(del.date), location: str(del.location, 160) },
    freight: money(raw.freight) ?? 0,
    other_costs: money(raw.other_costs) ?? 0,
    discount: money(raw.discount) ?? 0,
    lines,
    attachments: cleanAttachments(raw.attachments),
    note: str(raw.note, 500),
    updated_at: nowIso(),
    updated_by: by,
  };
}

/**
 * Ações na cotação:
 *  proposal  — inclui ou atualiza a proposta de um fornecedor (pedido enviado, resposta, preços)
 *  remove    — tira um fornecedor que ainda não respondeu (as respondidas ficam no histórico)
 *  decide    — escolhe o fornecedor de cada item (com justificativa quando não é o recomendado)
 *              e gera os pedidos de compra em rascunho, um por fornecedor
 *  edit      — prazo de resposta e observação
 *  cancel    — cancela a cotação (as solicitações voltam para a fila)
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Cotação não encontrada.', 404);
  const b = await readJson<Record<string, unknown>>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!comprasEdit(user)) throw new AccessError(403, 'Só o setor de Compras (com edição) mexe nas cotações.');
    const q = await load(id);
    if (!q) return fail('Cotação não encontrada.', 404);
    if (q.status !== 'aberta') return fail(q.status === 'decidida' ? 'Esta cotação já foi decidida. Os pedidos de compra estão na aba Pedidos de compra.' : 'Esta cotação foi cancelada.', 409);
    const by = user.display_name;
    const at = nowIso();
    const action = String(b.action ?? '');
    let patch: Record<string, unknown> = {};
    let what = '';
    let orders: unknown[] = [];

    if (action === 'proposal') {
      const raw = (b.proposal ?? {}) as Record<string, unknown>;
      const base = typeof raw.id === 'string' ? q.proposals.find((p) => p.id === raw.id) ?? null : null;
      if (!base) {
        if (typeof raw.supplier_id !== 'string' || !UUID_RE.test(raw.supplier_id)) return fail('Escolha o fornecedor.');
        if (q.proposals.some((p) => p.supplier_id === raw.supplier_id)) return fail('Este fornecedor já está na cotação.', 409);
        if (q.proposals.length >= 12) return fail('No máximo 12 fornecedores por cotação.');
      }
      const { data: s } = await db().from('suppliers').select('id, name, trade_name, cnpj, homologation, active').eq('id', base?.supplier_id ?? String(raw.supplier_id)).maybeSingle();
      if (!s) return fail('Fornecedor não encontrado.', 404);
      if (s.homologation === 'bloqueado') return fail(`O fornecedor ${s.name} está bloqueado e não pode cotar.`, 409);
      const p = cleanProposal(raw, q, base, by);
      if (typeof p === 'string') return fail(p);
      p.supplier_id = s.id as string;
      p.supplier_name = (s.trade_name as string) || (s.name as string);
      p.cnpj = (s.cnpj as string) ?? null;
      p.homologation = (s.homologation as Proposal['homologation']) ?? 'pendente';
      patch.proposals = base ? q.proposals.map((x) => (x.id === base.id ? p : x)) : [...q.proposals, p];
      what = base ? (base.status !== p.status && p.status === 'recebida' ? `Proposta de ${p.supplier_name} recebida` : `Proposta de ${p.supplier_name} atualizada`) : `Pedido de orçamento para ${p.supplier_name}`;
    } else if (action === 'remove') {
      const p = q.proposals.find((x) => x.id === b.proposal_id);
      if (!p) return fail('Proposta não encontrada.', 404);
      if (p.status === 'recebida') return fail('Proposta recebida fica guardada no histórico. Marque "Não cotou" se o fornecedor desistiu.', 409);
      patch.proposals = q.proposals.filter((x) => x.id !== p.id);
      what = `${p.supplier_name} retirado da cotação`;
    } else if (action === 'edit') {
      if ('reply_by' in b) patch.reply_by = dateOrNull(b.reply_by);
      if ('note' in b) patch.note = str(b.note, 500);
      what = 'Dados da cotação alterados';
    } else if (action === 'cancel') {
      const reason = str(b.reason, 300);
      if (!reason) return fail('Diga o motivo do cancelamento.');
      patch = { status: 'cancelada' };
      what = `Cotação cancelada: ${reason}`;
      // solicitações que só estavam nesta cotação voltam para "Nova"
      const { data: rs } = await db().from('purchase_requests').select('*').in('id', q.request_ids);
      for (const r of (rs ?? []).map((x) => toRequest(x as Record<string, unknown>))) {
        if (r.status !== 'em_cotacao') continue;
        await db()
          .from('purchase_requests')
          .update({ status: 'nova', updated_at: at, history: [...r.history, { at, by, status: 'nova', note: `${quoteLabel(q.number)} cancelada: ${reason}` }].slice(-60) })
          .eq('id', r.id);
      }
    } else if (action === 'decide') {
      const pick = (b.lines ?? {}) as Record<string, unknown>;
      const justification = str(b.justification, 600);
      const today = todayBahia();
      const rec = recommend(q, today);
      const chosen: Record<string, string> = {};
      const reasons: string[] = [];
      for (const it of q.items) {
        const pid = pick[it.key];
        if (pid === null || pid === undefined || pid === '') continue; // item fica de fora desta compra
        const p = q.proposals.find((x) => x.id === pid);
        if (!p) return fail(`Escolha uma proposta válida para ${it.name}.`);
        const l = p.lines.find((x) => x.key === it.key);
        if (p.status !== 'recebida' || !l || l.unit_price === null || !l.available) return fail(`${p.supplier_name} não tem preço para ${it.name}.`);
        if (proposalExpired(p, today)) return fail(`A proposta de ${p.supplier_name} venceu em ${p.valid_until!.split('-').reverse().join('/')}. Peça para o fornecedor revalidar antes de decidir.`, 409);
        if (p.homologation !== 'homologado') {
          const { data: s } = await db().from('suppliers').select('homologation').eq('id', p.supplier_id).maybeSingle();
          if (s?.homologation !== 'homologado') return fail(`${p.supplier_name} ainda não foi homologado. Fornecedor novo passa pela validação (aba Fornecedores) antes da contratação.`, 409);
        }
        if (l.adherence === 'nao') reasons.push(`${it.name}: a proposta escolhida não atende à especificação`);
        if (rec[it.key] && rec[it.key]!.proposal_id !== p.id) reasons.push(`${it.name}: escolhido ${p.supplier_name}, não o de menor custo`);
        chosen[it.key] = p.id;
      }
      if (!Object.keys(chosen).length) return fail('Escolha o fornecedor de pelo menos um item.');
      if (reasons.length && (!justification || justification.length < 10)) {
        return fail(`Justifique a escolha (${reasons.join('; ')}).`, 400, { needs: 'justification', reasons });
      }
      const cfg = await loadConfig();
      // um pedido de compra (rascunho) por fornecedor escolhido
      const bySupplier = new Map<string, string[]>();
      for (const [key, pid] of Object.entries(chosen)) bySupplier.set(pid, [...(bySupplier.get(pid) ?? []), key]);
      for (const [pid, keys] of bySupplier) {
        const p = q.proposals.find((x) => x.id === pid)!;
        const only = new Set(keys);
        const share = proposalGoods(p, q.items) > 0 ? proposalGoods(p, q.items, only) / proposalGoods(p, q.items) : 1;
        const items: POItem[] = keys.map((key) => {
          const it = q.items.find((x) => x.key === key)!;
          const l = p.lines.find((x) => x.key === key)!;
          return {
            key,
            item_id: it.item_id,
            name: it.name,
            size: it.size,
            unit: it.unit,
            qty: l.qty ?? it.qty,
            unit_price: l.unit_price!,
            first_price: l.first_price,
            ext_code: l.ext_code,
            brand: l.brand,
            spec: [l.model, l.warranty ? `garantia ${l.warranty}` : null].filter(Boolean).join(' · ') || null,
            received: 0,
            requests: it.requests,
          };
        });
        const draft = {
          status: 'rascunho',
          quote_id: q.id,
          request_ids: [...new Set(items.flatMap((i) => i.requests.map((r) => r.id)))],
          supplier_id: p.supplier_id,
          supplier_name: p.supplier_name,
          cnpj: p.cnpj,
          items,
          freight: Math.round(p.freight * share * 100) / 100,
          other_costs: Math.round(p.other_costs * share * 100) / 100,
          discount: Math.round(p.discount * share * 100) / 100,
          payment: p.payment,
          delivery: { ...p.delivery, location: p.delivery.location || cfg.delivery_location },
          notes: p.note,
          attachments: p.attachments,
          created_by: by,
          history: [{ at, by, what: `Criado a partir da ${quoteLabel(q.number)}` }],
        };
        const total = poTotal(draft);
        const { data: po, error } = await db().from('purchase_orders').insert({ ...draft, total, approved_hash: null }).select('*').single();
        if (error) throw error;
        orders.push(toPO(po as Record<string, unknown>));
      }
      patch = { status: 'decidida', decision: { lines: chosen, justification, by, at } };
      what = `Mapa decidido: ${[...bySupplier.keys()].map((pid) => q.proposals.find((x) => x.id === pid)!.supplier_name).join(', ')}${justification ? ` — ${justification}` : ''}`;
    } else {
      return fail('Ação inválida.');
    }

    patch.updated_at = at;
    patch.history = [...q.history, { at, by, what }].slice(-100);
    const { data, error } = await db().from('purchase_quotes').update(patch).eq('id', id).eq('updated_at', q.updated_at).select('*').maybeSingle();
    if (error) throw error;
    if (!data) return fail('Outra pessoa alterou esta cotação agora. Confira e tente de novo.', 409);
    await broadcast('purchase:update', { by, quote: id });
    return NextResponse.json({ quote: toQuote(data as Record<string, unknown>), orders, labels: (orders as { number: number }[]).map((o) => poLabel(o.number)) });
  } catch (e) {
    if (missingPC(e)) return pcFail();
    return serverError(e);
  }
}
