import { NextResponse } from 'next/server';
import { sessionUser } from '@/lib/sessionUser';
import { fail, readJson } from '@/lib/http';
import { rateLimit } from '@/lib/rateLimit';
import { audit } from '@/lib/audit';
import type { AuditKind } from '@/lib/auditTypes';
import { redactSecrets } from '@/lib/max/moderation';

export const dynamic = 'force-dynamic';

const KINDS: AuditKind[] = ['tela', 'acao', 'max', 'erro'];

/** O navegador conta o que a pessoa fez (telas, alterações com o resultado, pedidos à Max). Nada é gravado em banco. */
export async function POST(req: Request) {
  const user = await sessionUser();
  if (!user) return fail('Faça login.', 401);
  if (!rateLimit(`audit:${user.id}`, 240, 60_000).ok) return NextResponse.json({ ok: false });
  const b = await readJson<{ events?: unknown }>(req);
  const list = Array.isArray(b?.events) ? (b!.events as Record<string, unknown>[]).slice(0, 20) : [];
  for (const e of list) {
    const kind = KINDS.includes(e.kind as AuditKind) ? (e.kind as AuditKind) : 'acao';
    // senha dita à Max nunca fica no registro (o navegador já tira; aqui é a segunda trava)
    const action = typeof e.action === 'string' ? redactSecrets(e.action.trim()) : '';
    if (!action) continue;
    await audit({ user, kind, action, detail: typeof e.detail === 'string' ? redactSecrets(e.detail) : null, ok: e.ok !== false, path: typeof e.path === 'string' ? e.path.slice(0, 160) : null });
  }
  return NextResponse.json({ ok: true });
}
