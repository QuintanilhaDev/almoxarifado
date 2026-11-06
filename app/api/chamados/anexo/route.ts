import { NextResponse } from 'next/server';
import { BUCKET, db, ensureBucket } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { fail, serverError } from '@/lib/http';
import { rateLimit } from '@/lib/rateLimit';
import { isDev, type Ticket } from '@/lib/chamados';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX = 4 * 1024 * 1024;
const TYPES = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf|text\/plain)$/;
const PATH_RE = /^chamados\/[0-9a-f-]{36}\/[\w.-]+$/;

const safe = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-80) || 'arquivo';

/** Print da tela ou PDF para o chamado. Fica na pasta de quem enviou. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail('Não consegui receber o arquivo. Tente de novo.');
    }
    if (!rateLimit(`chamado-anexo:${user.id}`, 30, 60_000).ok) return fail('Muitos arquivos em sequência. Espere um instante.', 429);
    const file = form.get('file');
    if (!file || typeof file === 'string') return fail('Escolha um arquivo.');
    if (file.size === 0) return fail('O arquivo está vazio.');
    if (file.size > MAX) return fail('O arquivo passa de 4 MB. Envie um print menor.', 413);
    const type = file.type || 'application/octet-stream';
    if (!TYPES.test(type)) return fail('Envie um print (imagem), PDF ou texto.');
    await ensureBucket();
    const path = `chamados/${user.id}/${crypto.randomUUID()}-${safe(file.name || 'print')}`;
    const { error } = await db().storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: type, upsert: false });
    if (error) throw error;
    return NextResponse.json({ attachment: { path, name: (file.name || 'print').slice(0, 120), size: file.size, type } });
  } catch (e) {
    return serverError(e);
  }
}

/** Download: o desenvolvedor vê todos; os demais, só anexos dos próprios chamados. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const path = new URL(req.url).searchParams.get('path') ?? '';
    if (!PATH_RE.test(path)) return fail('Anexo não encontrado.', 404);
    if (!isDev(user) && !path.startsWith(`chamados/${user.id}/`)) {
      // anexo que o desenvolvedor mandou num chamado desta pessoa
      const { data } = await db().from('tickets').select('messages').eq('opened_by_id', user.id).limit(300);
      const ok = ((data ?? []) as Pick<Ticket, 'messages'>[]).some((t) => (t.messages ?? []).some((m) => (m.attachments ?? []).some((a) => a.path === path)));
      if (!ok) return fail('Anexo não encontrado.', 404);
    }
    const { data, error } = await db().storage.from(BUCKET).download(path);
    if (error || !data) return fail('Anexo não encontrado.', 404);
    const name = path.split('/').pop()!.replace(/^[0-9a-f-]{36}-/, '');
    const inline = /^(image\/|application\/pdf|text\/plain)/.test(data.type);
    return new Response(Buffer.from(await data.arrayBuffer()), {
      headers: {
        'Content-Type': data.type || 'application/octet-stream',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    return serverError(e);
  }
}
