import { getSector, isSectorSlug, sectorPath } from './sectors';

/** none = não vê · view = só visualiza · edit = visualiza e altera */
export type Level = 'none' | 'view' | 'edit';
export type Permissions = Record<string, Level>;
export type SectorRole = 'master' | 'member';

export const LEVELS: Level[] = ['none', 'view', 'edit'];
export const LEVEL_LABEL: Record<Level, string> = { none: 'Sem acesso', view: 'Visualizar', edit: 'Editar' };
const RANK: Record<Level, number> = { none: 0, view: 1, edit: 2 };

/** Pessoa com acesso ao Max Hub. */
export interface HubUser {
  id: string;
  username: string;
  display_name: string;
  /** master geral: administra todos os setores e os usuários */
  is_master: boolean;
  /** setor em que a pessoa está alocada (null = ainda sem setor) */
  sector: string | null;
  /** master do setor: acesso total à ferramenta do setor e às permissões da equipe */
  sector_role: SectorRole;
  permissions: Permissions;
  active: boolean;
}

/** Linha da lista de usuários (painel master e aba Equipe). */
export interface HubUserRow extends HubUser {
  created_at: string;
  last_login_at: string | null;
}

export function isLevel(v: unknown): v is Level {
  return v === 'none' || v === 'view' || v === 'edit';
}

/** Mantém só os módulos que existem no setor, com níveis válidos. */
export function sanitizePermissions(sector: string | null | undefined, raw: unknown): Permissions {
  const def = getSector(sector);
  const out: Permissions = {};
  if (!def) return out;
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  for (const m of def.modules) {
    const v = src[m.id];
    out[m.id] = isLevel(v) ? v : 'none';
  }
  return out;
}

export function fullPermissions(sector: string | null | undefined, level: Level): Permissions {
  const out: Permissions = {};
  for (const m of getSector(sector)?.modules ?? []) out[m.id] = level;
  return out;
}

/** Pode abrir a ferramenta do setor? */
export function canOpenSector(user: HubUser | null | undefined, slug: string): boolean {
  if (!user || !user.active || !isSectorSlug(slug)) return false;
  return user.is_master || user.sector === slug;
}

/** Pode alterar as permissões da equipe do setor? */
export function canManageSector(user: HubUser | null | undefined, slug: string): boolean {
  if (!canOpenSector(user, slug)) return false;
  return user!.is_master || user!.sector_role === 'master';
}

/** Nível efetivo da pessoa em um módulo do setor. */
export function levelFor(user: HubUser | null | undefined, slug: string, moduleId: string): Level {
  if (!canOpenSector(user, slug)) return 'none';
  if (canManageSector(user, slug)) return 'edit';
  const v = user!.permissions?.[moduleId];
  return isLevel(v) ? v : 'none';
}

export function hasLevel(user: HubUser | null | undefined, slug: string, moduleId: string, need: Level): boolean {
  return RANK[levelFor(user, slug, moduleId)] >= RANK[need];
}

/** Para onde a pessoa vai depois de entrar. */
export function homePath(user: Pick<HubUser, 'is_master' | 'sector'>): string {
  if (user.is_master) return '/hub';
  if (isSectorSlug(user.sector)) return sectorPath(user.sector);
  return '/sem-setor';
}

export const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
export const USERNAME_HELP = 'De 3 a 30 caracteres: letras minúsculas, números, ponto, hífen ou _.';
