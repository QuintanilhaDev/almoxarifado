import 'server-only';
import { fail } from './http';
import { missingP3 } from './pedidos/server';
import type { HubUser } from './permissions';
import type { TicketAttachment } from './chamados';

export const CHAMADOS_SETUP = 'Os chamados ainda não foram ativados no banco. Rode o arquivo supabase/chamados.sql no SQL Editor do Supabase.';
export const chamadosFail = () => fail(CHAMADOS_SETUP, 409, { setup: true });
export const missingTickets = missingP3;

/** Anexos enviados por esta pessoa (pasta dela no Storage), no máximo 5 por mensagem. */
export function cleanAttachments(raw: unknown, user: HubUser): TicketAttachment[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > 5) return null;
  const re = new RegExp(`^chamados/${user.id}/[\\w.-]+$`);
  const out: TicketAttachment[] = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object') return null;
    const x = a as Record<string, unknown>;
    const path = String(x.path ?? '');
    if (!re.test(path)) return null;
    out.push({ path, name: String(x.name ?? 'arquivo').slice(0, 120), size: Math.max(0, Number(x.size) || 0), type: String(x.type ?? '').slice(0, 80) });
  }
  return out;
}

export const cleanText = (v: unknown, max: number) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
