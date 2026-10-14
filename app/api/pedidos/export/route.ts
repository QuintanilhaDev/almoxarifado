import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { UUID_RE } from '@/lib/almoxarifado/stockData';
import { canSeeOrder } from '@/lib/pedidos/access';
import { ORDER_COLS, missingP3, p3Fail, toOrder } from '@/lib/pedidos/server';
import { ORIGIN_LABEL, isLate, lineLabel, orderLabel, todayBahia } from '@/lib/pedidos/types';
import { FMT, buildReport, xDate, xlsxResponseHeaders } from '@/lib/reportXlsx';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STAGE: Record<string, string> = { solicitado: 'Com a Operação', validacao: 'Aguardando validação', encaminhado: 'Com o Almoxarifado', concluido: 'Concluído', cancelado: 'Cancelado' };

/** Planilha dos pedidos que a tela está mostrando (com os filtros aplicados): ids no corpo. */
export async function POST(req: Request) {
  const b = await readJson<{ ids?: unknown; statuses?: unknown }>(req);
  if (!b || !Array.isArray(b.ids) || !b.ids.length) return fail('Nada para exportar.');
  if (b.ids.length > 3000) return fail('No máximo 3000 pedidos por planilha.');
  if (b.ids.some((x) => typeof x !== 'string' || !UUID_RE.test(x))) return fail('Pedido inválido.');
  const statuses = (b.statuses && typeof b.statuses === 'object' ? b.statuses : {}) as Record<string, string>;
  try {
    const user = await requireUser();
    const out = [];
    for (let i = 0; i < b.ids.length; i += 200) {
      const { data, error } = await db().from('material_orders').select(ORDER_COLS).in('id', (b.ids as string[]).slice(i, i + 200));
      if (error) throw error;
      out.push(...(data ?? []).map((r) => toOrder(r as Record<string, unknown>)));
    }
    const orders = out.filter((o) => canSeeOrder(user, o)).sort((a, b) => b.number - a.number);
    if (!orders.length) throw new AccessError(403, 'Nenhum destes pedidos está no seu painel.');
    type O = (typeof orders)[number];
    type L = { o: O; l: O['items'][number] };
    const lines: L[] = orders.flatMap((o) => o.items.map((l) => ({ o, l })));
    const open = orders.filter((o) => o.stage !== 'concluido' && o.stage !== 'cancelado');
    const buf = await buildReport({
      title: 'Pedidos de material',
      subtitle: `${orders.length} ${orders.length === 1 ? 'pedido' : 'pedidos'} na seleção`,
      by: user.display_name,
      footer: 'Pedidos de material',
      sections: [
        {
          title: 'Resumo',
          kpis: [
            { label: 'Pedidos', value: orders.length, fmt: FMT.int },
            { label: 'Em aberto', value: open.length, fmt: FMT.int },
            { label: 'Atrasados', value: open.filter(isLate).length, fmt: FMT.int, tone: open.some(isLate) ? 'bad' : 'plain' },
            { label: 'Unidades pedidas', value: lines.reduce((t, x) => t + x.l.qty, 0), fmt: FMT.int },
            { label: 'Unidades entregues', value: lines.reduce((t, x) => t + x.l.delivered, 0), fmt: FMT.int, tone: 'good' },
            { label: 'Unidades pendentes', value: lines.reduce((t, x) => t + Math.max(0, x.l.qty - x.l.delivered), 0), fmt: FMT.int, tone: 'warn' },
          ],
        },
      ],
      sheets: [
        {
          name: 'Pedidos',
          cols: [
            { header: 'Pedido', width: 9, align: 'center', value: (o: O) => orderLabel(o.number) },
            { header: 'Aberto em', width: 12, align: 'center', fmt: FMT.date, value: (o: O) => xDate(o.created_at) },
            { header: 'Origem', width: 24, value: (o: O) => ORIGIN_LABEL[o.origin] },
            { header: 'Etapa', width: 20, value: (o: O) => STAGE[o.stage] },
            { header: 'Status', width: 26, value: (o: O) => statuses[o.id] ?? '' },
            { header: 'Prioridade', width: 11, align: 'center', value: (o: O) => (o.priority === 'urgente' ? 'Urgente' : 'Normal'), tone: (o: O) => (o.priority === 'urgente' ? 'bad' : undefined) },
            { header: 'Prazo', width: 12, align: 'center', fmt: FMT.date, value: (o: O) => xDate(o.needed_by ?? o.start_date) },
            { header: 'Atrasado', width: 10, align: 'center', value: (o: O) => (isLate(o) ? 'Sim' : 'Não'), tone: (o: O) => (isLate(o) ? 'bad' : undefined) },
            { header: 'Colaborador', width: 26, value: (o: O) => o.collaborator_name },
            { header: 'Matrícula', width: 12, align: 'center', value: (o: O) => o.matricula },
            { header: 'Função', width: 16, value: (o: O) => o.role },
            { header: 'Posto', width: 24, value: (o: O) => o.posto_name },
            { header: 'Empresa', width: 16, value: (o: O) => o.company },
            { header: 'Solicitante', width: 18, value: (o: O) => o.requester },
          ],
          rows: orders,
        },
        {
          name: 'Itens',
          tab: 'green',
          cols: [
            { header: 'Pedido', width: 9, align: 'center', value: (x: L) => orderLabel(x.o.number) },
            { header: 'Origem', width: 24, value: (x: L) => ORIGIN_LABEL[x.o.origin] },
            { header: 'Para', width: 26, value: (x: L) => x.o.collaborator_name ?? x.o.posto_name },
            { header: 'Item', width: 30, value: (x: L) => lineLabel(x.l) },
            { header: 'Pedido (un.)', width: 13, align: 'center', fmt: FMT.int, value: (x: L) => x.l.qty },
            { header: 'Reservado', width: 12, align: 'center', fmt: FMT.int, value: (x: L) => x.l.reserved },
            { header: 'Entregue', width: 12, align: 'center', fmt: FMT.int, bar: 'green', value: (x: L) => x.l.delivered },
            { header: 'Pendente', width: 12, align: 'center', fmt: FMT.int, value: (x: L) => Math.max(0, x.l.qty - x.l.delivered), tone: (x: L) => (x.l.qty - x.l.delivered > 0 ? 'warn' : undefined) },
            { header: 'Compra', width: 12, align: 'center', value: (x: L) => (x.l.purchase_number ? `nº ${x.l.purchase_number}` : '') },
          ],
          rows: lines,
          totals: [4, 5, 6, 7],
        },
      ],
    });
    return new NextResponse(new Uint8Array(buf), { headers: xlsxResponseHeaders(`Pedidos-de-material_${todayBahia()}.xlsx`) });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
