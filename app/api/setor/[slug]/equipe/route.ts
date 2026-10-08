import { NextResponse } from 'next/server';
import { requireSectorManager } from '@/lib/access';
import { listUsers } from '@/lib/auth';
import { serverError } from '@/lib/http';
import { missingHubSql } from '@/lib/users';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

/** Equipe do setor (para o master do setor e o master geral). */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    await requireSectorManager(slug);
    const users = (await listUsers(slug)).filter((u) => !u.is_master);
    return NextResponse.json({ users }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return missingHubSql(e) ?? serverError(e);
  }
}
