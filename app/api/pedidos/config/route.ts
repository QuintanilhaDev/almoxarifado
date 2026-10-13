import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { canManageSector } from '@/lib/permissions';
import { getConfig, setConfig, type P3Config } from '@/lib/pedidos/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json({ config: await getConfig() });
  } catch (e) {
    return serverError(e);
  }
}

/**
 * Ajustes do fluxo. Cada um tem dono:
 *  - routing (formulário dos supervisores passa pela Operação): master do Operacional ou do Almoxarifado
 *  - tradeAlertDays / extraResetsCycle (troca anual): master do RH
 *  - defaultLeadDays / consumptionDays (reposição): master do Almoxarifado
 * O master geral muda tudo.
 */
export async function PUT(req: Request) {
  const b = await readJson<Partial<P3Config>>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    const op = canManageSector(user, 'operacional');
    const al = canManageSector(user, 'almoxarifado');
    const rh = canManageSector(user, 'rh');
    const patch: Partial<P3Config> = {};
    if ('routing' in b) {
      if (!op && !al) throw new AccessError(403, 'Só o master da Operação ou do Almoxarifado muda o caminho das solicitações.');
      patch.routing = b.routing === true;
    }
    if ('tradeAlertDays' in b || 'extraResetsCycle' in b) {
      if (!rh) throw new AccessError(403, 'Só o master do RH muda as regras da troca anual.');
      if ('tradeAlertDays' in b) patch.tradeAlertDays = b.tradeAlertDays;
      if ('extraResetsCycle' in b) patch.extraResetsCycle = b.extraResetsCycle === true;
    }
    if ('defaultLeadDays' in b || 'consumptionDays' in b) {
      if (!al) throw new AccessError(403, 'Só o master do Almoxarifado muda os parâmetros de reposição.');
      if ('defaultLeadDays' in b) patch.defaultLeadDays = b.defaultLeadDays;
      if ('consumptionDays' in b) patch.consumptionDays = b.consumptionDays;
    }
    if (!Object.keys(patch).length) return fail('Nada para alterar.');
    const config = await setConfig(patch);
    await broadcast('order:update', { config: true, by: user.display_name });
    return NextResponse.json({ config });
  } catch (e) {
    return serverError(e);
  }
}
