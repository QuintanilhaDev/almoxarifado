import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { serverError } from '@/lib/http';
import { homePath } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ user, home: homePath(user) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}
