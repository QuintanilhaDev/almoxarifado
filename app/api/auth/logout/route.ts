import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';
import { sessionCookieOptions } from '@/lib/auth';
import { sessionUser } from '@/lib/sessionUser';
import { audit } from '@/lib/audit';
import { GEO_COOKIE } from '@/lib/geoFence';

export const dynamic = 'force-dynamic';

export async function POST() {
  const user = await sessionUser().catch(() => null);
  if (user) await audit({ user, kind: 'acesso', action: 'Saiu do Max Hub' });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  // cookie da versão anterior (quando o sistema era só o Almoxarifado)
  res.cookies.set('almox_session', '', { ...sessionCookieOptions(), maxAge: 0 });
  res.cookies.set(GEO_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}
