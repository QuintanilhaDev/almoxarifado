import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { currentAdmin, unauthorized } from '@/lib/auth';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { EMAIL_RE, normalizeEmail } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!(await currentAdmin())) return unauthorized();
    const { data, error } = await db()
      .from('authorized_emails')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ emails: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}

/** Aceita um ou vários e-mails (separados por vírgula, ponto e vírgula, espaço ou linha). */
export async function POST(req: Request) {
  const body = await readJson<{ emails?: string; supervisor_name?: string; posto?: string }>(req);
  const tokens = String(body?.emails || '')
    .split(/[\s,;]+/)
    .map(normalizeEmail)
    .filter(Boolean);
  if (tokens.length === 0) return fail('Digite pelo menos um e-mail.');
  if (tokens.length > 500) return fail('Cadastre no máximo 500 e-mails por vez.');
  const invalid = tokens.filter((t) => !EMAIL_RE.test(t));
  const valid = Array.from(new Set(tokens.filter((t) => EMAIL_RE.test(t))));
  if (valid.length === 0) return fail('Nenhum e-mail válido encontrado.', 400, { invalid });
  try {
    const admin = await currentAdmin();
    if (!admin) return unauthorized();
    const name = String(body?.supervisor_name || '').trim().slice(0, 120) || null;
    const posto = String(body?.posto || '').trim().slice(0, 120) || null;
    const { data, error } = await db()
      .from('authorized_emails')
      .upsert(
        valid.map((email) => ({ email, supervisor_name: name, posto, created_by: admin.display_name })),
        { onConflict: 'email', ignoreDuplicates: true },
      )
      .select('id');
    if (error) throw error;
    const added = data?.length ?? 0;
    await broadcast('emails:update', { by: admin.display_name });
    return NextResponse.json({ added, duplicates: valid.length - added, invalid });
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail('E-mail não encontrado.', 404);
  try {
    const admin = await currentAdmin();
    if (!admin) return unauthorized();
    const { error } = await db().from('authorized_emails').delete().eq('id', id);
    if (error) throw error;
    await broadcast('emails:update', { by: admin.display_name });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
