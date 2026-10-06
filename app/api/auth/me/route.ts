import { NextResponse } from 'next/server';
import { currentAdmin, unauthorized } from '@/lib/auth';
import { serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await currentAdmin();
    if (!user) return unauthorized();
    return NextResponse.json({ user });
  } catch (e) {
    return serverError(e);
  }
}
