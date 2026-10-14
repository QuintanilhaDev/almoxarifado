import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/access';
import { serverError } from '@/lib/http';
import { indicators } from '@/lib/gestao';
import { missingP3, p3Fail } from '@/lib/pedidos/server';
import { FMT, buildReport, xDate, xlsxResponseHeaders } from '@/lib/reportXlsx';
import { todayBahia } from '@/lib/pedidos/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const user = await requireMaster();
    const days = Math.min(365, Math.max(7, Number(new URL(req.url).searchParams.get('days')) || 30));
    const d = await indicators(days);
    const P = { 7: 'Últimos 7 dias', 30: 'Últimos 30 dias', 90: 'Últimos 90 dias', 365: 'Últimos 12 meses' }[days] ?? `Últimos ${days} dias`;
    const buf = await buildReport({
      title: 'Gestão · Max Hub',
      subtitle: `Grupo Max Forte  ·  ${P}`,
      by: user.display_name,
      footer: 'Gestão',
      sections: [
        {
          title: 'Estoque agora',
          kpis: [
            { label: 'Valor em estoque', value: d.stock.value, fmt: FMT.money, note: d.stock.noCost ? `${d.stock.noCost} ${d.stock.noCost === 1 ? 'item sem custo fica' : 'itens sem custo ficam'} fora` : 'Saldo × custo médio' },
            { label: 'Itens ativos', value: d.stock.items, fmt: FMT.int },
            { label: 'Saldo físico (unidades)', value: d.stock.physical, fmt: FMT.int, note: 'O que está na prateleira' },
            { label: 'Reservado (unidades)', value: d.stock.reserved, fmt: FMT.int, note: 'Separado para pedidos' },
            { label: 'Disponível (unidades)', value: d.stock.available, fmt: FMT.int, note: 'Físico − reservado' },
            { label: 'Itens no mínimo ou abaixo', value: d.stock.below, fmt: FMT.int, tone: d.stock.below ? 'bad' : 'plain' },
            { label: 'Itens com reposição sugerida', value: d.replenish, fmt: FMT.int, tone: d.replenish ? 'warn' : 'plain' },
          ],
        },
        {
          title: 'Pedidos de material',
          kpis: [
            { label: 'Em aberto', value: d.orders.open, fmt: FMT.int },
            { label: 'Parcialmente atendidos', value: d.orders.partial, fmt: FMT.int },
            { label: 'Aguardando compra', value: d.orders.waitingPurchase, fmt: FMT.int, tone: d.orders.waitingPurchase ? 'warn' : 'plain' },
            { label: 'Atrasados', value: d.orders.late, fmt: FMT.int, tone: d.orders.late ? 'bad' : 'plain' },
            { label: 'Concluídos no período', value: d.orders.done, fmt: FMT.int, tone: 'good' },
            { label: 'Cancelados no período', value: d.orders.cancelled, fmt: FMT.int },
            { label: 'Tempo médio de atendimento (dias)', value: d.orders.avgDays ?? '—', fmt: FMT.dec },
          ],
          table: { headers: ['Origem', 'Em aberto', 'Entregues'], rows: d.orders.byOrigin.map((o) => [o.label, o.open, o.done]), fmts: [undefined, FMT.int, FMT.int] },
        },
        {
          title: 'Compras e notas',
          kpis: [
            { label: 'Compras em aberto', value: d.purchases.open, fmt: FMT.int },
            { label: 'Compras atrasadas', value: d.purchases.late, fmt: FMT.int, tone: d.purchases.late ? 'bad' : 'plain' },
            { label: 'Notas em conferência', value: d.notes.open, fmt: FMT.int },
            { label: 'Parcelas vencidas', value: d.notes.overdueValue, fmt: FMT.money, note: `${d.notes.overdue} ${d.notes.overdue === 1 ? 'parcela' : 'parcelas'}`, tone: d.notes.overdue ? 'bad' : 'plain' },
            { label: 'A vencer em 30 dias', value: d.notes.dueSoonValue, fmt: FMT.money, note: `${d.notes.dueSoon} ${d.notes.dueSoon === 1 ? 'parcela' : 'parcelas'}` },
          ],
        },
      ],
      notes: ['Valores calculados no momento da exportação, a partir do que cada setor registrou no Max Hub.', 'As abas seguintes têm uma linha por registro e podem ser filtradas ou importadas no Power BI.'],
      sheets: [
        {
          name: 'Por categoria',
          cols: [
            { header: 'Código', width: 10, align: 'center', value: (c: (typeof d.byCategory)[number]) => c.cat },
            { header: 'Categoria', width: 30, value: (c: (typeof d.byCategory)[number]) => c.name },
            { header: 'Itens', width: 12, align: 'center', fmt: FMT.int, value: (c: (typeof d.byCategory)[number]) => c.items },
            { header: 'Unidades', width: 14, align: 'center', fmt: FMT.int, value: (c: (typeof d.byCategory)[number]) => c.units },
            { header: 'Valor', width: 18, align: 'right', fmt: FMT.money, bar: 'lilac', value: (c: (typeof d.byCategory)[number]) => c.value },
          ],
          rows: d.byCategory,
          totals: [2, 3, 4],
        },
        {
          name: 'Abaixo do mínimo',
          tab: 'red',
          cols: [
            { header: 'Código', width: 14, align: 'center', value: (b: (typeof d.below)[number]) => b.code },
            { header: 'Item', width: 30, value: (b: (typeof d.below)[number]) => b.name },
            { header: 'Tamanho', width: 11, align: 'center', value: (b: (typeof d.below)[number]) => b.size },
            { header: 'Saldo', width: 11, align: 'center', fmt: FMT.int, value: (b: (typeof d.below)[number]) => b.quantity },
            { header: 'Reservado', width: 12, align: 'center', fmt: FMT.int, value: (b: (typeof d.below)[number]) => b.reserved },
            { header: 'Disponível', width: 12, align: 'center', fmt: FMT.int, value: (b: (typeof d.below)[number]) => b.quantity - b.reserved, tone: (b: (typeof d.below)[number]) => (b.quantity - b.reserved <= 0 ? 'bad' : 'warn') },
            { header: 'Mínimo', width: 11, align: 'center', fmt: FMT.int, value: (b: (typeof d.below)[number]) => b.min },
          ],
          rows: d.below,
        },
        {
          name: 'Consumo',
          tab: 'green',
          cols: [
            { header: 'Item', width: 30, value: (c: (typeof d.consumption)[number]) => c.name },
            { header: 'Tamanho', width: 11, align: 'center', value: (c: (typeof d.consumption)[number]) => c.size },
            { header: 'Unidades', width: 13, align: 'center', fmt: FMT.int, bar: 'green', value: (c: (typeof d.consumption)[number]) => c.units },
            { header: 'Valor', width: 16, align: 'right', fmt: FMT.money, value: (c: (typeof d.consumption)[number]) => c.value },
            { header: 'Giro (consumo ÷ saldo)', width: 22, align: 'center', fmt: FMT.dec, value: (c: (typeof d.consumption)[number]) => c.turnover },
          ],
          rows: d.consumption,
          totals: [2, 3],
        },
        {
          name: 'Por empresa',
          cols: [
            { header: 'Empresa', width: 30, value: (c: (typeof d.byCompany)[number]) => c.company },
            { header: 'Unidades entregues', width: 20, align: 'center', fmt: FMT.int, bar: 'lilac', value: (c: (typeof d.byCompany)[number]) => c.units },
            { header: 'Valor', width: 18, align: 'right', fmt: FMT.money, value: (c: (typeof d.byCompany)[number]) => c.value },
          ],
          rows: d.byCompany,
          totals: [1, 2],
        },
        {
          name: 'Sem movimentação',
          tab: 'amber',
          cols: [
            { header: 'Item', width: 30, value: (i: (typeof d.idle)[number]) => i.name },
            { header: 'Tamanho', width: 11, align: 'center', value: (i: (typeof d.idle)[number]) => i.size },
            { header: 'Saldo', width: 11, align: 'center', fmt: FMT.int, value: (i: (typeof d.idle)[number]) => i.quantity },
            { header: 'Valor parado', width: 18, align: 'right', fmt: FMT.money, bar: 'amber', value: (i: (typeof d.idle)[number]) => i.value },
          ],
          rows: d.idle,
          totals: [2, 3],
        },
        {
          name: 'Pedidos atrasados',
          tab: 'red',
          cols: [
            { header: 'Pedido', width: 10, align: 'center', value: (o: (typeof d.orders.lateList)[number]) => o.number },
            { header: 'Origem', width: 24, value: (o: (typeof d.orders.lateList)[number]) => o.origin },
            { header: 'Para', width: 30, value: (o: (typeof d.orders.lateList)[number]) => o.who },
            { header: 'Prazo', width: 13, align: 'center', fmt: FMT.date, value: (o: (typeof d.orders.lateList)[number]) => xDate(o.due), tone: () => 'bad' },
          ],
          rows: d.orders.lateList,
        },
      ],
    });
    return new NextResponse(new Uint8Array(buf), { headers: xlsxResponseHeaders(`Gestao-Max-Hub_${todayBahia()}.xlsx`) });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
