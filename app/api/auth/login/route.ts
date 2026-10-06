import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/supabaseAdmin';
import { fail, readJson, serverError } from '@/lib/http';
import { SESSION_COOKIE, signSession } from '@/lib/session';
import { sessionCookieOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await readJson<{ username?: string; password?: string }>(req);
  const username = String(body?.username || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (!username || !password) return fail('Preencha usuário e senha.');
  try {
    const { data, error } = await db()
      .from('admins')
      .select('id, username, display_name, password_hash')
      .eq('username', username)
      .maybeSingle();
    if (error) throw error;
    const ok = data ? await bcrypt.compare(password, data.password_hash) : false;
    if (!data || !ok) {
      await new Promise((r) => setTimeout(r, 450));
      return fail('Usuário ou senha incorretos.', 401);
    }
    const token = await signSession({ sub: data.id, name: data.display_name });
    const res = NextResponse.json({
      user: { id: data.id, username: data.username, display_name: data.display_name },
    });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (e) {
    return serverError(e);
  }
}
