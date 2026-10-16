import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { UUID_RE, loadItems, str } from '@/lib/almoxarifado/stockData';
import { financeNotes, notesAccess } from '@/lib/pedidos/access';
import { missingP3, p3Fail } from '@/lib/pedidos/server';
import { validAccessKey } from '@/lib/notas/nfe';
import { ensureSupplier, hasPC, noteCols, toNote, type NoteLine } from '@/lib/notas/server';
import { cleanAttachments, toPO } from '@/lib/compras/pcServer';
import { PO_OPEN, poLabel, type PurchaseOrder } from '@/lib/compras/pc';
import { installmentsGap, keyInfo, suggestInstallments, type Installment } from '@/lib/notas/conferencia';
import { recompute } from '@/lib/notas/flow';
import { syncRequests } from '@/lib/compras/poServer';

export const dynamic = 'force-dynamic';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const money = (v: unknown) => {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return null;
  // "1.234,56" (digitado) ou 1234.56 (do XML)
  const n = typeof v === 'number' ? v : String(v).includes(',') ? Number(String(v).replace(/\./g, '').replace(',', '.')) : Number(v);
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? Math.round(n * 100) / 100 : null;
};
/** custo unitário guarda 4 casas (o XML traz assim) */
const cost4 = (v: unknown) => (typeof v === 'number' ? (Number.isFinite(v) && v >= 0 && v < 1e9 ? Math.round(v * 10000) / 10000 : null) : money(v));

/** Notas fiscais (Almoxarifado: lança; Financeiro: consulta). */
export async function GET() {
  try {
    const user = await requireUser();
    if (!financeNotes(user)) throw new AccessError(403, 'Você não tem acesso às notas fiscais.');
    const { data, error } = await db().from('fiscal_notes').select(await noteCols()).order('created_at', { ascending: false }).limit(500);
    if (error) {
      if (missingP3(error)) return p3Fail();
      throw error;
    }
    return NextResponse.json({ notes: (data ?? []).map((r) => toNote(r as unknown as Record<string, unknown>)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}

/** Registra a nota (do XML ou digitada). A entrada no estoque vem depois, na conferência. */
export async function POST(req: Request) {
  const b = await readJson<Record<string, unknown>>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!notesAccess(user, 'edit')) throw new AccessError(403, 'Só quem lança notas no Almoxarifado pode registrar.');
    const number = str(b.number, 20)?.replace(/^0+(?=\d)/, '');
    if (!number) return fail('Informe o número da nota.');
    const supplierName = str(b.supplier_name, 160);
    if (!supplierName) return fail('Informe o fornecedor.');
    const cnpj = str(b.cnpj, 20)?.replace(/\D/g, '') || null;
    if (cnpj && cnpj.length !== 14 && cnpj.length !== 11) return fail('CNPJ/CPF do fornecedor inválido.');
    const key = str(b.access_key, 60)?.replace(/\D/g, '') || null;
    if (key && !validAccessKey(key)) return fail('Chave de acesso inválida (44 dígitos, confira o número).');
    // a chave traz CNPJ, série e número: se não bater com o digitado, algo foi lido errado
    if (key) {
      const ki = keyInfo(key)!;
      const ser = str(b.series, 5)?.replace(/^0+(?=\d)/, '') ?? null;
      if (cnpj && ki.cnpj !== cnpj) return fail(`A chave é de outro CNPJ (${ki.cnpj}). Confira o fornecedor ou a chave.`);
      if (ki.number !== number || (ser && ki.series !== ser)) return fail(`A chave é da nota ${ki.number}, série ${ki.series}. Confira o número e a série.`);
    }
    const issue = typeof b.issue_date === 'string' && DATE_RE.test(b.issue_date) ? b.issue_date : null;
    if (!Array.isArray(b.items) || !b.items.length) return fail('A nota precisa ter itens.');
    if (b.items.length > 300) return fail('Nota com itens demais (máximo 300).');
    const stock = new Set((await loadItems()).map((i) => i.id));
    const items: NoteLine[] = [];
    for (const [n, x] of (b.items as Record<string, unknown>[]).entries()) {
      const qty = Number(x?.qty);
      if (!Number.isInteger(qty) || qty <= 0 || qty > 1_000_000) return fail(`Linha ${n + 1}: a quantidade precisa ser um número inteiro (se o fornecedor vende em caixas, informe as unidades).`);
      const total = money(x?.total) ?? 0;
      const discount = money(x?.discount) ?? 0;
      const extra = (money(x?.freight) ?? 0) + (money(x?.insurance) ?? 0) + (money(x?.other) ?? 0) + (money(x?.ipi) ?? 0);
      const cost = cost4(x?.unit_cost) ?? Math.round(((total - discount + extra) / qty) * 10000) / 10000;
      const item_id = typeof x?.item_id === 'string' && UUID_RE.test(x.item_id) && stock.has(x.item_id) ? x.item_id : null;
      const factor = Number(x?.factor) > 0 && Number(x?.factor) <= 100000 ? Math.round(Number(x?.factor) * 10000) / 10000 : 1;
      items.push({
        code: str(x?.code, 60) ?? '',
        description: str(x?.description, 200) ?? `Item ${n + 1}`,
        ncm: str(x?.ncm, 10),
        unit: str(x?.unit, 10) ?? 'UN',
        qty,
        unit_value: money(x?.unit_value) ?? 0,
        total,
        discount,
        freight: money(x?.freight) ?? 0,
        insurance: money(x?.insurance) ?? 0,
        other: money(x?.other) ?? 0,
        ipi: money(x?.ipi) ?? 0,
        unit_cost: cost,
        item_id,
        received: 0,
        factor,
        po_key: typeof x?.po_key === 'string' ? x.po_key.slice(0, 20) : null,
      });
    }
    const t = (b.totals ?? {}) as Record<string, unknown>;
    const sum = items.reduce((s, i) => s + i.total, 0);
    const totals = {
      products: money(t.products) ?? sum,
      discount: money(t.discount) ?? items.reduce((s, i) => s + (i.discount ?? 0), 0),
      freight: money(t.freight) ?? 0,
      insurance: money(t.insurance) ?? 0,
      other: money(t.other) ?? 0,
      ipi: money(t.ipi) ?? 0,
      taxes: money(t.taxes) ?? 0,
      total: money(t.total) ?? sum,
    };
    let installments: Installment[] = (Array.isArray(b.installments) ? (b.installments as Record<string, unknown>[]) : [])
      .slice(0, 48)
      .map((x, i) => ({ n: str(x?.n, 10) ?? String(i + 1).padStart(3, '0'), due: typeof x?.due === 'string' && DATE_RE.test(x.due) ? x.due : null, value: money(x?.value) ?? 0, obs: str(x?.obs, 120), method: str(x?.method, 40), ref: str(x?.ref, 80) }));
    const prId = typeof b.purchase_request_id === 'string' && UUID_RE.test(b.purchase_request_id) ? b.purchase_request_id : null;
    const pc = await hasPC();
    // pedido de compra que esta nota atende (só pedido aprovado)
    let po: PurchaseOrder | null = null;
    if (pc && typeof b.purchase_order_id === 'string' && UUID_RE.test(b.purchase_order_id)) {
      const { data: o } = await db().from('purchase_orders').select('*').eq('id', b.purchase_order_id).maybeSingle();
      if (!o) return fail('Pedido de compra não encontrado.', 404);
      po = toPO(o as Record<string, unknown>);
      if (!PO_OPEN.includes(po.status) && !(po.status === 'aguardando_aprovacao' && po.approval)) return fail(`O ${poLabel(po.number)} está "${po.status.replace('_', ' ')}" e não recebe notas.`, 409);
    }
    // sem parcelas na nota: sugere pela condição do pedido (a pessoa confere e valida)
    if (!installments.length && po) installments = suggestInstallments(totals.total, po.payment);
    // parcelas do XML (dado autorizado pela SEFAZ) que fecham com o total já valem; digitadas
    // ou do DANFE precisam da confirmação de quem registra (validate_installments)
    const fromXml = typeof b.xml === 'string' && Array.isArray(b.installments) && (b.installments as unknown[]).length > 0;
    const validate = (b.validate_installments === true || fromXml) && installments.length > 0 && installmentsGap(installments, totals.total) === 0;
    const supplier_id = await ensureSupplier(supplierName, cnpj);
    const { data, error } = await db()
      .from('fiscal_notes')
      .insert({
        number,
        series: str(b.series, 5),
        access_key: key,
        supplier_id,
        supplier_name: supplierName,
        cnpj,
        company: str(b.company, 160),
        company_cnpj: str(b.company_cnpj, 20)?.replace(/\D/g, '') || null,
        issue_date: issue,
        status: 'aberta',
        items,
        totals,
        installments,
        payment: str(b.payment, 60),
        purchase_request_id: prId,
        ...(pc ? { purchase_order_id: po?.id ?? null, attachments: cleanAttachments(b.attachments), installments_status: validate ? 'validada' : 'incompleta', divergences: [] } : {}),
        xml: typeof b.xml === 'string' && b.xml.length < 2_000_000 && b.xml.includes('infNFe') ? b.xml : null,
        note: str(b.note, 300),
        created_by: user.display_name,
        history: [{ at: new Date().toISOString(), by: user.display_name, what: `${typeof b.xml === 'string' ? 'Nota registrada pelo XML' : key ? 'Nota registrada pelo DANFE' : 'Nota registrada (digitada)'}${po ? ` para o ${poLabel(po.number)}` : ''}. Ainda sem entrada no estoque.` }],
      })
      .select(await noteCols())
      .single();
    if (error) {
      if (error.code === '23505') return fail('Esta nota fiscal já foi registrada (mesma chave ou mesmo número, série e fornecedor).', 409);
      if (missingP3(error)) return p3Fail();
      throw error;
    }
    let note = toNote(data as unknown as Record<string, unknown>);
    if (pc) {
      // compara com o pedido e já aponta as divergências
      const r = await recompute(note, po);
      const { data: d2 } = await db().from('fiscal_notes').update({ items: r.items, divergences: r.divergences, status: r.status }).eq('id', note.id).select(await noteCols()).single();
      if (d2) note = toNote(d2 as unknown as Record<string, unknown>);
      if (po) await syncRequests(po.request_ids, user.display_name);
    }
    await broadcast('note:update', { id: note.id, by: user.display_name });
    return NextResponse.json({ note });
  } catch (e) {
    return serverError(e);
  }
}
