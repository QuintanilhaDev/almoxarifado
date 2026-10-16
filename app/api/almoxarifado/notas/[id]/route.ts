import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { UUID_RE, loadItems } from '@/lib/almoxarifado/stockData';
import { financeNotes, notesAccess } from '@/lib/pedidos/access';
import { missingP3, p3Fail } from '@/lib/pedidos/server';
import { NOTE_COLS, hasPC, noteCols, noteOrderIds, toNote } from '@/lib/notas/server';
import { candidateOrders, recompute } from '@/lib/notas/flow';
import { cleanAttachments, toPO } from '@/lib/compras/pcServer';
import { PO_OPEN, poLabel, type PurchaseOrder } from '@/lib/compras/pc';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Nota não encontrada.', 404);
  try {
    const user = await requireUser();
    if (!financeNotes(user)) throw new AccessError(403, 'Você não tem acesso às notas fiscais.');
    const wantXml = new URL(req.url).searchParams.get('xml') === '1';
    const { data, error } = await db().from('fiscal_notes').select((wantXml ? 'number, series, xml' : await noteCols()) as string).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return fail('Nota não encontrada.', 404);
    if (wantXml) {
      const x = data as unknown as { number: string; xml: string | null };
      if (!x.xml) return fail('Esta nota foi digitada e não tem XML.', 404);
      return new Response(x.xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="NF-${x.number}.xml"` } });
    }
    const note = toNote(data as unknown as Record<string, unknown>);
    // ?orders=1: os pedidos ligados + os em aberto do mesmo fornecedor (para trocar o pedido de uma linha)
    if (new URL(req.url).searchParams.get('orders') === '1' && note.installments_status !== undefined) {
      return NextResponse.json({ note, orders: await candidateOrders(note) });
    }
    return NextResponse.json({ note });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}

/** Corrige a ligação dos itens ao estoque e a solicitação de compra atendida (antes de lançar tudo). */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Nota não encontrada.', 404);
  const b = await readJson<{ links?: unknown; purchase_request_id?: unknown; purchase_order_id?: unknown; purchase_order_ids?: unknown; po_links?: unknown; attachments?: unknown }>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!notesAccess(user, 'edit')) throw new AccessError(403, 'Só quem lança notas pode alterar.');
    const cols = await noteCols();
    const { data: cur, error: e1 } = await db().from('fiscal_notes').select(cols).eq('id', id).maybeSingle();
    if (e1) throw e1;
    if (!cur) return fail('Nota não encontrada.', 404);
    const note = toNote(cur as unknown as Record<string, unknown>);
    if (note.status === 'lancada' || note.status === 'estornada') return fail('Nota já encerrada.', 409);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (Array.isArray(b.links)) {
      const stock = new Set((await loadItems()).map((i) => i.id));
      const items = note.items.map((l, i) => {
        const link = (b.links as { i: number; item_id: string | null; factor?: number }[]).find((x) => Number(x?.i) === i);
        if (!link) return l;
        if (l.received > 0 && (link.item_id !== l.item_id || (link.factor !== undefined && Number(link.factor) !== (l.factor ?? 1)))) return l; // o que já entrou não muda
        const factor = link.factor !== undefined && Number(link.factor) > 0 && Number(link.factor) <= 100000 ? Number(link.factor) : l.factor ?? 1;
        return link.item_id === l.item_id && factor === (l.factor ?? 1) ? l : { ...l, item_id: link.item_id && stock.has(link.item_id) ? link.item_id : null, via: null, factor, po_id: null, po_key: null, po_why: null, po_lock: false };
      });
      patch.items = items;
    }
    if (b.purchase_request_id !== undefined) patch.purchase_request_id = typeof b.purchase_request_id === 'string' && UUID_RE.test(b.purchase_request_id) ? b.purchase_request_id : null;
    const pc = cols !== NOTE_COLS && (await hasPC());
    let chosen: PurchaseOrder[] | undefined;
    // pedidos da nota (pode ser mais de um, do mesmo fornecedor)
    if (pc && (b.purchase_order_id !== undefined || b.purchase_order_ids !== undefined)) {
      if (note.items.some((l) => l.received > 0)) return fail('Esta nota já teve entrada; não dá para trocar os pedidos de compra.', 409);
      const raw = Array.isArray(b.purchase_order_ids) ? b.purchase_order_ids : b.purchase_order_id ? [b.purchase_order_id] : [];
      const ids = [...new Set(raw.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))].slice(0, 20);
      chosen = [];
      if (ids.length) {
        const { data: os } = await db().from('purchase_orders').select('*').in('id', ids);
        for (const id of ids) {
          const o = (os ?? []).find((r) => r.id === id);
          if (!o) return fail('Pedido de compra não encontrado.', 404);
          const one = toPO(o as Record<string, unknown>);
          if (!PO_OPEN.includes(one.status) && !(one.status === 'aguardando_aprovacao' && one.approval) && !noteOrderIds(note).includes(one.id)) return fail(`O ${poLabel(one.number)} não está aprovado para receber notas.`, 409);
          if (one.cnpj && note.cnpj && one.cnpj !== note.cnpj) return fail(`O ${poLabel(one.number)} é de outro fornecedor (${one.supplier_name}).`, 409);
          chosen.push(one);
        }
      }
      // tirou um pedido: as linhas dele voltam para a ligação automática
      patch.items = ((patch.items as typeof note.items) ?? note.items).map((l) => (l.po_id && !ids.includes(l.po_id) && !l.received && !l.inspected_at ? { ...l, po_id: null, po_key: null, po_why: null, po_lock: false } : l));
    }
    // linha a linha, escolhido à mão (inclusive "fora de pedido"): a ligação automática não mexe mais
    if (pc && Array.isArray(b.po_links)) {
      const base = (patch.items as typeof note.items) ?? note.items;
      const pool = [...(chosen ?? []), ...(await candidateOrders(note, chosen))];
      const out = [...base];
      for (const x of b.po_links as { i?: unknown; po_id?: unknown; po_key?: unknown }[]) {
        const i = Number(x?.i);
        const l = out[i];
        if (!l) return fail('Linha da nota inválida.');
        if (l.received > 0) return fail(`${l.description}: já entrou no estoque; o pedido desta linha não muda mais.`, 409);
        if ((x as { auto?: unknown })?.auto === true) {
          out[i] = { ...l, po_id: null, po_key: null, po_why: null, po_lock: false };
          continue;
        }
        if (x?.po_id === null || x?.po_id === '') {
          out[i] = { ...l, po_id: null, po_key: null, po_why: 'fora de pedido (escolhido à mão)', po_lock: true };
          continue;
        }
        const o = pool.find((p) => p.id === x?.po_id);
        const it = o?.items.find((y) => y.key === x?.po_key);
        if (!o || !it) return fail('Esse pedido/linha não está disponível para esta nota.', 404);
        if (l.item_id && it.item_id && l.item_id !== it.item_id) return fail(`${l.description}: a linha do ${poLabel(o.number)} é de outro item do estoque.`, 409);
        out[i] = { ...l, item_id: l.item_id ?? it.item_id, po_id: o.id, po_key: it.key, po_why: `${poLabel(o.number)} · ${it.name}${it.size ? ' ' + it.size : ''}: escolhido à mão`, po_lock: true };
        if (chosen && !chosen.some((c) => c.id === o.id)) chosen.push(o);
      }
      patch.items = out;
    }
    if (pc && b.attachments !== undefined) patch.attachments = cleanAttachments(b.attachments);
    if (pc && (patch.items || chosen)) {
      const r = await recompute({ ...note, ...(patch as object) } as typeof note, chosen, true);
      Object.assign(patch, { items: r.items, divergences: r.divergences, status: r.status, purchase_order_ids: r.purchase_order_ids, purchase_order_id: r.purchase_order_id });
    }
    const { data, error } = await db().from('fiscal_notes').update(patch).eq('id', id).eq('updated_at', note.updated_at).select(cols).maybeSingle();
    if (error) throw error;
    if (!data) return fail('Outra pessoa alterou esta nota. Atualize e confira.', 409);
    return NextResponse.json({ note: toNote(data as unknown as Record<string, unknown>) });
  } catch (e) {
    return serverError(e);
  }
}
