import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { loadUser, sessionCookieOptions } from '@/lib/auth';
import { fail, readJson, serverError } from '@/lib/http';
import { SESSION_COOKIE, signSession } from '@/lib/session';
import { broadcast } from '@/lib/broadcast';
import { USERNAME_HELP, USERNAME_RE } from '@/lib/permissions';
import { cleanName, cleanUsername, passwordError } from '@/lib/users';

export const dynamic = 'force-dynamic';

/** A própria pessoa altera nome, usuário de login e senha. */
export async function PATCH(req: Request) {
  const body = await readJson<{
    display_name?: string;
    username?: string;
    current_password?: string;
    new_password?: string;
  }>(req);
  if (!body) return fail('Requisição inválida.');
  try {
    const me = await requireUser();

    const display_name = cleanName(body.display_name ?? me.display_name);
    const username = cleanUsername(body.username ?? me.username);
    const newPassword = String(body.new_password || '');
    if (!display_name) return fail('Digite seu nome.', 400, { field: 'display_name' });
    if (!USERNAME_RE.test(username)) return fail(USERNAME_HELP, 400, { field: 'username' });
    if (newPassword) {
      const pe = passwordError(newPassword);
      if (pe) return fail(pe, 400, { field: 'new_password' });
    }

    const changingCredentials = username !== me.username || Boolean(newPassword);
    const update: Record<string, string> = { display_name, username, updated_at: new Date().toISOString() };

    if (changingCredentials) {
      const { data: row, error } = await db().from('admins').select('password_hash').eq('id', me.id).single();
      if (error) throw error;
      const ok = await bcrypt.compare(String(body.current_password || ''), row.password_hash);
      if (!ok) return fail('Senha atual incorreta.', 400, { field: 'current_password' });
    }
    if (username !== me.username) {
      const { data: taken, error: te } = await db().from('admins').select('id').eq('username', username).maybeSingle();
      if (te) throw te;
      if (taken) return fail('Este usuário já está em uso.', 400, { field: 'username' });
    }
    if (newPassword) update.password_hash = await bcrypt.hash(newPassword, 10);

    const { data, error } = await db().from('admins').update(update).eq('id', me.id).select('id').single();
    if (error) {
      if ((error as { code?: string }).code === '23505') return fail('Este usuário já está em uso.', 400, { field: 'username' });
      throw error;
    }

    const user = (await loadUser(data.id)) ?? { ...me, username, display_name };
    const res = NextResponse.json({ user });
    res.cookies.set(SESSION_COOKIE, await signSession({ sub: user.id, name: user.display_name }), sessionCookieOptions());
    await broadcast('admins:update', { id: user.id });
    return res;
  } catch (e) {
    return serverError(e);
  }
}
