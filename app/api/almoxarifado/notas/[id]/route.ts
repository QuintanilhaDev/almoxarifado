import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { UUID_RE, loadItems } from '@/lib/almoxarifado/stockData';
import { financeNotes, notesAccess } from '@/lib/pedidos/access';
import { missingP3, p3Fail } from '@/lib/pedidos/server';
import { NOTE_COLS, toNote } from '@/lib/notas/server';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Nota não encontrada.', 404);
  try {
    const user = await requireUser();
    if (!financeNotes(user)) throw new AccessError(403, 'Você não tem acesso às notas fiscais.');
    const wantXml = new URL(req.url).searchParams.get('xml') === '1';
    const { data, error } = await db().from('fiscal_notes').select((wantXml ? 'number, series, xml' : NOTE_COLS) as string).eq('id', id).maybeSingle();
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
  const b = await readJson<{ links?: unknown; purchase_request_id?: unknown }>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!notesAccess(user, 'edit')) throw new AccessError(403, 'Só quem lança notas pode alterar.');
    const { data: cur, error: e1 } = await db().from('fiscal_notes').select(NOTE_COLS).eq('id', id).maybeSingle();
    if (e1) throw e1;
    if (!cur) return fail('Nota não encontrada.', 404);
    const note = toNote(cur as Record<string, unknown>);
    if (note.status === 'lancada' || note.status === 'estornada') return fail('Nota já encerrada.', 409);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (Array.isArray(b.links)) {
      const stock = new Set((await loadItems()).map((i) => i.id));
      const items = note.items.map((l, i) => {
        const link = (b.links as { i: number; item_id: string | null }[]).find((x) => Number(x?.i) === i);
        if (!link) return l;
        if (l.received > 0 && link.item_id !== l.item_id) return l; // o que já entrou não muda de item
        return { ...l, item_id: link.item_id && stock.has(link.item_id) ? link.item_id : null, via: null };
      });
      patch.items = items;
    }
    if (b.purchase_request_id !== undefined) patch.purchase_request_id = typeof b.purchase_request_id === 'string' && UUID_RE.test(b.purchase_request_id) ? b.purchase_request_id : null;
    const { data, error } = await db().from('fiscal_notes').update(patch).eq('id', id).eq('updated_at', note.updated_at).select(NOTE_COLS).maybeSingle();
    if (error) throw error;
    if (!data) return fail('Outra pessoa alterou esta nota. Atualize e confira.', 409);
    return NextResponse.json({ note: toNote(data as Record<string, unknown>) });
  } catch (e) {
    return serverError(e);
  }
}
