import { NextResponse } from 'next/server';
import { requireAlmox } from '@/lib/access';
import { serverError } from '@/lib/http';
import { fetchAll } from '@/lib/almoxarifado/stockData';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAlmox('solicitacoes', 'view');
    // todas (o Supabase devolve no máximo 1000 por consulta: lê página por página)
    const data = await fetchAll<Record<string, unknown>>('requests', '*', { column: 'created_at', ascending: false, tiebreak: 'id' });
    return NextResponse.json({ requests: data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}
