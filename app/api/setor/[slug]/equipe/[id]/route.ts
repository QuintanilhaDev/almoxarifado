import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireSectorManager } from '@/lib/access';
import { loadUserRow, toUserRow } from '@/lib/auth';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { sanitizePermissions } from '@/lib/permissions';
import { UUID_RE, missingHubSql } from '@/lib/users';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * O master do setor ajusta as permissões de um membro do PRÓPRIO setor.
 * Ele não cria usuários, não troca setor nem mexe em outros masters: isso é do master geral.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Usuário não encontrado.', 404);
  const body = await readJson<{ permissions?: unknown }>(req);
  if (!body || typeof body.permissions !== 'object' || body.permissions === null) return fail('Requisição inválida.');
  try {
    const me = await requireSectorManager(slug);
    const target = await loadUserRow(id);
    if (!target || target.sector !== slug || target.is_master) return fail('Esta pessoa não faz parte deste setor.', 404);
    if (target.sector_role === 'master' && !me.is_master) {
      return fail('Só o master geral altera outro master do setor.', 403);
    }
    if (target.sector_role === 'master') return fail('O master do setor já tem acesso total.', 400);
    const permissions = sanitizePermissions(slug, body.permissions);
    const { data, error } = await db()
      .from('admins')
      .update({ permissions, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('sector', slug)
      .select('id, username, display_name, is_master, sector, sector_role, permissions, active, created_at, last_login_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail('Esta pessoa não faz parte deste setor.', 404);
    await broadcast('admins:update', { id });
    return NextResponse.json({ user: toUserRow(data as unknown as Record<string, unknown>) });
  } catch (e) {
    return missingHubSql(e) ?? serverError(e);
  }
}
