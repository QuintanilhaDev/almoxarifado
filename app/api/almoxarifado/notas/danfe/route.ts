import { NextResponse } from 'next/server';
import { BUCKET, db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, serverError } from '@/lib/http';
import { notesAccess } from '@/lib/pedidos/access';
import { findKey, keyInfo } from '@/lib/notas/conferencia';
import { UUID_RE } from '@/lib/almoxarifado/stockData';
import { hasPC } from '@/lib/notas/server';
import { openOrdersOf } from '@/lib/notas/flow';
import { itemInText, orderRefs } from '@/lib/notas/vinculo';
import { poLeft } from '@/lib/compras/pc';

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
    // pedidos do mesmo fornecedor que esta nota atende: o DANFE cita o número ("PEDIDO 0002")
    // ou traz os itens dele. Também diz quais linhas do pedido escolhido não estão no DANFE.
    const sp = new URL(req.url).searchParams;
    const orderId = sp.get('order');
    let orders: { id: string; number: number; why: string }[] = [];
    let missing: string[] = [];
    if (await hasPC()) {
      let supplierId: string | null = null;
      let cnpj = key ? keyInfo(key)?.cnpj ?? null : null;
      if (orderId && UUID_RE.test(orderId)) {
        const { data: o } = await db().from('purchase_orders').select('supplier_id, cnpj').eq('id', orderId).maybeSingle();
        supplierId = (o?.supplier_id as string) ?? null;
        cnpj = cnpj ?? ((o?.cnpj as string) || null);
      }
      const open = await openOrdersOf(supplierId, cnpj);
      const refs = orderRefs(text);
      const found = new Map<string, Set<string>>();
      for (const o of open) for (const it of o.items) if (poLeft(it) > 0 && itemInText(text, it)) found.set(o.id, (found.get(o.id) ?? new Set()).add(it.key));
      orders = open
        .filter((o) => o.id !== orderId && (refs.includes(o.number) || found.has(o.id)))
        .map((o) => ({ id: o.id, number: o.number, why: refs.includes(o.number) ? 'o DANFE cita este pedido' : `o DANFE traz ${[...found.get(o.id)!].map((k) => o.items.find((i) => i.key === k)?.name).filter(Boolean).join(', ')}` }));
      // só aponta o que falta quando o texto dos itens foi lido (achou pelo menos um item)
      if (found.size) {
        const mine = open.filter((o) => o.id === orderId || orders.some((x) => x.id === o.id));
        missing = mine.flatMap((o) => o.items.filter((i) => poLeft(i) > 0 && !found.get(o.id)?.has(i.key)).map((i) => `${o.id}|${i.key}`));
      }
    }
    return NextResponse.json({
      orders,
      missing,
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
