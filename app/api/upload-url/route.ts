import { NextResponse } from 'next/server';
import { BUCKET, db, ensureBucket } from '@/lib/supabaseAdmin';
import { fail, readJson, serverError } from '@/lib/http';
import { isAuthorizedEmail } from '@/lib/almoxarifado/emails';
import { EMAIL_RE, normalizeEmail } from '@/lib/format';
import { MAX_FILE_BYTES, MAX_FILES } from '@/lib/almoxarifado/limits';
import { clientKey, rateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/** fotos e vídeos que o formulário aceita (nada de SVG, HTML ou executável) */
const MEDIA_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp', 'video/3gpp2', 'video/x-m4v',
]);

/** mesma resposta para e-mail não autorizado e e-mail barrado pelo limite (não revela quem existe) */
const DENIED = 'Não foi possível liberar o envio para este e-mail. Confira o e-mail ou peça ao almoxarifado para cadastrá-lo.';

function safeName(name: string) {
  const clean = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-80);
  return clean || 'arquivo';
}

export async function POST(req: Request) {
  // rota pública: freio por endereço antes de qualquer outra coisa
  const ip = clientKey(req);
  const byIp = rateLimit(`upload:ip:${ip}`, 20, 10 * 60_000);
  if (!byIp.ok) return fail(`Muitas tentativas. Aguarde ${Math.ceil(byIp.retryAfterMs / 60_000)} min e tente de novo.`, 429);

  const body = await readJson<{ email?: string; files?: { name: string; type: string; size: number }[] }>(req);
  if (!body) return fail('Requisição inválida.');
  const email = normalizeEmail(String(body.email || ''));
  if (!EMAIL_RE.test(email)) return fail('Digite um e-mail válido.', 400, { field: 'email' });
  const files = Array.isArray(body.files) ? body.files : [];
  if (files.length === 0) return fail('Nenhum arquivo.');
  if (files.length > MAX_FILES) return fail(`Envie no máximo ${MAX_FILES} arquivos.`);
  for (const f of files) {
    const type = String(f?.type || '').toLowerCase();
    const name = String(f?.name || 'arquivo').slice(0, 80);
    if (!MEDIA_TYPES.has(type)) return fail(`"${name}" não é foto nem vídeo aceito (JPG, PNG, HEIC, MP4, MOV…).`);
    if (!(Number(f.size) > 0) || Number(f.size) > MAX_FILE_BYTES) return fail(`"${name}" passa do limite de 50 MB.`);
  }
  if (!rateLimit(`upload:email:${email}`, 15, 10 * 60_000).ok) return fail(DENIED, 403, { field: 'email' });
  try {
    if (!(await isAuthorizedEmail(email))) return fail(DENIED, 403, { field: 'email' });
    await ensureBucket();
    const uploadId = crypto.randomUUID();
    const uploads = [];
    for (let i = 0; i < files.length; i++) {
      const path = `${uploadId}/${i}-${safeName(String(files[i].name))}`;
      const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data) throw error || new Error('Falha ao gerar URL de envio');
      uploads.push({ path, signedUrl: data.signedUrl, token: data.token });
    }
    return NextResponse.json({ uploadId, uploads });
  } catch (e) {
    return serverError(e);
  }
}
