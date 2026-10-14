import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/access';
import { serverError } from '@/lib/http';
import { indicators } from '@/lib/gestao';
import { gestaoPdf } from '@/lib/gestaoPdf';
import { missingP3, p3Fail } from '@/lib/pedidos/server';
import { todayBahia } from '@/lib/pedidos/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const user = await requireMaster();
    const days = Math.min(365, Math.max(7, Number(new URL(req.url).searchParams.get('days')) || 30));
    const period = { 7: 'Últimos 7 dias', 30: 'Últimos 30 dias', 90: 'Últimos 90 dias', 365: 'Últimos 12 meses' }[days] ?? `Últimos ${days} dias`;
    const buf = await gestaoPdf(await indicators(days), { by: user.display_name, period });
    return new NextResponse(new Uint8Array(buf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="Gestao-Max-Hub_${todayBahia()}.pdf"`, 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
