import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { UUID_RE, loadItems } from '@/lib/almoxarifado/stockData';
import { financeNotes, notesAccess } from '@/lib/pedidos/access';
import { missingP3, p3Fail } from '@/lib/pedidos/server';
import { NOTE_COLS, hasPC, noteCols, toNote } from '@/lib/notas/server';
import { recompute } from '@/lib/notas/flow';
import { cleanAttachments, toPO } from '@/lib/compras/pcServer';
import { PO_OPEN, poLabel } from '@/lib/compras/pc';

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
    return NextResponse.json({ note: toNote(data as unknown as Record<string, unknown>) });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}

/** Corrige a ligação dos itens ao estoque e a solicitação de compra atendida (antes de lançar tudo). */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Nota não encontrada.', 404);
  const b = await readJson<{ links?: unknown; purchase_request_id?: unknown; purchase_order_id?: unknown; attachments?: unknown }>(req);
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
        return { ...l, item_id: link.item_id && stock.has(link.item_id) ? link.item_id : null, via: null, factor, po_key: link.item_id === l.item_id ? l.po_key : null };
      });
      patch.items = items;
    }
    if (b.purchase_request_id !== undefined) patch.purchase_request_id = typeof b.purchase_request_id === 'string' && UUID_RE.test(b.purchase_request_id) ? b.purchase_request_id : null;
    const pc = cols !== NOTE_COLS && (await hasPC());
    let po = undefined as Awaited<ReturnType<typeof toPO>> | null | undefined;
    if (pc && b.purchase_order_id !== undefined) {
      if (note.items.some((l) => l.received > 0)) return fail('Esta nota já teve entrada; não dá para trocar o pedido de compra.', 409);
      if (typeof b.purchase_order_id === 'string' && UUID_RE.test(b.purchase_order_id)) {
        const { data: o } = await db().from('purchase_orders').select('*').eq('id', b.purchase_order_id).maybeSingle();
        if (!o) return fail('Pedido de compra não encontrado.', 404);
        po = toPO(o as Record<string, unknown>);
        if (!PO_OPEN.includes(po.status) && !(po.status === 'aguardando_aprovacao' && po.approval)) return fail(`O ${poLabel(po.number)} não está aprovado para receber notas.`, 409);
        patch.purchase_order_id = po.id;
      } else {
        patch.purchase_order_id = null;
        po = null;
      }
      patch.items = ((patch.items as typeof note.items) ?? note.items).map((l) => ({ ...l, po_key: null }));
    }
    if (pc && b.attachments !== undefined) patch.attachments = cleanAttachments(b.attachments);
    if (pc && (patch.items || patch.purchase_order_id !== undefined)) {
      const r = await recompute({ ...note, ...(patch as object), purchase_order_id: (patch.purchase_order_id as string | null | undefined) ?? note.purchase_order_id } as typeof note, po);
      Object.assign(patch, { items: r.items, divergences: r.divergences, status: r.status });
    }
    const { data, error } = await db().from('fiscal_notes').update(patch).eq('id', id).eq('updated_at', note.updated_at).select(cols).maybeSingle();
    if (error) throw error;
    if (!data) return fail('Outra pessoa alterou esta nota. Atualize e confira.', 409);
    return NextResponse.json({ note: toNote(data as unknown as Record<string, unknown>) });
  } catch (e) {
    return serverError(e);
  }
}
