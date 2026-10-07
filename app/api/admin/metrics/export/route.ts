import { NextResponse } from 'next/server';
import { currentAdmin, unauthorized } from '@/lib/auth';
import { fail, serverError } from '@/lib/http';
import { exportBaseName, isPeriod } from '@/lib/metrics';
import { loadMetrics, parseAt } from '@/lib/metricsData';
import { buildWorkbook } from '@/lib/metricsXlsx';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Planilha .xlsx do período mostrado na tela.
 * "at" = instante dos dados que a tela está exibindo, para a planilha bater exatamente com o gráfico.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const period = url.searchParams.get('period');
  if (!isPeriod(period)) return fail('Período inválido.');
  try {
    const admin = await currentAdmin();
    if (!admin) return unauthorized();
    const now = Date.now();
    const { data, moves, reqs, truncated } = await loadMetrics(period, parseAt(url.searchParams.get('at'), now));
    const buf = await buildWorkbook(data, moves, reqs, { by: admin.display_name, exportedAt: now, truncated });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${exportBaseName(data)}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return serverError(e);
  }
}
