import { NextResponse } from 'next/server';
import { BUCKET, db } from '@/lib/supabaseAdmin';
import { requireAlmox } from '@/lib/access';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import type { Attachment, RequestStatus, StockApplication } from '@/lib/almoxarifado/types';
import { isMissingColumn } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Solicitação não encontrada.', 404);
  try {
    await requireAlmox('solicitacoes', 'view');
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
    const admin = await requireAlmox('solicitacoes', 'edit');
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
    const admin = await requireAlmox('solicitacoes', 'edit');
    // com baixa de estoque ativa, apagar a solicitação perderia o jeito de desfazer a baixa
    const { data: cur, error: ce } = await db().from('requests').select('stock_applications').eq('id', id).maybeSingle();
    if (ce && !isMissingColumn(ce)) throw ce;
    if (!ce && !cur) return fail('Solicitação não encontrada.', 404);
    const active = ((cur?.stock_applications ?? []) as StockApplication[]).filter((a) => !a.reverted).length;
    if (active) {
      return fail(
        `Esta solicitação tem ${active === 1 ? 'uma baixa de estoque ativa' : `${active} baixas de estoque ativas`}. Use "Estornar" na própria solicitação antes de excluí-la, senão não há como devolver o estoque.`,
        409,
      );
    }
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
