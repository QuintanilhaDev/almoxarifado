/** Um registro da Auditoria (tudo o que as pessoas fazem na plataforma). */
export type AuditKind = 'acesso' | 'tela' | 'acao' | 'max' | 'local' | 'erro';
export interface AuditEvent {
  id: string;
  at: string;
  kind: AuditKind;
  /** o que aconteceu, em uma frase ("Registrou uma entrada no estoque") */
  action: string;
  /** detalhes (quantidades, nomes, motivo do erro…) */
  detail?: string | null;
  ok: boolean;
  user: { id: string | null; name: string; username: string | null; sector: string | null; master: boolean };
  path?: string | null;
  ip?: string | null;
  device?: string | null;
}
export const AUDIT_EVENT = 'audit';
