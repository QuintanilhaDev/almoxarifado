import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { currentAdmin, unauthorized } from '@/lib/auth';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { loadPostos, str } from '@/lib/stockData';
import { postoKey } from '@/lib/sheetReader';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!(await currentAdmin())) return unauthorized();
    return NextResponse.json({ postos: await loadPostos() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}

/**
 * Cria um posto (com os detalhes) ou vários de uma vez,
 * a partir de `names` (um nome por linha).
 */
export async function POST(req: Request) {
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail('Dados inválidos.');
  try {
    const admin = await currentAdmin();
    if (!admin) return unauthorized();

    if (typeof body.names === 'string') {
      const names = Array.from(
        new Map(
          body.names
            .split(/\r?\n|;/)
            .map((n) => str(n, 120))
            .filter((n): n is string => Boolean(n))
            .map((n) => [postoKey(n), n] as const),
        ).values(),
      );
      if (!names.length) return fail('Digite pelo menos um nome.');
      if (names.length > 300) return fail('Cadastre no máximo 300 postos por vez.');
      const { data, error } = await db()
        .from('postos')
        .upsert(
          names.map((name) => ({ name, created_by: admin.display_name })),
          { onConflict: 'name_key', ignoreDuplicates: true },
        )
        .select('id');
      if (error) throw error;
      const added = data?.length ?? 0;
      if (added) await broadcast('postos:update', { by: admin.display_name });
      return NextResponse.json({ added, duplicates: names.length - added });
    }

    const name = str(body.name, 120);
    if (!name) return fail('Dê um nome ao posto.');
    const { data, error } = await db()
      .from('postos')
      .insert({
        name,
        code: str(body.code, 40),
        city: str(body.city, 80),
        address: str(body.address, 200),
        supervisor: str(body.supervisor, 120),
        notes: str(body.notes, 400),
        created_by: admin.display_name,
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') return fail('Já existe um posto com esse nome.', 409);
      throw error;
    }
    await broadcast('postos:update', { by: admin.display_name });
    return NextResponse.json({ id: data.id, added: 1, duplicates: 0 });
  } catch (e) {
    return serverError(e);
  }
}
