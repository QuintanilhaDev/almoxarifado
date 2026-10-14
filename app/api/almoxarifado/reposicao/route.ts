import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { AccessError, serverError } from '@/lib/http';
import { hasLevel } from '@/lib/permissions';
import { replenishment } from '@/lib/almoxarifado/reposicao';
import { getConfig, missingP3, p3Fail } from '@/lib/pedidos/server';

export const dynamic = 'force-dynamic';

/** Sugestões de reposição: consumo médio × prazo + segurança, descontando compras em trânsito. */
export async function GET() {
  try {
    const user = await requireUser();
    const ok = hasLevel(user, 'almoxarifado', 'estoque', 'view') || hasLevel(user, 'almoxarifado', 'compras', 'view') || hasLevel(user, 'compras', 'solicitacoes', 'view');
    if (!ok) throw new AccessError(403, 'Você não tem acesso às sugestões de reposição.');
    const cfg = await getConfig();
    const r = await replenishment({ days: cfg.consumptionDays, defaultLead: cfg.defaultLeadDays });
    return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
