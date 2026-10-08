import 'server-only';
import { cookies } from 'next/headers';
import { db } from './supabaseAdmin';
import { SESSION_COOKIE, SESSION_DAYS, verifySession } from './session';
import { fullPermissions, sanitizePermissions, type HubUser, type HubUserRow } from './permissions';
import { isSectorSlug } from './sectors';

/**
 * Colunas do Max Hub na tabela "admins" (criadas pelo supabase/maxhub.sql).
 * Enquanto esse arquivo não for rodado, o sistema continua funcionando como antes:
 * quem não é master é tratado como equipe do Almoxarifado com acesso total.
 */
const HUB_COLS = 'id, username, display_name, is_master, sector, sector_role, permissions, active';
const LIST_COLS = HUB_COLS + ', created_at, last_login_at';
const LEGACY_COLS = 'id, username, display_name, is_master';
const BASIC_COLS = 'id, username, display_name';

type Row = Record<string, unknown>;

/** true quando o erro é "coluna não existe" (banco ainda sem o maxhub.sql). */
export function isMissingColumn(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return err?.code === '42703' || err?.code === 'PGRST204' || /column .* does not exist/i.test(err?.message ?? '');
}

export function toUser(row: Row, legacy = false): HubUser {
  const is_master = Boolean(row.is_master);
  if (legacy) {
    return {
      id: String(row.id),
      username: String(row.username),
      display_name: String(row.display_name),
      is_master,
      sector: is_master ? null : 'almoxarifado',
      sector_role: 'member',
      permissions: is_master ? {} : fullPermissions('almoxarifado', 'edit'),
      active: true,
    };
  }
  const sector = isSectorSlug(row.sector) ? row.sector : null;
  return {
    id: String(row.id),
    username: String(row.username),
    display_name: String(row.display_name),
    is_master,
    sector,
    sector_role: row.sector_role === 'master' ? 'master' : 'member',
    permissions: sanitizePermissions(sector, row.permissions),
    active: row.active !== false,
  };
}

export function toUserRow(row: Row): HubUserRow {
  return {
    ...toUser(row),
    created_at: String(row.created_at ?? ''),
    last_login_at: row.last_login_at ? String(row.last_login_at) : null,
  };
}

/** Lê uma linha de "admins" tentando primeiro as colunas novas e caindo para as antigas. */
async function readOne(column: 'id' | 'username', value: string, extra = ''): Promise<{ row: Row; legacy: boolean } | null> {
  const attempts: [string, boolean][] = [
    [HUB_COLS + extra, false],
    [LEGACY_COLS + extra, true],
    [BASIC_COLS + extra, true],
  ];
  let lastError: unknown = null;
  for (const [cols, legacy] of attempts) {
    const { data, error } = await db().from('admins').select(cols).eq(column, value).maybeSingle();
    if (!error) return data ? { row: data as unknown as Row, legacy } : null;
    lastError = error;
    if (!isMissingColumn(error)) break;
  }
  throw lastError;
}

export async function loadUser(id: string): Promise<HubUser | null> {
  const r = await readOne('id', id);
  return r ? toUser(r.row, r.legacy) : null;
}

/** Usuário + hash da senha, para o login. */
export async function findUserForLogin(username: string): Promise<(HubUser & { password_hash: string }) | null> {
  const r = await readOne('username', username, ', password_hash');
  return r ? { ...toUser(r.row, r.legacy), password_hash: String(r.row.password_hash) } : null;
}

/** Lista de usuários (colunas novas; exige o maxhub.sql). */
export async function listUsers(sector?: string): Promise<HubUserRow[]> {
  let q = db().from('admins').select(LIST_COLS).order('created_at', { ascending: true }).limit(2000);
  if (sector) q = q.eq('sector', sector);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map(toUserRow);
}

export async function loadUserRow(id: string): Promise<HubUserRow | null> {
  const { data, error } = await db().from('admins').select(LIST_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toUserRow(data as unknown as Row) : null;
}

/** Lê o cookie de sessão e devolve a pessoa logada (ou null). Acesso desativado = sem sessão. */
export async function currentUser(): Promise<HubUser | null> {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const user = await loadUser(session.sub);
  return user && user.active ? user : null;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}
