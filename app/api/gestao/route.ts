import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/access';
import { serverError } from '@/lib/http';
import { indicators } from '@/lib/gestao';
import { missingP3, p3Fail } from '@/lib/pedidos/server';

export const dynamic = 'force-dynamic';

/** Painel da Gestão (masters gerais). ?days=30 */
export async function GET(req: Request) {
  try {
    await requireMaster();
    const days = Math.min(365, Math.max(7, Number(new URL(req.url).searchParams.get('days')) || 30));
    return NextResponse.json(await indicators(days), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
