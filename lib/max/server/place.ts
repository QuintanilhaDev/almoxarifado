import 'server-only';
import { canOpenSector, type HubUser } from '@/lib/permissions';
import { getSector } from '@/lib/sectors';

/** Tela/setor que a pessoa realmente pode usar (nunca confia no que o navegador manda). */
export function place(user: HubUser, body: { scope?: unknown; sector?: unknown } | null): { scope: 'hub' | 'sector'; sector: string | null } {
  const scope = body?.scope === 'hub' && user.is_master ? 'hub' : 'sector';
  const def = getSector(typeof body?.sector === 'string' ? body.sector : null);
  const sector = scope === 'hub' ? null : def && canOpenSector(user, def.slug) ? def.slug : (user.sector ?? null);
  return { scope, sector };
}
