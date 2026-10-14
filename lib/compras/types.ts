/** Solicitações de compra: o Almoxarifado pede, o setor de Compras atende. */
export type PurchaseStatus = 'nova' | 'em_cotacao' | 'comprada' | 'entregue' | 'recusada' | 'cancelada';
export type PurchasePriority = 'normal' | 'urgente';

export interface PurchaseItem {
  /** item do estoque (null = item que ainda não existe no estoque) */
  item_id: string | null;
  name: string;
  size: string | null;
  unit: string;
  quantity: number;
  note: string | null;
  /** saldo no almoxarifado e mínimo no momento do pedido */
  stock: number | null;
  min: number | null;
}

export interface PurchaseEvent {
  at: string;
  by: string;
  status: PurchaseStatus;
  note: string | null;
}

export interface PurchaseRequest {
  id: string;
  number: number;
  from_sector: string;
  status: PurchaseStatus;
  priority: PurchasePriority;
  reason: string | null;
  needed_by: string | null;
  items: PurchaseItem[];
  requested_by: string;
  handled_by: string | null;
  response: string | null;
  history: PurchaseEvent[];
  /* Projeto 3 (existem depois do supabase/pedidos_e_notas.sql) */
  supplier?: string | null;
  order_ref?: string | null;
  expected_date?: string | null;
  created_at: string;
  updated_at: string;
}

export const STATUS_LABEL: Record<PurchaseStatus, string> = {
  nova: 'Nova',
  em_cotacao: 'Em cotação',
  comprada: 'Comprada',
  entregue: 'Entregue',
  recusada: 'Recusada',
  cancelada: 'Cancelada',
};
/** frase curta para a voz e para os avisos ("marcou como comprada") */
export const STATUS_SPOKEN: Record<PurchaseStatus, string> = {
  nova: 'nova',
  em_cotacao: 'em cotação',
  comprada: 'comprada',
  entregue: 'entregue',
  recusada: 'recusada',
  cancelada: 'cancelada',
};
export const OPEN_STATUSES: PurchaseStatus[] = ['nova', 'em_cotacao', 'comprada'];
export const CLOSED_STATUSES: PurchaseStatus[] = ['entregue', 'recusada', 'cancelada'];
/** o que Compras pode marcar (cancelar é do Almoxarifado) */
export const COMPRAS_STATUSES: PurchaseStatus[] = ['nova', 'em_cotacao', 'comprada', 'entregue', 'recusada'];
export const isPurchaseStatus = (v: unknown): v is PurchaseStatus => typeof v === 'string' && v in STATUS_LABEL;

export const LIMITS = { items: 40, quantity: 100_000, name: 160, note: 200, reason: 600, response: 600 } as const;

export const purchaseLabel = (n: number) => '#' + String(n).padStart(4, '0');
export const itemsSummary = (items: PurchaseItem[], max = 2) => {
  const parts = items.slice(0, max).map((i) => `${i.name}${i.size ? ' ' + i.size : ''} (${i.quantity})`);
  return parts.join(', ') + (items.length > max ? ` e mais ${items.length - max}` : '');
};
