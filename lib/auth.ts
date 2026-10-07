import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { db } from './supabaseAdmin';
import { SESSION_COOKIE, SESSION_DAYS, verifySession } from './session';
import type { AdminUser } from './types';

/**
 * Lê um usuário do painel. A coluna is_master só existe depois de rodar o
 * baixa_e_usuarios.sql; enquanto isso, tudo continua funcionando (sem master).
 */
export async function loadAdmin(id: string): Promise<AdminUser | null> {
  const full = await db().from('admins').select('id, username, display_name, is_master').eq('id', id).maybeSingle();
  if (!full.error) {
    if (!full.data) return null;
    return { ...full.data, is_master: Boolean(full.data.is_master) } as AdminUser;
  }
  const basic = await db().from('admins').select('id, username, display_name').eq('id', id).maybeSingle();
  if (basic.error || !basic.data) return null;
  return { ...basic.data, is_master: false } as AdminUser;
}

/** Usuário + hash da senha, para o login. */
export async function findAdminForLogin(
  username: string,
): Promise<{ id: string; username: string; display_name: string; password_hash: string; is_master: boolean } | null> {
  const full = await db()
    .from('admins')
    .select('id, username, display_name, password_hash, is_master')
    .eq('username', username)
    .maybeSingle();
  if (!full.error) {
    return full.data ? { ...full.data, is_master: Boolean(full.data.is_master) } : null;
  }
  const basic = await db()
    .from('admins')
    .select('id, username, display_name, password_hash')
    .eq('username', username)
    .maybeSingle();
  if (basic.error) throw basic.error;
  return basic.data ? { ...basic.data, is_master: false } : null;
}

/** Lê o cookie de sessão e devolve o admin atual (ou null). */
export async function currentAdmin(): Promise<AdminUser | null> {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return loadAdmin(session.sub);
}

/** Só o usuário master passa (a conferência é sempre feita no banco, nunca pelo cookie). */
export async function currentMaster(): Promise<AdminUser | null> {
  const admin = await currentAdmin();
  return admin?.is_master ? admin : null;
}

export function forbidden() {
  return NextResponse.json({ error: 'Só o usuário master pode fazer isso.' }, { status: 403 });
}

export function unauthorized() {
  return NextResponse.json({ error: 'Sessão expirada. Entre novamente.' }, { status: 401 });
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
