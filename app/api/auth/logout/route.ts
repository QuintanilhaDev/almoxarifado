import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';
import { sessionCookieOptions } from '@/lib/auth';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}
