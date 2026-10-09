import 'server-only';
import { currentUser } from './auth';
import { AccessError } from './http';
import { canManageSector, canOpenSector, hasLevel, type HubUser, type Level } from './permissions';
import { getSector } from './sectors';

/**
 * Conferências de acesso das rotas do servidor. Todas leem a pessoa no banco a cada
 * chamada (nunca confiam no cookie), então trocar setor, permissão ou desativar alguém
 * vale na hora. Em caso de recusa lançam AccessError, que o serverError() transforma
 * em 401/403.
 */
export async function requireUser(): Promise<HubUser> {
  const user = await currentUser();
  if (!user) throw new AccessError(401, 'Sessão expirada. Entre novamente.');
  return user;
}

export async function requireMaster(): Promise<HubUser> {
  const user = await requireUser();
  if (!user.is_master) throw new AccessError(403, 'Só um usuário master pode fazer isso.');
  return user;
}

export async function requireSector(slug: string): Promise<HubUser> {
  const user = await requireUser();
  if (!getSector(slug)) throw new AccessError(404, 'Setor não encontrado.');
  if (!canOpenSector(user, slug)) throw new AccessError(403, 'Você não tem acesso a este setor.');
  return user;
}

export async function requireSectorManager(slug: string): Promise<HubUser> {
  const user = await requireSector(slug);
  if (!canManageSector(user, slug)) throw new AccessError(403, 'Só o master do setor pode fazer isso.');
  return user;
}

/** Exige o nível pedido em pelo menos UM dos módulos do setor. */
export async function requireModule(slug: string, modules: string | string[], need: Exclude<Level, 'none'>): Promise<HubUser> {
  const user = await requireSector(slug);
  const list = Array.isArray(modules) ? modules : [modules];
  if (!list.some((m) => hasLevel(user, slug, m, need))) {
    const names = list.map((m) => getSector(slug)?.modules.find((x) => x.id === m)?.label ?? m);
    throw new AccessError(
      403,
      need === 'edit' && list.some((m) => hasLevel(user, slug, m, 'view'))
        ? `Você só pode visualizar ${names[0]}. Peça ao master do setor a permissão de edição.`
        : `Você não tem acesso a ${names[0]}.`,
    );
  }
  return user;
}

export const requireAlmox = (modules: string | string[], need: Exclude<Level, 'none'>) =>
  requireModule('almoxarifado', modules, need);
