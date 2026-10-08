import 'server-only';
import { fail } from '../http';

export const MAX_SHEET_BYTES = 4 * 1024 * 1024; // a Vercel recusa corpos maiores que ~4,5 MB

/** Lê o arquivo enviado em multipart ("file"). Devolve o conteúdo ou uma resposta de erro pronta. */
export async function readUpload(req: Request): Promise<{ buf: Buffer; name: string } | { error: Response }> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return { error: fail('Não consegui receber o arquivo. Tente de novo.') };
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') return { error: fail('Escolha uma planilha para enviar.') };
  if (file.size === 0) return { error: fail('O arquivo está vazio.') };
  if (file.size > MAX_SHEET_BYTES) {
    return { error: fail('O arquivo é grande demais (máximo 4 MB). Divida a planilha em partes.', 413) };
  }
  return { buf: Buffer.from(await file.arrayBuffer()), name: file.name || 'planilha' };
}
