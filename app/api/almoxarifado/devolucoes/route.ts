import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireAlmox } from '@/lib/access';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE, dbMessage, fetchAll } from '@/lib/almoxarifado/stockData';
import { LOTE_COLS, STATUS_LOTE, temEstoqueDevolucao, type Lote, type StatusLote } from '@/lib/rh/devolucaoEstoque';

export const dynamic = 'force-dynamic';

const SETUP = 'O estoque de devolução ainda não foi ativado no banco. Rode o arquivo supabase/contratos_e_devolucoes.sql no SQL Editor do Supabase.';

/** Estoque de devolução Fard/EPI: o que voltou dos colaboradores, esperando avaliação. */
export async function GET() {
  try {
    await requireAlmox('estoque', 'view');
    if (!(await temEstoqueDevolucao())) return fail(SETUP, 409, { setup: true });
    const lotes = await fetchAll<Lote>('return_stock', LOTE_COLS, { column: 'received_at', ascending: false, tiebreak: 'id' });
    return NextResponse.json({ lotes }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}

/**
 * Avalia um lote: ?id=<lote>
 *  { acao: 'higienizacao' }                          → vai para higienização
 *  { acao: 'reaproveitar', stock_item_id, qty? }     → entrada no estoque (com movimentação); qty menor separa o resto
 *  { acao: 'descartar', qty?, notes }                → descarte (motivo obrigatório)
 *  { acao: 'voltar' }                                → higienização volta para aguardando
 */
export async function PATCH(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!UUID_RE.test(id)) return fail('Lote não encontrado.', 404);
  const b = await readJson<{ acao?: unknown; stock_item_id?: unknown; qty?: unknown; notes?: unknown }>(req);
  if (!b) return fail('Dados inválidos.');
  const acao = String(b.acao ?? '');
  if (!['higienizacao', 'reaproveitar', 'descartar', 'voltar'].includes(acao)) return fail('Ação inválida.');
  const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 300) || null : null;
  try {
    const admin = await requireAlmox('estoque', 'edit');
    if (!(await temEstoqueDevolucao())) return fail(SETUP, 409, { setup: true });
    const { data: cur, error: e0 } = await db().from('return_stock').select(LOTE_COLS).eq('id', id).maybeSingle();
    if (e0) throw e0;
    if (!cur) return fail('Lote não encontrado.', 404);
    const lote = cur as Lote;
    const aberto = lote.status === 'aguardando' || lote.status === 'higienizacao';
    if (!aberto) return fail(`Este lote já foi ${lote.status === 'reaproveitado' ? 'reaproveitado' : 'descartado'}.`, 409);
    const now = new Date().toISOString();
    const hist = (what: string) => [...(lote.history ?? []), { at: now, by: admin.display_name, what }].slice(-50);

    if (acao === 'higienizacao' || acao === 'voltar') {
      const to: StatusLote = acao === 'higienizacao' ? 'higienizacao' : 'aguardando';
      if (lote.status === to) return fail(`O lote já está ${STATUS_LOTE[to].toLowerCase()}.`, 409);
      const { data, error } = await db().from('return_stock').update({ status: to, notes: notes ?? lote.notes, history: hist(STATUS_LOTE[to]) }).eq('id', id).eq('status', lote.status).select('id').maybeSingle();
      if (error) throw error;
      if (!data) return fail('O lote mudou enquanto você avaliava. Atualize a página.', 409);
      await broadcast('stock:update', { by: admin.display_name });
      return NextResponse.json({ ok: true });
    }

    // reaproveitar ou descartar: todo o lote ou parte (o resto fica como estava)
    const qty = b.qty === undefined || b.qty === null || b.qty === '' ? lote.qty : Number(b.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > lote.qty) return fail(`A quantidade precisa ser de 1 a ${lote.qty}.`);
    if (acao === 'descartar' && !notes) return fail('Informe o motivo do descarte.');
    let item: { id: string; name: string; size: string | null } | null = null;
    if (acao === 'reaproveitar') {
      if (typeof b.stock_item_id !== 'string' || !UUID_RE.test(b.stock_item_id)) return fail('Escolha o item do estoque que vai receber as peças.');
      const { data: it, error: e1 } = await db().from('stock_items').select('id, name, size').eq('id', b.stock_item_id).maybeSingle();
      if (e1) throw e1;
      if (!it) return fail('Item do estoque não encontrado.', 404);
      item = it as { id: string; name: string; size: string | null };
    }
    const to: StatusLote = acao === 'reaproveitar' ? 'reaproveitado' : 'descartado';
    const what = acao === 'reaproveitar' ? `Reaproveitado: entrada de ${qty} em ${item!.name}${item!.size ? ' ' + item!.size : ''}` : `Descartado: ${qty} (${notes})`;
    // primeiro trava o lote (só se ninguém mexeu nele)
    const { data: upd, error: e2 } = await db()
      .from('return_stock')
      .update({ status: to, qty, stock_item_id: item?.id ?? null, decided_by: admin.display_name, decided_at: now, notes: notes ?? lote.notes, history: hist(what) })
      .eq('id', id)
      .eq('status', lote.status)
      .select('id')
      .maybeSingle();
    if (e2) throw e2;
    if (!upd) return fail('O lote mudou enquanto você avaliava. Atualize a página.', 409);
    if (acao === 'reaproveitar') {
      const { error: e3 } = await db().rpc('stock_move', {
        p_item: item!.id,
        p_kind: 'entrada',
        p_qty: qty,
        p_posto: null,
        p_note: `Devolução de ${lote.collaborator_name ?? 'colaborador'} (${lote.item_name}${lote.size ? ' ' + lote.size : ''}) higienizada e reaproveitada`.slice(0, 200),
        p_by: admin.display_name,
      });
      if (e3) {
        // a entrada não aconteceu: o lote volta como estava
        await db().from('return_stock').update({ status: lote.status, qty: lote.qty, stock_item_id: null, decided_by: null, decided_at: null, history: lote.history }).eq('id', id);
        const m = dbMessage(e3);
        if (m) return fail(m, 400);
        throw e3;
      }
    }
    // o resto do lote continua esperando avaliação
    if (qty < lote.qty) {
      const { error: e4 } = await db()
        .from('return_stock')
        .insert({ return_id: lote.return_id, collaborator_id: lote.collaborator_id, collaborator_name: lote.collaborator_name, item_name: lote.item_name, size: lote.size, qty: lote.qty - qty, received_at: lote.received_at, status: lote.status, created_by: admin.display_name, history: [{ at: now, by: admin.display_name, what: `Separado do lote (${lote.qty - qty} de ${lote.qty})` }] });
      if (e4) throw e4;
    }
    await broadcast('stock:update', { by: admin.display_name });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
