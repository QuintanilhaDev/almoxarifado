import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/access';
import { serverError } from '@/lib/http';
import { auditTopic, recentAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** Os registros mais recentes (memória do servidor) e o canal ao vivo da Auditoria. Só o master geral. */
export async function GET() {
  try {
    await requireMaster();
    return NextResponse.json({ events: recentAudit(), topic: await auditTopic() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}
