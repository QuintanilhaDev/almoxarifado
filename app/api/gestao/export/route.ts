import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/access';
import { serverError } from '@/lib/http';
import { indicators } from '@/lib/gestao';
import { missingP3, p3Fail } from '@/lib/pedidos/server';
import { simpleWorkbook, xlsxResponseHeaders } from '@/lib/simpleXlsx';
import { todayBahia } from '@/lib/pedidos/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MONEY = '"R$" #,##0.00';

export async function GET(req: Request) {
  try {
    const user = await requireMaster();
    const days = Math.min(365, Math.max(7, Number(new URL(req.url).searchParams.get('days')) || 30));
    const d = await indicators(days);
    const buf = await simpleWorkbook(
      [
        {
          name: 'Resumo',
          cols: [{ header: 'Indicador', width: 44 }, { header: 'Valor', width: 18 }],
          rows: [
            ['Período (dias)', d.days],
            ['Itens ativos', d.stock.items],
            ['Saldo físico (unidades)', d.stock.physical],
            ['Reservado (unidades)', d.stock.reserved],
            ['Disponível (unidades)', d.stock.available],
            ['Valor do estoque (R$)', d.stock.value],
            ['Itens sem custo cadastrado', d.stock.noCost],
            ['Itens no mínimo ou abaixo', d.stock.below],
            ['Itens com reposição sugerida', d.replenish],
            ['Compras em aberto', d.purchases.open],
            ['Compras atrasadas', d.purchases.late],
            ['Pedidos de material em aberto', d.orders.open],
            ['Pedidos parcialmente atendidos', d.orders.partial],
            ['Pedidos aguardando compra', d.orders.waitingPurchase],
            ['Pedidos atrasados', d.orders.late],
            ['Pedidos concluídos no período', d.orders.done],
            ['Tempo médio de atendimento (dias)', d.orders.avgDays ?? '—'],
            ['Notas em conferência', d.notes.open],
            ['Parcelas vencidas', d.notes.overdue],
            ['Valor vencido (R$)', d.notes.overdueValue],
            ['Parcelas a vencer em 30 dias', d.notes.dueSoon],
            ['Valor a vencer em 30 dias (R$)', d.notes.dueSoonValue],
          ],
        },
        { name: 'Por categoria', cols: [{ header: 'Código' , width: 10 }, { header: 'Categoria', width: 32 }, { header: 'Itens' }, { header: 'Unidades' }, { header: 'Valor', fmt: MONEY }], rows: d.byCategory.map((c) => [c.cat, c.name, c.items, c.units, c.value]) },
        { name: 'Abaixo do mínimo', cols: [{ header: 'Código', width: 14 }, { header: 'Item', width: 34 }, { header: 'Tamanho' }, { header: 'Saldo' }, { header: 'Reservado' }, { header: 'Mínimo' }], rows: d.below.map((b) => [b.code, b.name, b.size, b.quantity, b.reserved, b.min]) },
        { name: 'Consumo', cols: [{ header: 'Item', width: 34 }, { header: 'Tamanho' }, { header: 'Unidades' }, { header: 'Valor', fmt: MONEY }, { header: 'Giro (consumo ÷ saldo)' }], rows: d.consumption.map((c) => [c.name, c.size, c.units, c.value, c.turnover]) },
        { name: 'Por empresa', cols: [{ header: 'Empresa', width: 34 }, { header: 'Unidades entregues' }, { header: 'Valor', fmt: MONEY }], rows: d.byCompany.map((c) => [c.company, c.units, c.value]) },
        { name: 'Sem movimentação', cols: [{ header: 'Item', width: 34 }, { header: 'Tamanho' }, { header: 'Saldo' }, { header: 'Valor parado', fmt: MONEY }], rows: d.idle.map((i) => [i.name, i.size, i.quantity, i.value]) },
        { name: 'Pedidos atrasados', cols: [{ header: 'Pedido' }, { header: 'Origem', width: 26 }, { header: 'Para', width: 30 }, { header: 'Prazo' }], rows: d.orders.lateList.map((o) => [o.number, o.origin, o.who, o.due]) },
      ],
      { by: user.display_name, title: 'Indicadores da Gestão' },
    );
    return new NextResponse(new Uint8Array(buf), { headers: xlsxResponseHeaders(`gestao-max-hub-${todayBahia()}.xlsx`) });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
