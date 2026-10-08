import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { fail, readJson, serverError } from '@/lib/http';
import { SESSION_COOKIE, signSession } from '@/lib/session';
import { findUserForLogin, sessionCookieOptions } from '@/lib/auth';
import { homePath } from '@/lib/permissions';
import { db } from '@/lib/supabaseAdmin';
import { clientKey, rateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// Hash de mentira: quando o usuário não existe, comparamos com ele para o tempo de
// resposta ser o mesmo (não dá para descobrir quais usuários existem pelo relógio).
const DUMMY_HASH = '$2b$10$c3tnk4UPkHj9.kv9pl7KsuDlaHAWcXU2EzcaZSKcTtwSADSM2pAIW';

export async function POST(req: Request) {
  const body = await readJson<{ username?: unknown; password?: unknown }>(req);
  const username = String(body?.username ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .slice(0, 60);
  const password = String(body?.password ?? '');
  if (!username || !password) return fail('Preencha usuário e senha.');
  if (password.length > 200) return fail('Usuário ou senha incorretos.', 401);

  const limited = rateLimit(`login:${clientKey(req)}:${username}`, 8, 10 * 60_000);
  if (!limited.ok) {
    return fail(`Muitas tentativas. Aguarde ${Math.ceil(limited.retryAfterMs / 60_000)} min e tente de novo.`, 429);
  }
  try {
    const user = await findUserForLogin(username);
    const ok = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
    if (!user || !ok) {
      await new Promise((r) => setTimeout(r, 450));
      return fail('Usuário ou senha incorretos.', 401);
    }
    if (!user.active) return fail('Seu acesso está desativado. Fale com o administrador do Max Hub.', 403);

    limited.reset();
    // registra o último acesso (coluna do maxhub.sql; se ainda não existir, só ignora)
    await db()
      .from('admins')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id)
      .then(
        () => undefined,
        () => undefined,
      );

    const token = await signSession({ sub: user.id, name: user.display_name });
    const { password_hash: _hash, ...safe } = user;
    void _hash;
    const res = NextResponse.json({ user: safe, home: homePath(user) });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (e) {
    return serverError(e);
  }
}
