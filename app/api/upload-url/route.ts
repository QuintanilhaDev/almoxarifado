import { NextResponse } from 'next/server';
import { BUCKET, db, ensureBucket } from '@/lib/supabaseAdmin';
import { fail, readJson, serverError } from '@/lib/http';
import { isAuthorizedEmail } from '@/lib/almoxarifado/emails';
import { EMAIL_RE, normalizeEmail } from '@/lib/format';
import { MAX_FILE_BYTES, MAX_FILES } from '@/lib/almoxarifado/limits';

export const dynamic = 'force-dynamic';


function safeName(name: string) {
  const clean = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-80);
  return clean || 'arquivo';
}

export async function POST(req: Request) {
  const body = await readJson<{ email?: string; files?: { name: string; type: string; size: number }[] }>(req);
  if (!body) return fail('Requisição inválida.');
  const email = normalizeEmail(String(body.email || ''));
  if (!EMAIL_RE.test(email)) return fail('Digite um e-mail válido.', 400, { field: 'email' });
  const files = Array.isArray(body.files) ? body.files : [];
  if (files.length === 0) return fail('Nenhum arquivo.');
  if (files.length > MAX_FILES) return fail(`Envie no máximo ${MAX_FILES} arquivos.`);
  for (const f of files) {
    const type = String(f?.type || '');
    if (!/^(image|video)\//.test(type)) return fail(`"${f?.name}" não é foto nem vídeo.`);
    if (!(Number(f.size) > 0) || Number(f.size) > MAX_FILE_BYTES)
      return fail(`"${f.name}" passa do limite de 50 MB.`);
  }
  try {
    if (!(await isAuthorizedEmail(email)))
      return fail('Este e-mail não está autorizado. Peça ao almoxarifado para cadastrá-lo.', 403, { field: 'email' });
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
