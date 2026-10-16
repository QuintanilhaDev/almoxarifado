import { NextResponse } from 'next/server';
import { BUCKET, db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, serverError } from '@/lib/http';
import { notesAccess } from '@/lib/pedidos/access';
import { findKey, keyInfo } from '@/lib/notas/conferencia';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Lê o DANFE em PDF (anexado antes): acha a chave de acesso, o valor total e a data de
 * emissão no texto. É só ajuda para preencher — a pessoa confere antes de gravar.
 * (Foto do DANFE: o próprio navegador lê o código de barras da chave.)
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    if (!notesAccess(user, 'edit')) throw new AccessError(403, 'Sem acesso.');
    const path = new URL(req.url).searchParams.get('path') ?? '';
    if (!/^compras\/nota\/[\w.-]+$/.test(path)) return fail('Anexo não encontrado.', 404);
    const { data, error } = await db().storage.from(BUCKET).download(path);
    if (error || !data) return fail('Anexo não encontrado.', 404);
    if (!/pdf/i.test(data.type) && !path.toLowerCase().endsWith('.pdf')) return NextResponse.json({ found: false, reason: 'não é PDF' });
    let text = '';
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await data.arrayBuffer()), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
      for (let i = 1; i <= Math.min(doc.numPages, 3); i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        text += ' ' + tc.items.map((x) => ('str' in x ? x.str : '')).join(' ');
      }
    } catch {
      return NextResponse.json({ found: false, reason: 'PDF sem texto (escaneado). Digite a chave ou envie uma foto nítida do código de barras.' });
    }
    const key = findKey(text);
    const total = text.match(/VALOR\s+TOTAL\s+DA\s+NOTA[^\d]{0,40}([\d.]{1,12},\d{2})/i)?.[1] ?? null;
    const issue = text.match(/EMISS[ÃA]O[^\d]{0,40}(\d{2})\/(\d{2})\/(\d{4})/i);
    return NextResponse.json({
      found: Boolean(key || total),
      key,
      info: key ? keyInfo(key) : null,
      total: total ? Number(total.replace(/\./g, '').replace(',', '.')) : null,
      issue_date: issue ? `${issue[3]}-${issue[2]}-${issue[1]}` : null,
    });
  } catch (e) {
    return serverError(e);
  }
}
