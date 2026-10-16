import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, serverError } from '@/lib/http';
import { financeNotes } from '@/lib/pedidos/access';
import { noteCols, toNote } from '@/lib/notas/server';
import { loadConfig } from '@/lib/compras/pcServer';
import { duesPdf } from '@/lib/compras/pdf';
import { FMT, buildReport, xDate, xlsxResponseHeaders } from '@/lib/reportXlsx';
import { poLabel } from '@/lib/compras/pc';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Programação de vencimentos (por período, fornecedor, nota e pedido) em planilha ou PDF.
 * ?from=AAAA-MM-DD&to=AAAA-MM-DD&supplier=texto&format=xlsx|pdf
 * É previsão de desembolso: não diz que algo foi pago.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    if (!financeNotes(user)) throw new AccessError(403, 'Sem acesso aos vencimentos.');
    const sp = new URL(req.url).searchParams;
    const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('from') ?? '') ? sp.get('from')! : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('to') ?? '') ? sp.get('to')! : null;
    const sup = (sp.get('supplier') ?? '').trim().toLowerCase();
    const { data, error } = await db().from('fiscal_notes').select(await noteCols()).neq('status', 'estornada').limit(5000);
    if (error) throw error;
    const notes = (data ?? []).map((r) => toNote(r as unknown as Record<string, unknown>));
    const poIds = [...new Set(notes.map((n) => n.purchase_order_id).filter(Boolean))] as string[];
    const poNum = new Map<string, number>();
    if (poIds.length) {
      const { data: pos } = await db().from('purchase_orders').select('id, number').in('id', poIds);
      for (const p of pos ?? []) poNum.set(String(p.id), Number(p.number));
    }
    const rows = notes
      .filter((n) => !sup || n.supplier_name.toLowerCase().includes(sup))
      .flatMap((n) =>
        n.installments.map((p) => ({
          due: p.due,
          supplier: n.supplier_name,
          note: `NF ${n.number}${n.series ? '/' + n.series : ''}`,
          n: p.n,
          value: Number(p.value) || 0,
          order: n.purchase_order_id && poNum.has(n.purchase_order_id) ? poLabel(poNum.get(n.purchase_order_id)!) : null,
          status: n.installments_status === 'validada' ? 'Validada' : 'A conferir',
          obs: [p.method, p.ref, p.obs].filter(Boolean).join(' · '),
        })),
      )
      .filter((r) => (!from || (r.due && r.due >= from)) && (!to || (r.due && r.due <= to)))
      .sort((a, b) => String(a.due ?? '9999').localeCompare(String(b.due ?? '9999')));
    const period = from || to ? `${from ? from.split('-').reverse().join('/') : 'início'} a ${to ? to.split('-').reverse().join('/') : 'hoje em diante'}` : 'Todos os vencimentos';
    if (sp.get('format') === 'pdf') {
      const buf = await duesPdf(rows, { cfg: await loadConfig(), by: user.display_name, period });
      return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="vencimentos.pdf"' } });
    }
    const total = rows.reduce((t, r) => t + r.value, 0);
    const buf = await buildReport({
      title: 'Programação de vencimentos',
      subtitle: period,
      by: user.display_name,
      footer: 'Vencimentos',
      sections: [{ title: 'Resumo', kpis: [{ label: 'Total no período', value: total, fmt: FMT.money }, { label: 'Parcelas', value: rows.length, fmt: FMT.int }] }],
      notes: ['Previsão de desembolso registrada nas notas fiscais. Não indica pagamento e não é saldo bancário.'],
      sheets: [
        {
          name: 'Vencimentos',
          cols: [
            { header: 'Vencimento', width: 13, fmt: FMT.date, value: (r: (typeof rows)[number]) => xDate(r.due) },
            { header: 'Fornecedor', width: 34, value: (r: (typeof rows)[number]) => r.supplier },
            { header: 'Nota', width: 14, value: (r: (typeof rows)[number]) => r.note },
            { header: 'Parcela', width: 9, value: (r: (typeof rows)[number]) => r.n },
            { header: 'Pedido', width: 11, value: (r: (typeof rows)[number]) => r.order },
            { header: 'Valor', width: 15, fmt: FMT.money, align: 'right', value: (r: (typeof rows)[number]) => r.value },
            { header: 'Parcelas', width: 12, value: (r: (typeof rows)[number]) => r.status },
            { header: 'Forma / boleto / obs.', width: 30, value: (r: (typeof rows)[number]) => r.obs },
          ],
          rows,
          totals: [5],
        },
      ],
    });
    return new Response(new Uint8Array(buf), { headers: xlsxResponseHeaders('vencimentos.xlsx') });
  } catch (e) {
    return serverError(e);
  }
}
