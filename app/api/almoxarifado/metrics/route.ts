import { NextResponse } from 'next/server';
import { requireAlmox } from '@/lib/access';
import { fail, serverError } from '@/lib/http';
import { isPeriod } from '@/lib/almoxarifado/metrics';
import { loadMetrics, parseAt } from '@/lib/almoxarifado/metricsData';

export const dynamic = 'force-dynamic';

/** Números da tela de Métricas. ?period=ultimo-dia|hoje|ultima-semana|ultimo-mes */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const period = url.searchParams.get('period');
  if (!isPeriod(period)) return fail('Período inválido.');
  try {
    await requireAlmox('metricas', 'view');
    const { data } = await loadMetrics(period, parseAt(url.searchParams.get('at')));
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}
