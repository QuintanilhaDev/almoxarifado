import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { db } from './supabaseAdmin';
import { SESSION_COOKIE, SESSION_DAYS, verifySession } from './session';
import type { AdminUser } from './types';

/** Lê o cookie de sessão e devolve o admin atual (ou null). */
export async function currentAdmin(): Promise<AdminUser | null> {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const { data, error } = await db()
    .from('admins')
    .select('id, username, display_name')
    .eq('id', session.sub)
    .maybeSingle();
  if (error || !data) return null;
  return data as AdminUser;
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
