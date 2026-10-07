import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { currentAdmin, unauthorized } from '@/lib/auth';
import { fail, serverError } from '@/lib/http';
import { UUID_RE } from '@/lib/stockData';

export const dynamic = 'force-dynamic';

/** Histórico geral (ou de um posto). Mais recentes primeiro, com paginação por "offset". */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const posto = url.searchParams.get('posto_id');
  const offset = Math.max(0, Math.min(100000, Number(url.searchParams.get('offset')) || 0));
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 60));
  if (posto && !UUID_RE.test(posto)) return fail('Posto não encontrado.', 404);
  try {
    if (!(await currentAdmin())) return unauthorized();
    let q = db().from('stock_movements').select('*').order('created_at', { ascending: false }).order('id', { ascending: false });
    if (posto) q = q.eq('posto_id', posto);
    const { data, error } = await q.range(offset, offset + limit);
    if (error) throw error;
    const rows = data ?? [];
    return NextResponse.json({ movements: rows.slice(0, limit), more: rows.length > limit });
  } catch (e) {
    return serverError(e);
  }
}
