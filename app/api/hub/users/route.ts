import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/supabaseAdmin';
import { requireMaster } from '@/lib/access';
import { listUsers, toUserRow } from '@/lib/auth';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { USERNAME_HELP, USERNAME_RE } from '@/lib/permissions';
import { cleanName, cleanUsername, missingHubSql, normalizeAllocation, passwordError } from '@/lib/users';

export const dynamic = 'force-dynamic';

const LIST_COLS = 'id, username, display_name, is_master, sector, sector_role, permissions, active, created_at, last_login_at';

/** Todos os usuários do Max Hub (só master geral). */
export async function GET() {
  try {
    await requireMaster();
    const users = await listUsers();
    return NextResponse.json({ users }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return missingHubSql(e) ?? serverError(e);
  }
}

/** Cria um usuário já alocado (só master geral). */
export async function POST(req: Request) {
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail('Requisição inválida.');
  const display_name = cleanName(body.display_name);
  const username = cleanUsername(body.username);
  const password = String(body.password ?? '');
  if (!display_name) return fail('Digite o nome da pessoa.', 400, { field: 'display_name' });
  if (!USERNAME_RE.test(username)) return fail(USERNAME_HELP, 400, { field: 'username' });
  const pe = passwordError(password);
  if (pe) return fail(pe, 400, { field: 'password' });
  const alloc = normalizeAllocation(body);
  if ('error' in alloc) return fail(alloc.error, 400, { field: alloc.field });
  try {
    const me = await requireMaster();
    const { data: taken, error: te } = await db().from('admins').select('id').eq('username', username).maybeSingle();
    if (te) throw te;
    if (taken) return fail('Este usuário já existe.', 400, { field: 'username' });
    const { data, error } = await db()
      .from('admins')
      .insert({
        username,
        display_name,
        password_hash: await bcrypt.hash(password, 10),
        ...alloc,
        active: true,
        created_by: me.display_name,
      })
      .select(LIST_COLS)
      .single();
    if (error) {
      if ((error as { code?: string }).code === '23505') return fail('Este usuário já existe.', 400, { field: 'username' });
      throw error;
    }
    await broadcast('admins:update', {});
    return NextResponse.json({ user: toUserRow(data as unknown as Record<string, unknown>) }, { status: 201 });
  } catch (e) {
    return missingHubSql(e) ?? serverError(e);
  }
}
