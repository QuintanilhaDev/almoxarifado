import 'server-only';
import { isMissingColumn } from './auth';
import { fail } from './http';
import { fullPermissions, sanitizePermissions, type Permissions, type SectorRole } from './permissions';
import { isSectorSlug } from './sectors';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resposta pronta quando o banco ainda não recebeu o supabase/maxhub.sql. */
export function missingHubSql(e: unknown) {
  if (!isMissingColumn(e)) return null;
  return fail('Falta rodar o arquivo supabase/maxhub.sql no SQL Editor do Supabase (passo do README).', 409, { setup: true });
}

export function passwordError(password: string): string | null {
  if (password.length < 6) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (Buffer.byteLength(password, 'utf8') > 72) return 'A senha pode ter no máximo 72 caracteres.';
  return null;
}

export function cleanName(v: unknown): string {
  return String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

export function cleanUsername(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');
}

export interface Allocation {
  is_master: boolean;
  sector: string | null;
  sector_role: SectorRole;
  permissions: Permissions;
}

/**
 * Normaliza a alocação de uma pessoa:
 *  - master geral não fica preso a setor;
 *  - sem setor não há papel nem permissões;
 *  - master do setor tem tudo, então as permissões individuais ficam todas em "editar";
 *  - membro novo, sem permissões informadas, começa só visualizando.
 */
export function normalizeAllocation(input: {
  is_master?: unknown;
  sector?: unknown;
  sector_role?: unknown;
  permissions?: unknown;
}): Allocation | { error: string; field: string } {
  const is_master = input.is_master === true;
  if (is_master) return { is_master: true, sector: null, sector_role: 'member', permissions: {} };
  const rawSector = input.sector === '' || input.sector === undefined ? null : input.sector;
  if (rawSector !== null && !isSectorSlug(rawSector)) return { error: 'Setor inválido.', field: 'sector' };
  const sector = rawSector as string | null;
  if (!sector) return { is_master: false, sector: null, sector_role: 'member', permissions: {} };
  const sector_role: SectorRole = input.sector_role === 'master' ? 'master' : 'member';
  const permissions =
    sector_role === 'master'
      ? fullPermissions(sector, 'edit')
      : input.permissions === undefined || input.permissions === null
        ? fullPermissions(sector, 'view')
        : sanitizePermissions(sector, input.permissions);
  return { is_master: false, sector, sector_role, permissions };
}
