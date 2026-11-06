import { BUCKET_OPTIONS } from '@/lib/supabaseAdmin';
import { DIRECT } from '@/lib/pg/pool';
import { checkSig, readFile, writeFile } from '@/lib/pg/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Anexos no servidor próprio (modo Postgres direto), por link assinado:
 *  GET  ?b=&p=&e=&s=  → baixa/mostra o arquivo (link gerado pelo sistema, vale por pouco tempo)
 *  PUT  ?b=&p=&e=&s=  → o formulário dos supervisores envia a foto/vídeo direto para cá
 * Sem a assinatura certa (ou vencida), nada feito.
 */
function params(req: Request) {
  const u = new URL(req.url);
  return { b: u.searchParams.get('b') || '', p: u.searchParams.get('p') || '', e: Number(u.searchParams.get('e')), s: u.searchParams.get('s') || '' };
}
const notFound = () => new Response(JSON.stringify({ error: 'Arquivo não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

export async function GET(req: Request) {
  if (!DIRECT) return notFound();
  const { b, p, e, s } = params(req);
  if (!checkSig(b, p, e, 'get', s)) return notFound();
  const f = await readFile(b, p);
  if (!f) return notFound();
  const name = p.split('/').pop() || 'arquivo';
  const inline = /^(image\/|video\/|application\/pdf|text\/plain)/.test(f.type);
  return new Response(new Uint8Array(f.body), {
    headers: {
      'Content-Type': f.type,
      'Content-Length': String(f.body.length),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\w.-]/g, '_')}"`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function upload(req: Request) {
  if (!DIRECT) return notFound();
  const { b, p, e, s } = params(req);
  if (!checkSig(b, p, e, 'put', s)) return new Response(JSON.stringify({ error: 'Link de envio inválido ou vencido.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  let body: Buffer;
  let type = '';
  const ct = req.headers.get('content-type') || '';
  if (ct.startsWith('multipart/form-data')) {
    const form = await req.formData();
    const file = [...form.values()].find((v): v is File => typeof v !== 'string');
    if (!file) return new Response(JSON.stringify({ error: 'Arquivo ausente.' }), { status: 400 });
    body = Buffer.from(await file.arrayBuffer());
    type = file.type;
  } else {
    body = Buffer.from(await req.arrayBuffer());
    type = ct;
  }
  if (!body.length) return new Response(JSON.stringify({ error: 'Arquivo vazio.' }), { status: 400 });
  if (body.length > BUCKET_OPTIONS.fileSizeLimit) return new Response(JSON.stringify({ error: 'Arquivo grande demais.' }), { status: 413 });
  if (!BUCKET_OPTIONS.allowedMimeTypes.includes(type)) return new Response(JSON.stringify({ error: 'Tipo de arquivo não aceito.' }), { status: 415 });
  const r = await writeFile(b, p, body, type, false);
  if (r.error) return new Response(JSON.stringify({ error: r.error.message }), { status: r.error.statusCode === '409' ? 409 : 400 });
  return new Response(JSON.stringify({ Key: `${b}/${p}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
export const PUT = upload;
export const POST = upload;
