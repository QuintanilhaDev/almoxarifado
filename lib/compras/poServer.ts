import 'server-only';
import { db } from '../supabaseAdmin';
import { str, UUID_RE } from '../almoxarifado/stockData';
import { toRequest } from './server';
import { intOr, money, dateOrNull, nowIso, toPO } from './pcServer';
import { PO_OPEN, poLabel, type POItem, type PurchaseOrder, type Payment, type Delivery } from './pc';

/** limpa as linhas do pedido que vieram da tela; mantém o que já foi recebido */
export function cleanItems(raw: unknown, prev: POItem[] = []): POItem[] | string {
  if (!Array.isArray(raw) || !raw.length) return 'O pedido precisa ter itens.';
  if (raw.length > 60) return 'No máximo 60 itens por pedido.';
  const out: POItem[] = [];
  const keys = new Set<string>();
  for (const [n, x] of (raw as Record<string, unknown>[]).entries()) {
    const name = str(x?.name, 160);
    if (!name) return `Item ${n + 1}: falta o nome.`;
    const qty = intOr(x?.qty);
    if (qty === null || qty < 1 || qty > 1_000_000) return `${name}: a quantidade precisa ser um número inteiro maior que zero.`;
    const price = money(x?.unit_price);
    if (price === null || price <= 0) return `${name}: informe o preço unitário.`;
    let key = typeof x?.key === 'string' && /^[\w-]{1,20}$/.test(x.key) ? x.key : '';
    if (!key || keys.has(key)) {
      let k = out.length + 1;
      while (keys.has(`p${k}`) || prev.some((p) => p.key === `p${k}`)) k++;
      key = `p${k}`;
    }
    keys.add(key);
    const before = prev.find((p) => p.key === key);
    const received = before?.received ?? 0;
    if (qty < received) return `${name}: já foram recebidas ${received} unidades; a quantidade não pode ficar menor.`;
    out.push({
      key,
      item_id: typeof x?.item_id === 'string' && UUID_RE.test(x.item_id) ? x.item_id : null,
      name,
      size: str(x?.size, 40),
      unit: str(x?.unit, 20) ?? 'Cada',
      qty,
      unit_price: price,
      first_price: before?.first_price ?? (money(x?.first_price) ?? null),
      ext_code: str(x?.ext_code, 60),
      brand: str(x?.brand, 60),
      spec: str(x?.spec, 200),
      received,
      requests: before?.requests ?? (Array.isArray(x?.requests) ? (x.requests as POItem['requests']).filter((r) => r && UUID_RE.test(String(r.id))).slice(0, 20) : []),
    });
  }
  const lost = prev.find((p) => p.received > 0 && !out.some((o) => o.key === p.key));
  if (lost) return `${lost.name} já teve entrega e não pode sair do pedido.`;
  return out;
}

export function cleanPayment(v: unknown): Payment {
  const p = (v ?? {}) as Record<string, unknown>;
  const inst = Math.min(48, Math.max(1, intOr(p.installments, 1) ?? 1));
  return { mode: p.mode === 'parcelado' ? 'parcelado' : 'avista', installments: p.mode === 'parcelado' ? inst : 1, days: str(p.days, 60), note: str(p.note, 200) };
}
export function cleanDelivery(v: unknown, fallbackLocation: string): Delivery {
  const d = (v ?? {}) as Record<string, unknown>;
  const days = d.days === null || d.days === undefined || d.days === '' ? null : intOr(d.days);
  return {
    days: days !== null && days >= 0 && days <= 365 ? days : null,
    business: d.business !== false,
    mode: d.mode === 'producao' ? 'producao' : 'pronta',
    date: dateOrNull(d.date),
    location: str(d.location, 160) ?? fallbackLocation,
  };
}

export async function loadPO(id: string): Promise<PurchaseOrder | null> {
  const { data, error } = await db().from('purchase_orders').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toPO(data as Record<string, unknown>) : null;
}

/**
 * Mantém as solicitações de compra em dia com os pedidos:
 *  - algum pedido aprovado em diante → "Comprada" (com fornecedor, nº e previsão, que o Almoxarifado vê);
 *  - todos os pedidos concluídos → "Entregue" (e volta para "Comprada" se uma nota for estornada);
 *  - todos os pedidos cancelados → volta para "Nova" (ou "Em cotação", se há cotação aberta).
 */
export async function syncRequests(ids: string[], by: string) {
  if (!ids.length) return;
  const { data: rs } = await db().from('purchase_requests').select('*').in('id', ids);
  for (const r of (rs ?? []).map((x) => toRequest(x as Record<string, unknown>))) {
    if (['cancelada', 'recusada'].includes(r.status)) continue;
    const { data: os } = await db().from('purchase_orders').select('*').contains('request_ids', [r.id]);
    const all = (os ?? []).map((x) => toPO(x as Record<string, unknown>));
    const pos = all.filter((o) => o.status !== 'cancelado');
    const live = pos.filter((o) => PO_OPEN.includes(o.status) || o.status === 'concluido');
    if (all.length && !pos.length && r.status === 'comprada') {
      // todos os pedidos cancelados: a solicitação volta para a fila (ou para a cotação aberta)
      const { data: qs } = await db().from('purchase_quotes').select('id').eq('status', 'aberta').contains('request_ids', [r.id]).limit(1);
      const back = qs?.length ? 'em_cotacao' : 'nova';
      const at = nowIso();
      await db()
        .from('purchase_requests')
        .update({ status: back, supplier: null, order_ref: null, expected_date: null, updated_at: at, history: [...r.history, { at, by, status: back, note: `Pedidos de compra cancelados (${all.map((o) => poLabel(o.number)).join(', ')})` }].slice(-60) })
        .eq('id', r.id);
      continue;
    }
    if (!live.length) continue;
    const done = live.every((o) => o.status === 'concluido');
    const next = done ? 'entregue' : 'comprada';
    const supplier = [...new Set(live.map((o) => o.supplier_name))].join(', ');
    const ref = live.map((o) => poLabel(o.number)).join(', ');
    const dates = live.map((o) => o.promised_date ?? o.expected_date).filter(Boolean).sort();
    const at = nowIso();
    const patch: Record<string, unknown> = { supplier, order_ref: ref, expected_date: dates[dates.length - 1] ?? null, updated_at: at };
    if (r.status !== next) {
      patch.status = next;
      // entregue → comprada: uma nota foi estornada e voltou a faltar
      const note = done ? `Recebida pelos pedidos ${ref}` : r.status === 'entregue' ? `Voltou a ter saldo a receber em ${ref} (nota estornada)` : `Pedido de compra ${ref} aprovado`;
      patch.history = [...r.history, { at, by, status: next, note }].slice(-60);
    }
    await db().from('purchase_requests').update(patch).eq('id', r.id);
  }
}

/** depois de uma aprovação nova (pedido que já andou), volta para onde estava */
export function resumeStatus(o: PurchaseOrder): PurchaseOrder['status'] {
  if (o.items.some((i) => i.received > 0)) return o.items.every((i) => i.received >= i.qty) ? 'concluido' : 'parcial';
  if (o.confirmed_at) return 'confirmado';
  if (o.sent_at) return 'enviado';
  return 'aprovado';
}
