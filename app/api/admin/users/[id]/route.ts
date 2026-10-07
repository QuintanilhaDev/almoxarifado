import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/supabaseAdmin';
import { currentAdmin, forbidden, unauthorized } from '@/lib/auth';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Troca a senha de qualquer usuário, inclusive a do próprio master (só o master). */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Usuário não encontrado.', 404);
  const body = await readJson<{ new_password?: string }>(req);
  const password = String(body?.new_password ?? '');
  if (password.length < 6) return fail('A senha precisa ter pelo menos 6 caracteres.', 400, { field: 'new_password' });
  if (Buffer.byteLength(password, 'utf8') > 72) return fail('A senha pode ter no máximo 72 caracteres.', 400, { field: 'new_password' });
  try {
    const admin = await currentAdmin();
    if (!admin) return unauthorized();
    if (!admin.is_master) return forbidden();
    const { data, error } = await db()
      .from('admins')
      .update({ password_hash: await bcrypt.hash(password, 10), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, username, display_name')
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail('Usuário não encontrado.', 404);
    await broadcast('admins:update', {});
    return NextResponse.json({ ok: true, user: data });
  } catch (e) {
    return serverError(e);
  }
}
