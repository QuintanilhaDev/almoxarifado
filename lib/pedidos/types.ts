/** Pedidos de material: Operação (via Uesley), RH/DP (admissão, troca anual, extraordinária). */
export type OrderOrigin = 'operacao' | 'rh_admissao' | 'rh_troca' | 'rh_extra' | 'almoxarifado';
export type OrderStage = 'solicitado' | 'validacao' | 'encaminhado' | 'concluido' | 'cancelado';
export type Priority = 'normal' | 'urgente';

export interface OrderItem {
  item_id: string | null;
  name: string;
  size: string | null;
  unit: string;
  qty: number;
  reserved: number;
  delivered: number;
  purchase_id?: string | null;
  purchase_number?: number | null;
  note?: string | null;
  /** veio do formulário do supervisor e não foi reconhecido com certeza */
  check?: boolean;
}

export interface OrderEvent {
  at: string;
  by: string;
  what: string;
  term?: string;
}

export interface MaterialOrder {
  id: string;
  number: number;
  origin: OrderOrigin;
  stage: OrderStage;
  priority: Priority;
  needed_by: string | null;
  company: string | null;
  posto_id: string | null;
  posto_name: string | null;
  collaborator_id: string | null;
  collaborator_name: string | null;
  matricula: string | null;
  role: string | null;
  start_date: string | null;
  reason: string | null;
  requester: string;
  supervisor: string | null;
  source_request_id: string | null;
  items: OrderItem[];
  flags: string[];
  history: OrderEvent[];
  forwarded_by: string | null;
  forwarded_at: string | null;
  validated_by: string | null;
  validated_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const ORIGIN_LABEL: Record<OrderOrigin, string> = {
  operacao: 'Operação',
  rh_admissao: 'RH/DP · Admissão',
  rh_troca: 'RH/DP · Troca anual',
  rh_extra: 'RH/DP · Troca extraordinária',
  almoxarifado: 'Almoxarifado',
};
export const isRhOrigin = (o: OrderOrigin) => o === 'rh_admissao' || o === 'rh_troca' || o === 'rh_extra';

/** Status do Projeto 3 (seção 6), por item e consolidado. */
export type OrderStatus =
  | 'solicitado'
  | 'validacao'
  | 'encaminhado'
  | 'em_analise'
  | 'disponivel'
  | 'parcial'
  | 'aguardando_compra'
  | 'compra_solicitada'
  | 'comprado'
  | 'entregue'
  | 'cancelado';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  solicitado: 'Solicitado',
  validacao: 'Aguardando validação da Operação',
  encaminhado: 'Encaminhado ao Almoxarifado',
  em_analise: 'Em análise',
  disponivel: 'Disponível para separação',
  parcial: 'Parcialmente atendido',
  aguardando_compra: 'Aguardando compra',
  compra_solicitada: 'Compra solicitada',
  comprado: 'Comprado · aguardando recebimento',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};
export const STATUS_TONE: Record<OrderStatus, string> = {
  solicitado: 'gray',
  validacao: 'amber',
  encaminhado: 'lilac',
  em_analise: 'lilac',
  disponivel: 'blue',
  parcial: 'amber',
  aguardando_compra: 'red',
  compra_solicitada: 'amber',
  comprado: 'blue',
  entregue: 'green',
  cancelado: 'gray',
};

/** o que se sabe da compra ligada a um item (status da solicitação de compra) */
export type PurchaseInfo = { status: 'nova' | 'em_cotacao' | 'comprada' | 'entregue' | 'recusada' | 'cancelada' };

/**
 * Status de UMA linha do pedido.
 * `free` = quanto há disponível no estoque agora (saldo − reservas), quando se sabe.
 */
export function itemStatus(line: OrderItem, purchase?: PurchaseInfo | null, free?: number | null): OrderStatus {
  const need = line.qty - line.delivered;
  if (need <= 0) return 'entregue';
  if (line.reserved >= need) return 'disponivel';
  if (purchase && purchase.status !== 'recusada' && purchase.status !== 'cancelada' && purchase.status !== 'entregue') {
    return purchase.status === 'comprada' ? 'comprado' : 'compra_solicitada';
  }
  if (line.delivered > 0) return 'parcial';
  if (free !== undefined && free !== null && free < need - line.reserved) return 'aguardando_compra';
  return 'em_analise';
}

/** Status consolidado: a etapa do fluxo e, no Almoxarifado, o item mais atrasado manda. */
export function orderStatus(o: MaterialOrder, purchases?: Map<string, PurchaseInfo>, freeOf?: (itemId: string) => number | null): OrderStatus {
  if (o.stage === 'cancelado') return 'cancelado';
  if (o.stage === 'concluido') return 'entregue';
  if (o.stage === 'solicitado') return 'solicitado';
  if (o.stage === 'validacao') return 'validacao';
  const st = o.items.map((l) => itemStatus(l, l.purchase_id ? purchases?.get(l.purchase_id) ?? null : null, l.item_id && freeOf ? freeOf(l.item_id) : null));
  if (st.every((s) => s === 'entregue')) return 'entregue';
  const anyDelivered = o.items.some((l) => l.delivered > 0);
  const anyMoved = o.items.some((l) => l.delivered > 0 || l.reserved > 0);
  for (const s of ['aguardando_compra', 'compra_solicitada', 'comprado'] as OrderStatus[]) if (st.includes(s)) return anyDelivered && s === 'aguardando_compra' ? 'parcial' : s;
  if (anyDelivered) return 'parcial';
  if (st.every((s) => s === 'disponivel' || s === 'entregue')) return 'disponivel';
  return anyMoved ? 'em_analise' : 'encaminhado';
}

/** hoje no horário de Salvador (AAAA-MM-DD) */
export const todayBahia = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

/** Atrasado: passou da data necessária (ou da data de início, na admissão) e não foi entregue. */
export function isLate(o: MaterialOrder): boolean {
  if (o.stage === 'concluido' || o.stage === 'cancelado') return false;
  const due = o.needed_by ?? o.start_date;
  return Boolean(due && due < todayBahia());
}
/** Admissão em risco: começa em até 3 dias e ainda falta separar/entregar. */
export function atRisk(o: MaterialOrder): boolean {
  if (o.stage === 'concluido' || o.stage === 'cancelado' || isLate(o)) return false;
  const due = o.start_date ?? o.needed_by;
  if (!due) return false;
  const days = (Date.parse(due + 'T12:00:00-03:00') - Date.now()) / 86_400_000;
  return days <= 3 && o.items.some((l) => l.reserved + l.delivered < l.qty);
}

export const orderLabel = (n: number) => '#' + String(n).padStart(4, '0');
export const lineLabel = (l: { name: string; size: string | null }) => l.name + (l.size ? ` ${l.size}` : '');
export const LIMITS = { items: 40, qty: 10_000, text: 600 } as const;
