import { NextResponse } from 'next/server';
import { audit } from '@/lib/audit';
import bcrypt from 'bcryptjs';
import { fail, readJson, serverError } from '@/lib/http';
import { SESSION_COOKIE, isBcryptHash, passwordFingerprint, signSession } from '@/lib/session';
import { GEO_COOKIE, GEO_EXEMPT_TTL_S, geoFenced, signGeo } from '@/lib/geoFence';
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

  // três freios: IP + usuário, só o IP (vários usuários) e só o usuário (vários IPs)
  const ip = clientKey(req);
  const limited = rateLimit(`login:${ip}:${username}`, 8, 10 * 60_000);
  const byIp = rateLimit(`login-ip:${ip}`, 30, 10 * 60_000);
  const byUser = rateLimit(`login-user:${username}`, 20, 10 * 60_000);
  const blocked = [limited, byIp, byUser].find((l) => !l.ok);
  if (blocked) {
    return fail(`Muitas tentativas. Aguarde ${Math.ceil(blocked.retryAfterMs / 60_000)} min e tente de novo.`, 429);
  }
  try {
    const user = await findUserForLogin(username);
    // sem senha definida (marcador no lugar do hash) conta como senha errada, no mesmo tempo
    const usable = isBcryptHash(user?.password_hash);
    const ok = (await bcrypt.compare(password, usable ? user!.password_hash : DUMMY_HASH).catch(() => false)) && usable;
    if (!user || !ok) {
      await new Promise((r) => setTimeout(r, 450));
      await audit({ user: null, who: user ? user.display_name : `@${username}`, kind: 'acesso', action: 'Tentou entrar com a senha errada', detail: user ? `usuário @${username}` : `usuário @${username} não existe`, ok: false });
      return fail('Usuário ou senha incorretos.', 401);
    }
    if (!user.active) {
      await audit({ user, kind: 'acesso', action: 'Tentou entrar com o acesso desativado', ok: false });
      return fail('Seu acesso está desativado. Fale com o administrador do Max Hub.', 403);
    }

    limited.reset();
    byUser.reset();
    // registra o último acesso (coluna do maxhub.sql; se ainda não existir, só ignora)
    await db()
      .from('admins')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id)
      .then(
        () => undefined,
        () => undefined,
      );

    await audit({ user, kind: 'acesso', action: 'Entrou no Max Hub' });
    const token = await signSession({ sub: user.id, name: user.display_name, pwf: await passwordFingerprint(user.password_hash) });
    const { password_hash: _hash, ...safe } = user;
    void _hash;
    const res = NextResponse.json({ user: safe, home: homePath(user) });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    // quem não tem cerca de localização já sai liberado; quem tem espera a posição do aparelho
    if (geoFenced(user)) res.cookies.set(GEO_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
    else res.cookies.set(GEO_COOKIE, await signGeo(user.id, true, user.username), { ...sessionCookieOptions(), maxAge: GEO_EXEMPT_TTL_S });
    return res;
  } catch (e) {
    return serverError(e);
  }
}
