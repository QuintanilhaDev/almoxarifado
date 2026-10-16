import { NextResponse } from 'next/server';
import { BUCKET, db, ensureBucket } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, serverError } from '@/lib/http';
import { rateLimit } from '@/lib/rateLimit';
import { canSeeOrders } from '@/lib/compras/pcServer';
import { comprasEdit } from '@/lib/compras/access';
import { notesAccess } from '@/lib/pedidos/access';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX = 4 * 1024 * 1024; // a Vercel recusa corpos maiores que ~4,5 MB
const TYPES = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf|application\/xml|text\/xml|application\/vnd\.openxmlformats-officedocument\.(spreadsheetml\.sheet|wordprocessingml\.document)|application\/msword|application\/vnd\.ms-excel|text\/plain)$/;
const SCOPES = ['nota', 'cotacao', 'pedido'] as const;

const safe = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-80) || 'arquivo';

/**
 * Anexos de Compras e do recebimento (DANFE, propostas, pedido assinado…).
 * Ficam no Storage do Supabase (privado); o download passa por aqui, conferindo o acesso.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail('Não consegui receber o arquivo. Tente de novo.');
    }
    const scope = String(form.get('scope') ?? '') as (typeof SCOPES)[number];
    if (!SCOPES.includes(scope)) return fail('Tipo de anexo inválido.');
    if (scope === 'nota' ? !notesAccess(user, 'edit') : !comprasEdit(user)) throw new AccessError(403, 'Você não pode anexar arquivos aqui.');
    if (!rateLimit(`anexo:${user.id}`, 40, 60_000).ok) return fail('Muitos arquivos em sequência. Espere um instante.', 429);
    const file = form.get('file');
    if (!file || typeof file === 'string') return fail('Escolha um arquivo.');
    if (file.size === 0) return fail('O arquivo está vazio.');
    if (file.size > MAX) return fail('O arquivo passa de 4 MB. Para fotos, tire com qualidade menor; para PDF, salve em tamanho reduzido.', 413);
    const type = file.type || 'application/octet-stream';
    if (!TYPES.test(type)) return fail('Envie foto (JPG/PNG), PDF, XML, planilha ou documento.');
    await ensureBucket();
    const path = `compras/${scope}/${crypto.randomUUID()}-${safe(file.name || 'arquivo')}`;
    const { error } = await db().storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: type, upsert: false });
    if (error) throw error;
    return NextResponse.json({ attachment: { path, name: (file.name || 'arquivo').slice(0, 120), size: file.size, type, at: new Date().toISOString(), by: user.display_name } });
  } catch (e) {
    return serverError(e);
  }
}

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    if (!canSeeOrders(user)) throw new AccessError(403, 'Você não tem acesso a este anexo.');
    const path = new URL(req.url).searchParams.get('path') ?? '';
    if (!/^compras\/(nota|cotacao|pedido)\/[\w.-]+$/.test(path)) return fail('Anexo não encontrado.', 404);
    const { data, error } = await db().storage.from(BUCKET).download(path);
    if (error || !data) return fail('Anexo não encontrado.', 404);
    const name = path.split('/').pop()!.replace(/^[0-9a-f-]{36}-/, '');
    const buf = Buffer.from(await data.arrayBuffer());
    const inline = /^(image\/|application\/pdf)/.test(data.type);
    return new Response(buf, {
      headers: {
        'Content-Type': data.type || 'application/octet-stream',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (e) {
    return serverError(e);
  }
}
