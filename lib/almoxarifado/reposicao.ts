import 'server-only';
import { db } from '../supabaseAdmin';
import type { StockItem } from './types';
import { fetchAll, loadItems } from './stockData';
import type { OrderItem } from '../pedidos/types';

/** saídas do almoxarifado central que contam como consumo */
const OUT = new Set(['saida', 'transferencia', 'entrega', 'perda']);
/** voltas ao estoque que descontam o consumo */
const BACK = new Set(['devolucao', 'devolucao_colaborador']);

export interface Replenish {
  item_id: string;
  code: string | null;
  name: string;
  size: string | null;
  unit: string;
  quantity: number;
  reserved: number;
  available: number;
  min: number;
  max: number | null;
  /** consumo no período e por dia */
  consumed: number;
  daily: number;
  lead_days: number;
  safety: number;
  /** ponto de reposição = consumo diário × prazo + segurança */
  point: number;
  /** compras abertas (nova, em cotação, comprada) */
  in_transit: number;
  /** pedidos de material ainda sem reserva nem compra */
  demand: number;
  /** disponível + em trânsito − demanda */
  position: number;
  /** quanto pedir agora */
  suggest: number;
  /** dias de cobertura do disponível (null = sem consumo) */
  cover_days: number | null;
  last_move: string | null;
  urgent: boolean;
}

export interface ReplenishResult {
  days: number;
  defaultLead: number;
  rows: Replenish[];
  /** itens sem nenhuma movimentação no período */
  idle: { item_id: string; name: string; size: string | null; quantity: number; value: number | null; last_move: string | null }[];
}

/**
 * Sugestão de reposição (Projeto 3, seção 7).
 * Não pede nada sozinha: a tela mostra e a pessoa confirma o pedido de compra.
 */
export async function replenishment(opts: { days: number; defaultLead: number; items?: StockItem[] }): Promise<ReplenishResult> {
  const items = (opts.items ?? (await loadItems())).filter((i) => i.active !== false);
  const since = new Date(Date.now() - opts.days * 86_400_000).toISOString();
  const moves = await fetchAll<{ item_id: string | null; kind: string; quantity: number; before_qty: number | null; after_qty: number | null; created_at: string }>(
    'stock_movements',
    'item_id, kind, quantity, before_qty, after_qty, created_at',
    { column: 'created_at', tiebreak: 'id' },
    (q) => q.gte('created_at', since),
  );
  const consumed = new Map<string, number>();
  const last = new Map<string, string>();
  for (const m of moves) {
    if (!m.item_id) continue;
    if (m.kind !== 'criacao' && m.created_at > (last.get(m.item_id) ?? '')) last.set(m.item_id, m.created_at);
    const q = Number(m.quantity) || 0;
    if (OUT.has(m.kind)) consumed.set(m.item_id, (consumed.get(m.item_id) ?? 0) + q);
    // devolução avariada não volta ao saldo: não desconta o consumo
    else if (BACK.has(m.kind) && !(m.kind === 'devolucao_colaborador' && Number(m.after_qty) <= Number(m.before_qty))) consumed.set(m.item_id, (consumed.get(m.item_id) ?? 0) - q);
  }

  const transit = new Map<string, number>();
  const { data: ps } = await db().from('purchase_requests').select('items, status').in('status', ['nova', 'em_cotacao', 'comprada']).limit(1000);
  for (const p of ps ?? []) {
    for (const it of (p.items as { item_id: string | null; quantity: number }[]) ?? []) {
      if (it.item_id) transit.set(it.item_id, (transit.get(it.item_id) ?? 0) + (Number(it.quantity) || 0));
    }
  }
  const demand = new Map<string, number>();
  const { data: os } = await db().from('material_orders').select('items').eq('stage', 'encaminhado').limit(1000);
  for (const o of os ?? []) {
    for (const l of (o.items as OrderItem[]) ?? []) {
      if (!l.item_id || l.purchase_id) continue;
      const need = Math.max(0, Number(l.qty) - Number(l.delivered || 0) - Number(l.reserved || 0));
      if (need) demand.set(l.item_id, (demand.get(l.item_id) ?? 0) + need);
    }
  }

  const rows: Replenish[] = [];
  const idle: ReplenishResult['idle'] = [];
  for (const i of items) {
    const used = Math.max(0, consumed.get(i.id) ?? 0);
    const daily = used / opts.days;
    const lead = i.lead_days ?? opts.defaultLead;
    const safety = i.safety_qty ?? i.min_quantity;
    const point = Math.ceil(daily * lead) + safety;
    const available = i.quantity - i.reserved;
    const inTransit = transit.get(i.id) ?? 0;
    const dem = demand.get(i.id) ?? 0;
    const position = available + inTransit - dem;
    // alvo: o máximo cadastrado; sem máximo, o ponto + 30 dias de consumo (ou o dobro do mínimo)
    const target = i.max_quantity ?? Math.max(point + Math.ceil(daily * 30), i.min_quantity * 2, point + 1);
    const needs = (point > 0 || dem > 0) && position <= point;
    const suggest = needs ? Math.max(0, target - position) : 0;
    if (!last.has(i.id) && i.quantity > 0) idle.push({ item_id: i.id, name: i.name, size: i.size, quantity: i.quantity, value: i.cost === null ? null : i.cost * i.quantity, last_move: null });
    if (!suggest) continue;
    rows.push({
      item_id: i.id,
      code: i.code ?? null,
      name: i.name,
      size: i.size,
      unit: i.unit,
      quantity: i.quantity,
      reserved: i.reserved,
      available,
      min: i.min_quantity,
      max: i.max_quantity ?? null,
      consumed: used,
      daily: Math.round(daily * 100) / 100,
      lead_days: lead,
      safety,
      point,
      in_transit: inTransit,
      demand: dem,
      position,
      suggest,
      cover_days: daily > 0 ? Math.floor(Math.max(0, available) / daily) : null,
      last_move: last.get(i.id) ?? null,
      urgent: available - dem <= 0 || (i.min_quantity > 0 && available < i.min_quantity),
    });
  }
  rows.sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.cover_days ?? 1e9) - (b.cover_days ?? 1e9) || a.name.localeCompare(b.name, 'pt-BR'));
  idle.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return { days: opts.days, defaultLead: opts.defaultLead, rows, idle };
}
