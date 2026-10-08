import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireAlmox } from '@/lib/access';
import { serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAlmox('solicitacoes', 'view');
    const { data, error } = await db()
      .from('requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) throw error;
    return NextResponse.json({ requests: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}
