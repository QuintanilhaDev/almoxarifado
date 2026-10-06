import { NextResponse } from 'next/server';
import { BUCKET, db } from '@/lib/supabaseAdmin';
import { currentAdmin, unauthorized } from '@/lib/auth';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import type { Attachment, RequestStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Solicitação não encontrada.', 404);
  try {
    if (!(await currentAdmin())) return unauthorized();
    const { data, error } = await db().from('requests').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return fail('Solicitação não encontrada.', 404);
    const atts = (data.attachments ?? []) as Attachment[];
    if (atts.length) {
      const { data: signed } = await db()
        .storage.from(BUCKET)
        .createSignedUrls(
          atts.map((a) => a.path),
          60 * 60,
        );
      atts.forEach((a, i) => {
        a.url = signed?.[i]?.signedUrl ?? undefined;
      });
    }
    return NextResponse.json({ request: { ...data, attachments: atts } });
  } catch (e) {
    return serverError(e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Solicitação não encontrada.', 404);
  const body = await readJson<{ status?: RequestStatus }>(req);
  const status = body?.status;
  if (!status || !['nova', 'pendente', 'resolvida'].includes(status)) return fail('Status inválido.');
  try {
    const admin = await currentAdmin();
    if (!admin) return unauthorized();
    const { data, error } = await db()
      .from('requests')
      .update({
        status,
        handled_by: status === 'nova' ? null : admin.display_name,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail('Solicitação não encontrada.', 404);
    await broadcast('request:update', { id, status, by: admin.display_name });
    return NextResponse.json({ request: data });
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Solicitação não encontrada.', 404);
  try {
    const admin = await currentAdmin();
    if (!admin) return unauthorized();
    const { data, error } = await db().from('requests').delete().eq('id', id).select('attachments').maybeSingle();
    if (error) throw error;
    if (!data) return fail('Solicitação não encontrada.', 404);
    const paths = ((data.attachments ?? []) as Attachment[]).map((a) => a.path);
    if (paths.length) await db().storage.from(BUCKET).remove(paths).catch(() => undefined);
    await broadcast('request:update', { id, deleted: true, by: admin.display_name });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
