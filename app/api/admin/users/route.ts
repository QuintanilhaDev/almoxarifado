import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/supabaseAdmin';
import { currentAdmin, forbidden, unauthorized } from '@/lib/auth';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';

export const dynamic = 'force-dynamic';

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

/** Lista os usuários do painel (só o master). */
export async function GET() {
  try {
    const admin = await currentAdmin();
    if (!admin) return unauthorized();
    if (!admin.is_master) return forbidden();
    const { data, error } = await db()
      .from('admins')
      .select('id, username, display_name, is_master, created_at')
      .order('created_at', { ascending: true })
      .limit(500);
    if (error) throw error;
    const users = (data ?? [])
      .map((u) => ({ ...u, is_master: Boolean(u.is_master) }))
      .sort((a, b) => Number(b.is_master) - Number(a.is_master) || a.created_at.localeCompare(b.created_at));
    return NextResponse.json({ users }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}

/** Cria um usuário comum (só o master). */
export async function POST(req: Request) {
  const body = await readJson<{ username?: string; display_name?: string; password?: string }>(req);
  if (!body) return fail('Requisição inválida.');
  const username = String(body.username ?? '').trim().toLowerCase();
  const display_name = String(body.display_name ?? '').trim().slice(0, 40);
  const password = String(body.password ?? '');
  if (!display_name) return fail('Digite o nome da pessoa.', 400, { field: 'display_name' });
  if (!USERNAME_RE.test(username))
    return fail('Usuário deve ter de 3 a 30 caracteres: letras minúsculas, números, ponto, hífen ou _.', 400, { field: 'username' });
  if (password.length < 6) return fail('A senha precisa ter pelo menos 6 caracteres.', 400, { field: 'password' });
  if (Buffer.byteLength(password, 'utf8') > 72) return fail('A senha pode ter no máximo 72 caracteres.', 400, { field: 'password' });
  try {
    const admin = await currentAdmin();
    if (!admin) return unauthorized();
    if (!admin.is_master) return forbidden();
    const { data: taken } = await db().from('admins').select('id').eq('username', username).maybeSingle();
    if (taken) return fail('Este usuário já existe.', 400, { field: 'username' });
    const { data, error } = await db()
      .from('admins')
      .insert({ username, display_name, password_hash: await bcrypt.hash(password, 10), is_master: false })
      .select('id, username, display_name, is_master, created_at')
      .single();
    if (error) {
      if ((error as { code?: string }).code === '23505') return fail('Este usuário já existe.', 400, { field: 'username' });
      throw error;
    }
    await broadcast('admins:update', {});
    return NextResponse.json({ user: { ...data, is_master: Boolean(data.is_master) } }, { status: 201 });
  } catch (e) {
    return serverError(e);
  }
}
