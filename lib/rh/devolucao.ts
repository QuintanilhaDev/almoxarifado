/**
 * Desligamento de colaborador e devolução do que ele recebeu (fardamento e equipamentos).
 * Tipos e textos usados pela tela e pelo servidor.
 */

export type StatusDevolucao = 'pendente' | 'devolvido' | 'nao_devolvido';
export const STATUS_DEV: Record<StatusDevolucao, string> = { pendente: 'Pendente', devolvido: 'Devolvido', nao_devolvido: 'Não devolvido' };
export const STATUS_LIST: StatusDevolucao[] = ['pendente', 'devolvido', 'nao_devolvido'];

export type OrigemItem = 'sistema' | 'planilha' | 'manual';
export const ORIGEM: Record<OrigemItem, string> = { sistema: 'entrega registrada no sistema', planilha: 'planilha de controle de fardamento', manual: 'incluído na conferência' };

export const MOTIVOS = ['Pedido de demissão', 'Dispensa sem justa causa', 'Dispensa por justa causa', 'Término de contrato', 'Fim do contrato com o cliente', 'Acordo', 'Outro'];

/** item entregue ao colaborador, sugerido para a conferência da devolução */
export interface ItemEntregue {
  key: string;
  source: OrigemItem;
  item_name: string;
  size: string | null;
  qty: number;
  last: string | null;
  datas: string[];
  posto: string | null;
}

export interface Devolucao {
  id: string;
  collaborator_id: string;
  source: OrigemItem;
  item_name: string;
  size: string | null;
  qty_delivered: number;
  last_delivered_at: string | null;
  qty_returned: number;
  status: StatusDevolucao;
  returned_at: string | null;
  notes: string | null;
  history: { at: string; by: string; what: string }[];
  updated_by: string | null;
  updated_at: string;
}
export const DEV_COLS = 'id, collaborator_id, source, item_name, size, qty_delivered, last_delivered_at, qty_returned, status, returned_at, notes, history, updated_by, updated_at';

export interface Desligado {
  id: string;
  name: string;
  matricula: string | null;
  role: string | null;
  company: string | null;
  client: string | null;
  posto_name: string | null;
  dismissed_at: string | null;
  dismissal_reason: string | null;
  dismissed_by: string | null;
  itens: Devolucao[];
  pendentes: number;
}

/** marca, no histórico, a conferência de um desligamento anterior (a pessoa foi reativada depois) */
export const ARQUIVADO = 'Arquivado';
export const arquivada = (d: { history?: { what?: string }[] | null }) => (d.history ?? []).some((h) => String(h?.what ?? '').startsWith(ARQUIVADO));

/** cliente: o cadastrado; sem ele, o nome do posto antes do " - " (ex.: "ADIB - ILHA" → "ADIB") */
export function clienteDe(c: { client?: string | null; posto_name?: string | null }): string {
  const cl = (c.client ?? '').trim();
  if (cl) return cl;
  const p = (c.posto_name ?? '').trim();
  return p ? p.split(/\s+-\s+/)[0].trim() : '';
}
