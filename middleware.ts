import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from './lib/session';

/**
 * Primeira barreira: sem sessão válida, as áreas internas voltam para o login.
 * Quem PODE ver cada setor é decidido nas próprias páginas e rotas, consultando o banco.
 */
export async function middleware(req: NextRequest) {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/hub/:path*', '/setor/:path*', '/sem-setor', '/dashboard/:path*'],
};
