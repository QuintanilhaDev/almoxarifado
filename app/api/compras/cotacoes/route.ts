import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE, str } from '@/lib/almoxarifado/stockData';
import { comprasEdit } from '@/lib/compras/access';
import { canSeeOrders, dateOrNull, missingPC, nowIso, pcFail, toQuote } from '@/lib/compras/pcServer';
import { toRequest } from '@/lib/compras/server';
import { quoteLabel, type Proposal, type QuoteItem } from '@/lib/compras/pc';
import { suggestSuppliers } from '@/lib/compras/suggest';

export const dynamic = 'force-dynamic';

/** Cotações (as mais recentes primeiro). */
export async function GET() {
  try {
    const user = await requireUser();
    if (!canSeeOrders(user)) throw new AccessError(403, 'Você não tem acesso às cotações.');
    const { data, error } = await db().from('purchase_quotes').select('*').order('created_at', { ascending: false }).limit(300);
    if (error) {
      if (missingPC(error)) return pcFail();
      throw error;
    }
    return NextResponse.json({ quotes: (data ?? []).map((r) => toQuote(r as Record<string, unknown>)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}

/**
 * Abre uma cotação a partir de uma ou mais solicitações de compra. Itens iguais de
 * solicitações diferentes viram uma linha só (consolidação), guardando de onde veio cada parte.
 */
export async function POST(req: Request) {
  const b = await readJson<{ request_ids?: unknown; reply_by?: unknown; note?: unknown; auto_suppliers?: unknown }>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!comprasEdit(user)) throw new AccessError(403, 'Só o setor de Compras (com edição) abre cotações.');
    const ids = Array.isArray(b.request_ids) ? [...new Set(b.request_ids.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))] : [];
    if (!ids.length) return fail('Escolha pelo menos uma solicitação de compra.');
    if (ids.length > 30) return fail('No máximo 30 solicitações por cotação.');
    const { data: rs, error: e1 } = await db().from('purchase_requests').select('*').in('id', ids);
    if (e1) throw e1;
    const reqs = (rs ?? []).map((r) => toRequest(r as Record<string, unknown>));
    if (reqs.length !== ids.length) return fail('Uma das solicitações não existe mais. Atualize a página.', 409);
    const closed = reqs.find((r) => !['nova', 'em_cotacao'].includes(r.status));
    if (closed) return fail(`A solicitação #${String(closed.number).padStart(4, '0')} já está "${closed.status}" e não entra em cotação.`, 409);

    // a mesma solicitação já está numa cotação aberta? (evita cotação duplicada)
    const { data: open } = await db().from('purchase_quotes').select('number, request_ids').eq('status', 'aberta');
    for (const q of open ?? []) {
      const dup = ids.find((id) => ((q.request_ids as string[]) ?? []).includes(id));
      if (dup) {
        const r = reqs.find((x) => x.id === dup)!;
        return fail(`A solicitação #${String(r.number).padStart(4, '0')} já está na ${quoteLabel(Number(q.number))}, ainda aberta.`, 409);
      }
    }

    const items: QuoteItem[] = [];
    for (const r of reqs.sort((a, z) => a.number - z.number)) {
      for (const i of r.items) {
        const same = items.find((x) => (i.item_id ? x.item_id === i.item_id : !x.item_id && x.name.toLowerCase() === i.name.toLowerCase() && (x.size ?? '').toLowerCase() === (i.size ?? '').toLowerCase()));
        if (same) {
          same.qty += i.quantity;
          same.requests.push({ id: r.id, number: r.number, qty: i.quantity });
        } else {
          items.push({ key: `k${items.length + 1}`, item_id: i.item_id, name: i.name, size: i.size, unit: i.unit || 'Cada', qty: i.quantity, requests: [{ id: r.id, number: r.number, qty: i.quantity }] });
        }
      }
    }
    if (!items.length) return fail('As solicitações escolhidas não têm itens.');

    const at = nowIso();
    // os fornecedores que já vendem estes itens entram sozinhos (até 5), para pedir orçamento
    const proposals: Proposal[] = [];
    if (b.auto_suppliers !== false) {
      const hints = await suggestSuppliers(items).catch(() => ({}) as Awaited<ReturnType<typeof suggestSuppliers>>);
      const rank = new Map<string, { h: (typeof hints)[string][number]; score: number; keys: string[] }>();
      for (const [key, list] of Object.entries(hints)) {
        for (const h of list) {
          const cur = rank.get(h.supplier_id) ?? { h, score: 0, keys: [] };
          cur.score += h.score;
          cur.keys.push(key);
          rank.set(h.supplier_id, cur);
        }
      }
      for (const { h } of [...rank.values()].sort((a, z) => z.score - a.score).slice(0, 5)) {
        const { data: s } = await db().from('suppliers').select('cnpj').eq('id', h.supplier_id).maybeSingle();
        proposals.push({
          id: crypto.randomUUID(),
          supplier_id: h.supplier_id,
          supplier_name: h.name,
          cnpj: (s?.cnpj as string) ?? null,
          homologation: h.homologation as Proposal['homologation'],
          status: 'aguardando',
          sent_at: null,
          sent_via: null,
          returned_at: null,
          valid_until: null,
          payment: { mode: 'avista', installments: 1, days: null, note: null },
          delivery: { days: h.lead_days, business: h.lead_business, mode: h.mode, date: null, location: null },
          freight: 0,
          other_costs: 0,
          discount: 0,
          lines: items.map((i) => ({ key: i.key, unit_price: null, first_price: null, qty: null, brand: null, model: null, ext_code: null, warranty: null, adherence: 'total', available: true, note: null })),
          attachments: [],
          note: `Sugerido: ${h.reasons.join(', ')}`,
          updated_at: at,
          updated_by: 'Max Hub',
        });
      }
    }
    const { data, error } = await db()
      .from('purchase_quotes')
      .insert({
        request_ids: ids,
        items,
        proposals,
        reply_by: dateOrNull(b.reply_by),
        note: str(b.note, 500),
        created_by: user.display_name,
        history: [{ at, by: user.display_name, what: `Cotação aberta para ${reqs.length === 1 ? 'a solicitação' : 'as solicitações'} ${reqs.map((r) => '#' + String(r.number).padStart(4, '0')).join(', ')}` }],
      })
      .select('*')
      .single();
    if (error) {
      if (missingPC(error)) return pcFail();
      throw error;
    }
    const quote = toQuote(data as Record<string, unknown>);
    // solicitações passam para "Em cotação"
    for (const r of reqs.filter((x) => x.status === 'nova')) {
      await db()
        .from('purchase_requests')
        .update({ status: 'em_cotacao', handled_by: user.display_name, updated_at: at, history: [...r.history, { at, by: user.display_name, status: 'em_cotacao', note: `${quoteLabel(quote.number)} aberta` }].slice(-60) })
        .eq('id', r.id);
    }
    await broadcast('purchase:update', { by: user.display_name, quote: quote.id });
    return NextResponse.json({ quote });
  } catch (e) {
    if (missingPC(e)) return pcFail();
    return serverError(e);
  }
}
