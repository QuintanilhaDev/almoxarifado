import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from './lib/session';
import { GEO_COOKIE, geoConfig, geoFree, verifyGeo } from './lib/geoFence';

/**
 * Primeira barreira:
 *  - páginas internas sem sessão válida voltam para o login;
 *  - rotas do sistema (/api) exigem a permissão de localização: quem tem cerca (hoje só o
 *    @uesley) só a recebe dentro do terreno; os demais recebem uma permissão sem cerca.
 * Quem PODE ver cada setor é decidido nas próprias páginas e rotas, consultando o banco.
 */
export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (path.startsWith('/api/')) {
    // sem sessão: a própria rota decide (login, formulário público…)
    if (!session || geoFree(path) || !geoConfig().on) return NextResponse.next();
    if (await verifyGeo(req.cookies.get(GEO_COOKIE)?.value, session.sub)) return NextResponse.next();
    return NextResponse.json({ error: 'A plataforma só funciona dentro do terreno da empresa. Confira a sua localização.', geo: true }, { status: 403 });
  }
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/hub/:path*', '/setor/:path*', '/sem-setor', '/dashboard/:path*', '/api/:path*'],
};
