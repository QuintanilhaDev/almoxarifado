import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/supabaseAdmin';
import { requireMaster } from '@/lib/access';
import { loadUserRow, toUserRow } from '@/lib/auth';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { USERNAME_HELP, USERNAME_RE } from '@/lib/permissions';
import { UUID_RE, cleanName, cleanUsername, missingHubSql, normalizeAllocation, passwordError } from '@/lib/users';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };
const LIST_COLS = 'id, username, display_name, is_master, sector, sector_role, permissions, active, created_at, last_login_at';

/** Quantos masters gerais ativos existem além da pessoa informada. */
async function otherActiveMasters(exceptId: string): Promise<number> {
  const { data, error } = await db().from('admins').select('id').eq('is_master', true).eq('active', true).neq('id', exceptId).limit(5);
  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Edita um usuário (só master geral): nome, usuário de login, senha, tipo de acesso,
 * setor, papel no setor, permissões e ativo/desativado. Só o que vier no corpo muda.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Usuário não encontrado.', 404);
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail('Requisição inválida.');
  try {
    const me = await requireMaster();
    const target = await loadUserRow(id);
    if (!target) return fail('Usuário não encontrado.', 404);
    const self = target.id === me.id;
    const patch: Record<string, unknown> = {};

    if ('display_name' in body) {
      const name = cleanName(body.display_name);
      if (!name) return fail('Digite o nome da pessoa.', 400, { field: 'display_name' });
      patch.display_name = name;
    }
    if ('username' in body) {
      const username = cleanUsername(body.username);
      if (!USERNAME_RE.test(username)) return fail(USERNAME_HELP, 400, { field: 'username' });
      if (username !== target.username) {
        const { data: taken, error: te } = await db().from('admins').select('id').eq('username', username).maybeSingle();
        if (te) throw te;
        if (taken) return fail('Este usuário já está em uso.', 400, { field: 'username' });
        patch.username = username;
      }
    }
    if (body.new_password !== undefined && body.new_password !== '') {
      const password = String(body.new_password);
      const pe = passwordError(password);
      if (pe) return fail(pe, 400, { field: 'new_password' });
      patch.password_hash = await bcrypt.hash(password, 10);
    }
    if ('active' in body) {
      const active = body.active !== false;
      if (!active && self) return fail('Você não pode desativar o seu próprio acesso.', 400, { field: 'active' });
      patch.active = active;
    }
    if ('is_master' in body || 'sector' in body || 'sector_role' in body || 'permissions' in body) {
      const sectorChanged = 'sector' in body && (body.sector || null) !== target.sector;
      const alloc = normalizeAllocation({
        is_master: 'is_master' in body ? body.is_master : target.is_master,
        sector: 'sector' in body ? body.sector : target.sector,
        sector_role: 'sector_role' in body ? body.sector_role : target.sector_role,
        // ao trocar de setor, as permissões antigas não valem mais
        permissions: 'permissions' in body ? body.permissions : sectorChanged ? undefined : target.permissions,
      });
      if ('error' in alloc) return fail(alloc.error, 400, { field: alloc.field });
      if (self && !alloc.is_master) {
        return fail('Você não pode tirar o seu próprio acesso master. Peça a outro master.', 400, { field: 'is_master' });
      }
      Object.assign(patch, alloc);
    }
    // nunca deixa o sistema sem nenhum master geral ativo
    const willBeMaster = 'is_master' in patch ? patch.is_master === true : target.is_master;
    const willBeActive = 'active' in patch ? patch.active === true : target.active;
    if (target.is_master && target.active && !(willBeMaster && willBeActive) && (await otherActiveMasters(id)) === 0) {
      return fail('Este é o único master geral ativo. Defina outro master antes.', 400, { field: 'is_master' });
    }

    if (Object.keys(patch).length === 0) return NextResponse.json({ user: target });
    patch.updated_at = new Date().toISOString();
    const { data, error } = await db().from('admins').update(patch).eq('id', id).select(LIST_COLS).maybeSingle();
    if (error) {
      if ((error as { code?: string }).code === '23505') return fail('Este usuário já está em uso.', 400, { field: 'username' });
      throw error;
    }
    if (!data) return fail('Usuário não encontrado.', 404);
    await broadcast('admins:update', { id });
    return NextResponse.json({ user: toUserRow(data as unknown as Record<string, unknown>) });
  } catch (e) {
    return missingHubSql(e) ?? serverError(e);
  }
}

/** Exclui um usuário (só master geral). O histórico guarda o nome em texto, então nada se perde. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Usuário não encontrado.', 404);
  try {
    const me = await requireMaster();
    if (id === me.id) return fail('Você não pode excluir o seu próprio usuário.');
    const target = await loadUserRow(id);
    if (!target) return fail('Usuário não encontrado.', 404);
    if (target.is_master && target.active && (await otherActiveMasters(id)) === 0) {
      return fail('Este é o único master geral ativo. Defina outro master antes.');
    }
    const { error } = await db().from('admins').delete().eq('id', id);
    if (error) throw error;
    await broadcast('admins:update', { id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return missingHubSql(e) ?? serverError(e);
  }
}
