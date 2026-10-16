import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE, str } from '@/lib/almoxarifado/stockData';
import { notesAccess } from '@/lib/pedidos/access';
import { ORDER_COLS, dbRule, missingP3, p3Fail, toOrder } from '@/lib/pedidos/server';
import { hasPC, noteCols, noteOrderIds, toNote, type FiscalNote, type NoteLine } from '@/lib/notas/server';
import { entryBlockers, loadNote, ordersOf, preStatus, recompute } from '@/lib/notas/flow';
import { installmentsGap, moneyBR, type Installment } from '@/lib/notas/conferencia';
import { canApprove, canTreat, dateOrNull, money } from '@/lib/compras/pcServer';
import { syncRequests } from '@/lib/compras/poServer';
import { orderLabel } from '@/lib/pedidos/types';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string; action: string }> };

async function save(n: FiscalNote, patch: Record<string, unknown>, what: string, by: string) {
  const at = new Date().toISOString();
  const { data, error } = await db()
    .from('fiscal_notes')
    .update({ ...patch, updated_at: at, history: [...n.history, { at, by, what }].slice(-150) })
    .eq('id', n.id)
    .eq('updated_at', n.updated_at)
    .select(await noteCols())
    .maybeSingle();
  if (error) throw error;
  return data ? toNote(data as unknown as Record<string, unknown>) : null;
}

/**
 * conferencia — conferência física por linha: entregue, aceito, recusado e observação
 *               (em unidades do estoque). Nada entra no estoque aqui.
 * divergencia — Compras/gestão trata uma divergência (com justificativa); "autorizar" uma
 *               exceção comercial exige a permissão de aprovação.
 * parcelas    — grava as parcelas; "validar" exige soma igual ao total da nota (centavos).
 * post        — confirma a entrada do que foi aceito. Exige parcelas validadas e nenhuma
 *               divergência comercial aberta. Sem conferência registrada, quem confirma
 *               está conferindo: o que entra conta como entregue e aceito.
 * reverse     — estorna a nota (movimentos novos; a entrada original fica no histórico).
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id, action } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Nota não encontrada.', 404);
  const b = (await readJson<Record<string, unknown>>(req)) ?? {};
  try {
    const user = await requireUser();
    const by = user.display_name;
    const treating = action === 'divergencia';
    if (treating ? !canTreat(user) : !notesAccess(user, 'edit')) {
      throw new AccessError(403, treating ? 'Divergência é tratada por Compras ou por quem aprova as compras.' : 'Só quem lança notas no Almoxarifado pode fazer isso.');
    }
    const pc = await hasPC();
    const n = await loadNote(id);
    if (!n) return fail('Nota não encontrada.', 404);
    const open = n.status !== 'lancada' && n.status !== 'estornada';

    if (action === 'conferencia') {
      if (!pc) return fail('A conferência por linha precisa do supabase/compras_pedidos.sql.', 409);
      if (!open) return fail('Esta nota já foi encerrada.', 409);
      if (!Array.isArray(b.lines)) return fail('Informe a conferência.');
      const at = new Date().toISOString();
      const items: NoteLine[] = n.items.map((l, i) => {
        const x = (b.lines as Record<string, unknown>[]).find((y) => Number(y?.i) === i);
        if (!x) return l;
        return { ...l, delivered: Number(x.delivered), accepted: Number(x.accepted), refused: Number(x.refused ?? 0), inspection_note: str(x.note, 200), inspected_by: by, inspected_at: at, inspection_auto: false };
      });
      for (const [i, l] of items.entries()) {
        if (l.inspected_at !== at) continue;
        const invoiced = l.qty * (l.factor || 1);
        const vals = [l.delivered, l.accepted, l.refused].map(Number);
        if (vals.some((v) => !Number.isInteger(v) || v < 0)) return fail(`Linha ${i + 1}: use números inteiros.`);
        if (l.delivered! > invoiced) return fail(`${l.description}: chegou mais (${l.delivered}) do que o faturado (${invoiced}). Registre só o faturado e avise Compras.`);
        if (l.accepted! + l.refused! !== l.delivered) return fail(`${l.description}: aceito + recusado precisa dar o entregue (${l.delivered}).`);
        if (l.accepted! < (l.received ?? 0)) return fail(`${l.description}: ${l.received} já entraram no estoque; o aceito não pode ser menor.`);
        if (l.refused! > 0 && !l.inspection_note) return fail(`${l.description}: diga o motivo da recusa (avaria, especificação, tamanho…).`);
      }
      const r = await recompute({ ...n, items });
      const saved = await save(n, { items: r.items, divergences: r.divergences, status: r.status, purchase_order_ids: r.purchase_order_ids, purchase_order_id: r.purchase_order_id }, `Conferência física registrada${(r.divergences ?? []).some((d) => d.status !== 'resolvida' && !d.blocking) ? ' (com falta/recusa)' : ''}`, by);
      if (!saved) return fail('Outra pessoa alterou esta nota agora. Atualize e confira.', 409);
      await broadcast('note:update', { id, by });
      return NextResponse.json({ note: saved, blockers: entryBlockers(saved) });
    }

    if (action === 'divergencia') {
      if (!pc) return fail('Precisa do supabase/compras_pedidos.sql.', 409);
      const d = (n.divergences ?? []).find((x) => x.id === b.divergence_id);
      if (!d) return fail('Divergência não encontrada.', 404);
      if (d.status === 'resolvida') return fail('Esta divergência já foi tratada.', 409);
      const resolution = str(b.resolution, 400);
      if (!resolution || resolution.length < 5) return fail('Descreva o tratamento (ex.: fornecedor vai emitir carta de correção; preço autorizado pela gestão).');
      const decision: 'autorizada' | 'tratada' = b.decision === 'autorizada' ? 'autorizada' : 'tratada';
      if (decision === 'autorizada' && d.blocking && !canApprove(user)) return fail('Autorizar uma exceção comercial exige a permissão "Aprovação de compras". Registre como tratada ou peça a quem aprova.', 403);
      const divergences = (n.divergences ?? []).map((x) => (x.id === d.id ? { ...x, status: 'resolvida' as const, decision, resolution, by, at: new Date().toISOString() } : x));
      const status = preStatus({ ...n, divergences });
      const saved = await save(n, { divergences, status }, `Divergência ${decision === 'autorizada' ? 'autorizada' : 'tratada'} por ${by}: ${d.text} — ${resolution}`, by);
      if (!saved) return fail('Outra pessoa alterou esta nota agora. Atualize e confira.', 409);
      await broadcast('note:update', { id, by });
      return NextResponse.json({ note: saved, blockers: entryBlockers(saved) });
    }

    if (action === 'parcelas') {
      if (!pc) return fail('Precisa do supabase/compras_pedidos.sql.', 409);
      if (n.status === 'estornada') return fail('Nota estornada.', 409);
      if (!Array.isArray(b.installments)) return fail('Informe as parcelas.');
      const list: Installment[] = (b.installments as Record<string, unknown>[]).slice(0, 48).map((x, i) => ({
        n: str(x?.n, 10) ?? `${i + 1}/${(b.installments as unknown[]).length}`,
        due: dateOrNull(x?.due),
        value: money(x?.value) ?? 0,
        obs: str(x?.obs, 120),
        method: str(x?.method, 40),
        ref: str(x?.ref, 80),
      }));
      if (list.some((p) => !p.due)) return fail('Toda parcela precisa da data de vencimento.');
      if (list.some((p) => !(p.value > 0))) return fail('Toda parcela precisa de valor maior que zero.');
      const total = Number(n.totals?.total ?? 0);
      const gap = installmentsGap(list, total);
      const validate = b.validate === true;
      if (validate && gap !== 0) {
        return fail(`A soma das parcelas (${moneyBR(total + gap)}) não bate com o total da nota (${moneyBR(total)}): diferença de ${moneyBR(Math.abs(gap))}.`, 400, { gap });
      }
      // registra o que mudou (sem alteração silenciosa)
      const fmt = (p: Installment) => `${p.n} ${p.due?.split('-').reverse().join('/')} ${moneyBR(p.value)}`;
      const before = n.installments.map(fmt).join(', ');
      const after = list.map(fmt).join(', ');
      const what = before === after ? (validate ? `Parcelas validadas (${list.length}x, total ${moneyBR(total)})` : 'Parcelas conferidas') : `Parcelas ${before ? `alteradas de [${before}] para` : 'registradas:'} [${after}]${validate ? ' e validadas' : ''}`;
      const saved = await save(n, { installments: list, installments_status: validate ? 'validada' : 'incompleta' }, what, by);
      if (!saved) return fail('Outra pessoa alterou esta nota agora. Atualize e confira.', 409);
      // mudou o pagamento: compara de novo com o pedido
      if (noteOrderIds(saved).length) {
        const r = await recompute(saved);
        const { data } = await db().from('fiscal_notes').update({ items: r.items, divergences: r.divergences, status: r.status, purchase_order_ids: r.purchase_order_ids, purchase_order_id: r.purchase_order_id }).eq('id', id).select(await noteCols()).single();
        await broadcast('note:update', { id, by });
        const final = data ? toNote(data as unknown as Record<string, unknown>) : saved;
        return NextResponse.json({ note: final, gap, blockers: entryBlockers(final) });
      }
      await broadcast('note:update', { id, by });
      return NextResponse.json({ note: saved, gap, blockers: entryBlockers(saved) });
    }

    if (action === 'post') {
      if (!Array.isArray(b.lines) || !b.lines.length) return fail('Informe o que foi recebido.');
      const lines = (b.lines as Record<string, unknown>[]).map((x) => ({ i: Number(x?.i), item_id: typeof x?.item_id === 'string' && UUID_RE.test(x.item_id) ? x.item_id : null, qty: Number(x?.qty) }));
      if (lines.some((l) => !Number.isInteger(l.i) || !Number.isFinite(l.qty) || l.qty < 0)) return fail('Quantidades inválidas.');
      if (pc) {
        let cur = n;
        // sem conferência registrada: quem confirma está conferindo (entregue = aceito = o que entra)
        // (conferência que nasceu de uma entrada anterior é estendida; a registrada na tela de conferência, não)
        const auto = lines.filter((l) => l.qty > 0 && cur.items[l.i] && (!cur.items[l.i].inspected_at || cur.items[l.i].inspection_auto));
        if (auto.length) {
          const at = new Date().toISOString();
          const items = cur.items.map((l, i) => {
            const a = auto.find((x) => x.i === i);
            if (!a) return l;
            const got = (l.received ?? 0) + a.qty;
            return { ...l, item_id: a.item_id ?? l.item_id, delivered: got, accepted: got, refused: 0, inspected_by: by, inspected_at: at, inspection_auto: true };
          });
          const r = await recompute({ ...cur, items });
          const s2 = await save(cur, { items: r.items, divergences: r.divergences, status: r.status, purchase_order_ids: r.purchase_order_ids, purchase_order_id: r.purchase_order_id }, 'Conferência registrada na confirmação da entrada', by);
          if (!s2) return fail('Outra pessoa alterou esta nota agora. Atualize e confira.', 409);
          cur = s2;
        }
        const blockers = entryBlockers(cur);
        if (blockers.length) return fail(`Antes de dar entrada: ${blockers.join('; ')}.`, 409, { blockers, note: cur });
        for (const l of lines.filter((x) => x.qty > 0)) {
          const line = cur.items[l.i];
          if (!line) return fail('Linha da nota inválida.');
          const room = (line.accepted ?? 0) - (line.received ?? 0);
          if (l.qty > room) return fail(`${line.description}: a conferência aceitou ${line.accepted ?? 0}${line.received ? ` e ${line.received} já entraram` : ''}. Só ${Math.max(0, room)} pode entrar agora.`, 409);
        }
      }
      const { data, error } = await db().rpc('post_fiscal_note', { p_note: id, p_lines: lines.filter((l) => l.qty > 0), p_by: by });
      if (error) throw error;
      const { data: nd } = await db().from('fiscal_notes').select(await noteCols()).eq('id', id).single();
      let note = toNote(nd as unknown as Record<string, unknown>);
      // falta/recusa: a nota fica "parcial" até o resto chegar ou alguém encerrar
      if (pc && note.status !== 'lancada') {
        const st = preStatus(note);
        if (st !== note.status) {
          const { data: n2 } = await db().from('fiscal_notes').update({ status: st }).eq('id', id).select(await noteCols()).single();
          if (n2) note = toNote(n2 as unknown as Record<string, unknown>);
        }
      }
      // solicitação de compra antiga ligada direto à nota
      let purchase: { number: number } | null = null;
      if (note.purchase_request_id && note.status === 'lancada' && !noteOrderIds(note).length) {
        const { data: pr } = await db().from('purchase_requests').select('id, number, status, history').eq('id', note.purchase_request_id).maybeSingle();
        if (pr && !['entregue', 'cancelada', 'recusada'].includes(pr.status as string)) {
          const now = new Date().toISOString();
          await db()
            .from('purchase_requests')
            .update({ status: 'entregue', updated_at: now, history: [...((pr.history as unknown[]) ?? []), { at: now, by, status: 'entregue', note: `Recebida no Almoxarifado pela NF ${note.number}` }] })
            .eq('id', pr.id);
          purchase = { number: Number(pr.number) };
          await broadcast('purchase:update', { id: pr.id, number: pr.number, status: 'entregue', by, changed: true });
        }
      }
      // pedidos de compra: baixa do "a receber" (feita no banco, um a um) e solicitações em dia
      const pos = pc ? await ordersOf(note) : [];
      const reqs = [...new Set(pos.flatMap((o) => o.request_ids))];
      if (reqs.length) await syncRequests(reqs, by);
      for (const o of pos) await broadcast('purchase:update', { by, order: o.id, status: o.status });
      const po = pos[0] ?? null;
      // pedidos de material que esperavam estes itens (para reservar agora)
      const received = new Set(note.items.filter((l) => l.item_id && l.received > 0).map((l) => l.item_id));
      const { data: os } = await db().from('material_orders').select(ORDER_COLS).eq('stage', 'encaminhado').limit(300);
      const waiting = (os ?? [])
        .map((r) => toOrder(r as Record<string, unknown>))
        .map((o) => ({ id: o.id, number: o.number, label: orderLabel(o.number), who: o.collaborator_name ?? o.posto_name, lines: o.items.map((l, i) => ({ i, l })).filter(({ l }) => l.item_id && received.has(l.item_id) && l.qty - l.delivered - l.reserved > 0).map(({ i, l }) => ({ i, name: l.name, size: l.size, missing: l.qty - l.delivered - l.reserved })) }))
        .filter((o) => o.lines.length);
      await broadcast('note:update', { id, by });
      await broadcast('stock:update', { by });
      return NextResponse.json({ result: data, note, purchase, order: po ? { number: po.number, status: po.status } : null, orders: pos.map((o) => ({ number: o.number, status: o.status })), waiting });
    }

    if (action === 'reverse') {
      const reason = str(b.reason, 300);
      if (!reason) return fail('Diga o motivo do estorno.');
      const { data, error } = await db().rpc('reverse_fiscal_note', { p_note: id, p_reason: reason, p_by: by });
      if (error) throw error;
      const pos = pc ? await ordersOf(n) : [];
      const reqs = [...new Set(pos.flatMap((o) => o.request_ids))];
      if (reqs.length) await syncRequests(reqs, by);
      await broadcast('note:update', { id, by });
      await broadcast('stock:update', { by });
      for (const o of pos) await broadcast('purchase:update', { by, order: o.id });
      return NextResponse.json({ result: data });
    }
    return fail('Ação inválida.', 404);
  } catch (e) {
    const rule = dbRule(e);
    if (rule) return fail(rule.message, 409);
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
