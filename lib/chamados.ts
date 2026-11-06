/**
 * Chamados para o desenvolvedor: tipos e regras que valem no servidor e na tela.
 * Qualquer pessoa abre e acompanha os próprios chamados; só o desenvolvedor vê todos e responde.
 */
export type TicketKind = 'erro' | 'melhoria' | 'duvida' | 'outro';
export type TicketPriority = 'baixa' | 'normal' | 'alta' | 'urgente';
export type TicketStatus = 'aberto' | 'em_andamento' | 'respondido' | 'resolvido' | 'fechado';

export const KINDS: Record<TicketKind, string> = { erro: 'Erro / algo não funciona', melhoria: 'Melhoria / ideia', duvida: 'Dúvida', outro: 'Outro' };
export const KIND_SHORT: Record<TicketKind, string> = { erro: 'Erro', melhoria: 'Melhoria', duvida: 'Dúvida', outro: 'Outro' };
export const PRIORITIES: Record<TicketPriority, string> = { baixa: 'Baixa', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };
export const STATUSES: Record<TicketStatus, string> = {
  aberto: 'Aberto',
  em_andamento: 'Em andamento',
  respondido: 'Respondido',
  resolvido: 'Resolvido',
  fechado: 'Fechado',
};
export const STATUS_TONE: Record<TicketStatus, string> = { aberto: 'amber', em_andamento: 'blue', respondido: 'lilac', resolvido: 'green', fechado: 'gray' };
export const PRIORITY_TONE: Record<TicketPriority, string> = { baixa: 'gray', normal: 'blue', alta: 'amber', urgente: 'red' };

export interface TicketAttachment {
  path: string;
  name: string;
  size: number;
  type: string;
}
export interface TicketMessage {
  at: string;
  by: string;
  dev: boolean;
  text: string;
  attachments?: TicketAttachment[];
  /** mudança de situação feita junto com a mensagem */
  status?: TicketStatus;
}
export interface Ticket {
  id: string;
  number: number;
  sector: string | null;
  opened_by_id: string | null;
  opened_by: string;
  opened_by_user: string | null;
  title: string;
  kind: TicketKind;
  priority: TicketPriority;
  status: TicketStatus;
  page: string | null;
  messages: TicketMessage[];
  last_from: 'usuario' | 'dev';
  owner_seen_at: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}
export const TICKET_COLS =
  'id, number, sector, opened_by_id, opened_by, opened_by_user, title, kind, priority, status, page, messages, last_from, owner_seen_at, created_at, updated_at, resolved_at';

export const DEV_USERNAME = 'mateus';
/** chamado resolvido é apagado depois deste tempo */
export const APAGAR_RESOLVIDO_MS = 10 * 60_000;
export const isDev = (u: { username: string } | null | undefined) => !!u && u.username.toLowerCase() === DEV_USERNAME;

export const isKind = (v: unknown): v is TicketKind => typeof v === 'string' && v in KINDS;
export const isPriority = (v: unknown): v is TicketPriority => typeof v === 'string' && v in PRIORITIES;
export const isStatus = (v: unknown): v is TicketStatus => typeof v === 'string' && v in STATUSES;
export const isOpen = (s: TicketStatus) => s === 'aberto' || s === 'em_andamento' || s === 'respondido';

/** Para quem abriu: o desenvolvedor respondeu e a pessoa ainda não viu. */
export function unseenByOwner(t: Ticket): boolean {
  if (t.last_from !== 'dev') return false;
  const last = [...t.messages].reverse().find((m) => m.dev);
  if (!last) return false;
  return !t.owner_seen_at || t.owner_seen_at < last.at;
}
/** Para o desenvolvedor: chamado em aberto esperando resposta dele. */
export const waitingDev = (t: Ticket) => isOpen(t.status) && t.last_from === 'usuario';
