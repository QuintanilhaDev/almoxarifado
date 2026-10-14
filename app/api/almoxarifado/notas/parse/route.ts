import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, serverError } from '@/lib/http';
import { loadItems } from '@/lib/almoxarifado/stockData';
import { readUpload } from '@/lib/almoxarifado/upload';
import { notesAccess } from '@/lib/pedidos/access';
import { missingP3, p3Fail } from '@/lib/pedidos/server';
import { NfeError, parseNfe, validAccessKey } from '@/lib/notas/nfe';
import { learnedFor, suggestItem } from '@/lib/notas/server';
import { bestMatches } from '@/lib/max/text';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Lê o XML da NF-e e já devolve tudo preenchido: fornecedor, itens ligados ao estoque
 * (pelo que o fornecedor já mandou antes ou pelo nome), parcelas, aviso de nota repetida
 * e a solicitação de compra que esta nota provavelmente atende. Nada é gravado aqui.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!notesAccess(user, 'edit')) throw new AccessError(403, 'Só quem lança notas no Almoxarifado pode importar o XML.');
    const up = await readUpload(req);
    if ('error' in up) return up.error;
    let nfe;
    try {
      nfe = parseNfe(up.buf.toString('utf8'));
    } catch (e) {
      if (e instanceof NfeError) return fail(e.message, 422);
      throw e;
    }
    if (nfe.access_key && !validAccessKey(nfe.access_key)) return fail('A chave de acesso desta nota é inválida (dígito verificador não confere).', 422);
    // nota repetida?
    let dup = null;
    {
      const q = nfe.access_key
        ? db().from('fiscal_notes').select('id, number, status, created_at').eq('access_key', nfe.access_key).neq('status', 'estornada')
        : db().from('fiscal_notes').select('id, number, status, created_at').eq('number', nfe.number).eq('cnpj', nfe.supplier.cnpj ?? '').neq('status', 'estornada');
      const { data, error } = await q.limit(1);
      if (error) {
        if (missingP3(error)) return p3Fail();
        throw error;
      }
      dup = data?.[0] ?? null;
    }
    const items = await loadItems();
    const { supplierId, map } = await learnedFor(nfe.supplier.cnpj);
    const lines = nfe.items.map((it) => {
      const s = suggestItem(it, items, map);
      return { ...it, item_id: s.item_id, via: s.via, options: s.options, received: 0 };
    });
    // solicitação de compra que esta nota atende (mesmos itens, ainda não entregue)
    const { data: prs } = await db().from('purchase_requests').select('id, number, status, items, supplier').in('status', ['em_cotacao', 'comprada', 'nova']).order('created_at', { ascending: false }).limit(100);
    const linked = new Set(lines.map((l) => l.item_id).filter(Boolean));
    const purchases = (prs ?? [])
      .map((p) => {
        const pi = (p.items as { item_id: string | null; name: string }[]) ?? [];
        const same = pi.filter((x) => (x.item_id && linked.has(x.item_id)) || lines.some((l) => bestMatches(l.description, [x], (y) => y.name, 0.7, 1).length)).length;
        return { id: p.id as string, number: Number(p.number), status: p.status as string, supplier: (p.supplier as string) ?? null, match: pi.length ? same / pi.length : 0, items: pi.length };
      })
      .filter((p) => p.match > 0)
      .sort((a, b) => b.match - a.match || (b.status === 'comprada' ? 1 : 0) - (a.status === 'comprada' ? 1 : 0))
      .slice(0, 5);
    return NextResponse.json({ nfe: { ...nfe, items: lines }, supplier_id: supplierId, duplicate: dup, purchases, xml: up.buf.toString('utf8').slice(0, 2_000_000) });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
