import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { internalToken } from '@/lib/geoFence';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Uso interno do próprio servidor (servidor próprio, Postgres direto): o filtro de entrada
 * (middleware) não fala com o banco, então pergunta aqui a situação atual de um usuário.
 * Só responde com a senha interna, derivada do SESSION_SECRET.
 */
export async function GET(req: Request) {
  const sub = new URL(req.url).searchParams.get('sub') || '';
  if (!/^[0-9a-f-]{36}$/i.test(sub)) return NextResponse.json({ error: 'inválido' }, { status: 400 });
  if (req.headers.get('x-maxhub-interno') !== (await internalToken(sub))) return NextResponse.json({ error: 'negado' }, { status: 403 });
  const { data, error } = await db().from('admins').select('username, is_master, active').eq('id', sub).maybeSingle();
  if (error) return NextResponse.json({ error: 'banco' }, { status: 503 });
  return NextResponse.json(data ? [data] : []);
}
