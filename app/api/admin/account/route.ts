import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/supabaseAdmin';
import { currentAdmin, loadAdmin, sessionCookieOptions, unauthorized } from '@/lib/auth';
import { fail, readJson, serverError } from '@/lib/http';
import { SESSION_COOKIE, signSession } from '@/lib/session';
import { broadcast } from '@/lib/broadcast';

export const dynamic = 'force-dynamic';

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

export async function PATCH(req: Request) {
  const body = await readJson<{
    display_name?: string;
    username?: string;
    current_password?: string;
    new_password?: string;
  }>(req);
  if (!body) return fail('Requisição inválida.');
  try {
    const admin = await currentAdmin();
    if (!admin) return unauthorized();

    const display_name = String(body.display_name ?? admin.display_name).trim().slice(0, 40);
    const username = String(body.username ?? admin.username).trim().toLowerCase();
    const newPassword = String(body.new_password || '');
    if (!display_name) return fail('Digite seu nome.', 400, { field: 'display_name' });
    if (!USERNAME_RE.test(username))
      return fail('Usuário deve ter de 3 a 30 caracteres: letras minúsculas, números, ponto, hífen ou _.', 400, {
        field: 'username',
      });
    if (newPassword && newPassword.length < 6)
      return fail('A nova senha precisa ter pelo menos 6 caracteres.', 400, { field: 'new_password' });

    const changingCredentials = username !== admin.username || Boolean(newPassword);
    const update: Record<string, string> = { display_name, username, updated_at: new Date().toISOString() };

    if (changingCredentials) {
      const { data: row, error } = await db().from('admins').select('password_hash').eq('id', admin.id).single();
      if (error) throw error;
      const ok = await bcrypt.compare(String(body.current_password || ''), row.password_hash);
      if (!ok) return fail('Senha atual incorreta.', 400, { field: 'current_password' });
    }
    if (username !== admin.username) {
      const { data: taken } = await db().from('admins').select('id').eq('username', username).maybeSingle();
      if (taken) return fail('Este usuário já está em uso.', 400, { field: 'username' });
    }
    if (newPassword) update.password_hash = await bcrypt.hash(newPassword, 10);

    const { data, error } = await db()
      .from('admins')
      .update(update)
      .eq('id', admin.id)
      .select('id')
      .single();
    if (error) {
      if ((error as { code?: string }).code === '23505') return fail('Este usuário já está em uso.', 400, { field: 'username' });
      throw error;
    }

    const user = (await loadAdmin(data.id)) ?? { id: data.id, username, display_name, is_master: admin.is_master };
    const res = NextResponse.json({ user });
    res.cookies.set(SESSION_COOKIE, await signSession({ sub: user.id, name: user.display_name }), sessionCookieOptions());
    await broadcast('admins:update', {});
    return res;
  } catch (e) {
    return serverError(e);
  }
}
