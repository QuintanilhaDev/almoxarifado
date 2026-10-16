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
import { hasPC, type NoteLine } from '@/lib/notas/server';
import { loadConfig } from '@/lib/compras/pcServer';
import { poLabel, poLeft, type PurchaseOrder } from '@/lib/compras/pc';
import { openOrdersOf } from '@/lib/notas/flow';
import { allocate, orderRefs, suggestFromOrders, xpedNumbers } from '@/lib/notas/vinculo';
import { aiMatch } from '@/lib/notas/vinculoIA';

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
      return { ...it, item_id: s.item_id, via: s.via as 'fornecedor' | 'nome' | 'pedido' | null, options: s.options as { id: string; label: string; score: number; from?: 'pedido' | 'ia' }[], received: 0, factor: s.factor ?? 1 };
    });
    // solicitação de compra que esta nota atende (mesmos itens, ainda não entregue)
    const { data: prs } = await db().from('purchase_requests').select('id, number, status, items, supplier').in('status', ['em_cotacao', 'comprada', 'nova']).order('created_at', { ascending: false }).limit(100);
    // para achar a compra/pedido, vale também a sugestão forte pelo nome (ligar, só com confirmação)
    const linked = new Set(lines.map((l) => l.item_id ?? (l.options[0] && l.options[0].score >= 0.9 ? l.options[0].id : null)).filter(Boolean));
    const purchases = (prs ?? [])
      .map((p) => {
        const pi = (p.items as { item_id: string | null; name: string }[]) ?? [];
        const same = pi.filter((x) => (x.item_id && linked.has(x.item_id)) || lines.some((l) => bestMatches(l.description, [x], (y) => y.name, 0.7, 1).length)).length;
        return { id: p.id as string, number: Number(p.number), status: p.status as string, supplier: (p.supplier as string) ?? null, match: pi.length ? same / pi.length : 0, items: pi.length };
      })
      .filter((p) => p.match > 0)
      .sort((a, b) => b.match - a.match || (b.status === 'comprada' ? 1 : 0) - (a.status === 'comprada' ? 1 : 0))
      .slice(0, 5);
    // pedidos de compra em aberto deste fornecedor: a nota pode atender VÁRIOS (cada linha o seu)
    let orders: { id: string; number: number; status: string; supplier: string; match: number; left: number; due: string | null }[] = [];
    let open: PurchaseOrder[] = [];
    let refs: number[] = [];
    let preview: { i: number; parts: { po_id: string; po: string; po_key: string; qty: number; why: string | null }[] }[] = [];
    let ai = 0;
    if (await hasPC()) {
      open = await openOrdersOf(supplierId, nfe.supplier.cnpj);
      refs = [...new Set([...orderRefs(nfe.info), ...xpedNumbers(nfe.order_text)])];
      const cfg = await loadConfig();
      if (open.length) {
        // sem item do estoque: o pedido aberto diz qual deve ser (sugestão no topo, para confirmar)
        for (const l of lines) {
          const sug = suggestFromOrders(l as unknown as NoteLine, open, cfg.price_tolerance);
          if (!sug) continue;
          l.options = [{ id: sug.item_id, label: `${sug.label} — ${sug.why}`, score: sug.score, from: 'pedido' as const }, ...l.options.filter((o) => o.id !== sug.item_id)].slice(0, 6);
        }
        // o que nem assim se resolveu: a IA lê a descrição do fornecedor (também só sugere)
        const hard = lines.map((l, i) => ({ l, i })).filter(({ l }) => !l.item_id && !(l.options[0] && l.options[0].score >= 0.55));
        if (hard.length) {
          const hits = await aiMatch(hard.map(({ l, i }) => ({ i, description: l.description, code: l.code, qty: l.qty, unit: l.unit, unit_value: l.unit_value })), open);
          for (const [i, h] of hits) {
            const l = lines[i];
            const po = open.find((o) => o.id === h.po_id)!;
            l.options = [{ id: h.item_id, label: `${h.label} — está no ${poLabel(po.number)} (sugerido pela IA)`, score: h.confidence, from: 'ia' as const }, ...l.options.filter((o) => o.id !== h.item_id)].slice(0, 6);
            ai++;
          }
        }
        // prévia: como as linhas ficam ligadas aos pedidos (a tela refaz ao trocar um item)
        const alloc = allocate(lines.map((l, i) => ({ ...(l as unknown as NoteLine), src: i })), open, refs, cfg.price_tolerance);
        // o pedido disse qual é o item (código do fornecedor no pedido, ou pedido e linha citados
        // pelo fornecedor com o nome conferindo): já vem ligado, marcado "pelo pedido"
        for (const x of alloc) {
          const l = lines[x.src ?? -1];
          if (l && !l.item_id && x.via === 'pedido' && x.item_id) Object.assign(l, { item_id: x.item_id, via: 'pedido' });
        }
        preview = lines.map((_, i) => ({
          i,
          parts: alloc.filter((x) => x.src === i && x.po_id).map((x) => ({ po_id: x.po_id!, po: poLabel(open.find((o) => o.id === x.po_id)!.number), po_key: x.po_key!, qty: x.qty, why: x.po_why ?? null })),
        }));
      }
      orders = open
        .map((o) => {
          const its = o.items.filter((i) => poLeft(i) > 0);
          const hit = its.filter((i) => (i.item_id && linked.has(i.item_id)) || preview.some((p) => p.parts.some((x) => x.po_id === o.id && x.po_key === i.key))).length;
          return { id: o.id, number: o.number, status: o.status, supplier: o.supplier_name, match: its.length ? hit / its.length : 0, left: its.reduce((t, i) => t + poLeft(i), 0), due: o.promised_date ?? o.expected_date };
        })
        .sort((a, b) => b.match - a.match || String(a.due).localeCompare(String(b.due)));
    }
    return NextResponse.json({ nfe: { ...nfe, items: lines }, supplier_id: supplierId, duplicate: dup, purchases, orders, open_orders: open, order_refs: refs, preview, ai, xml: up.buf.toString('utf8').slice(0, 2_000_000) });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
