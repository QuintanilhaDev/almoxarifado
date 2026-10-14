import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { UUID_RE } from '@/lib/almoxarifado/stockData';
import { canSeeOrder } from '@/lib/pedidos/access';
import { ORDER_COLS, missingP3, p3Fail, toOrder } from '@/lib/pedidos/server';
import { ORIGIN_LABEL, isLate, lineLabel, orderLabel, todayBahia } from '@/lib/pedidos/types';
import { simpleWorkbook, xDate, xlsxResponseHeaders } from '@/lib/simpleXlsx';

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
    const head = [
      { header: 'Pedido', width: 9 },
      { header: 'Aberto em', width: 12, fmt: 'dd/mm/yyyy' },
      { header: 'Origem', width: 24 },
      { header: 'Etapa', width: 20 },
      { header: 'Status', width: 26 },
      { header: 'Prioridade', width: 11 },
      { header: 'Prazo', width: 12, fmt: 'dd/mm/yyyy' },
      { header: 'Atrasado', width: 10 },
      { header: 'Colaborador', width: 28 },
      { header: 'Matrícula', width: 12 },
      { header: 'Função', width: 18 },
      { header: 'Posto', width: 26 },
      { header: 'Empresa', width: 18 },
      { header: 'Solicitante', width: 20 },
      { header: 'Supervisor', width: 26 },
    ];
    const resumo = orders.map((o) => [orderLabel(o.number), xDate(o.created_at), ORIGIN_LABEL[o.origin], STAGE[o.stage], statuses[o.id] ?? '', o.priority === 'urgente' ? 'Urgente' : 'Normal', xDate(o.needed_by ?? o.start_date), isLate(o) ? 'Sim' : 'Não', o.collaborator_name, o.matricula, o.role, o.posto_name, o.company, o.requester, o.supervisor]);
    const itens = orders.flatMap((o) =>
      o.items.map((l) => [orderLabel(o.number), ORIGIN_LABEL[o.origin], STAGE[o.stage], o.collaborator_name ?? o.posto_name, lineLabel(l), l.qty, l.reserved, l.delivered, Math.max(0, l.qty - l.delivered), l.purchase_number ? `Compra ${l.purchase_number}` : '', l.check ? 'Conferir item' : '']),
    );
    const buf = await simpleWorkbook(
      [
        { name: 'Pedidos', cols: head, rows: resumo },
        {
          name: 'Itens',
          cols: [{ header: 'Pedido', width: 9 }, { header: 'Origem', width: 24 }, { header: 'Etapa', width: 20 }, { header: 'Para', width: 28 }, { header: 'Item', width: 34 }, { header: 'Solicitado' }, { header: 'Reservado' }, { header: 'Entregue' }, { header: 'Pendente' }, { header: 'Compra', width: 14 }, { header: 'Obs.', width: 14 }],
          rows: itens,
        },
      ],
      { by: user.display_name, title: 'Pedidos de material' },
    );
    return new NextResponse(new Uint8Array(buf), { headers: xlsxResponseHeaders(`pedidos-${todayBahia()}.xlsx`) });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
