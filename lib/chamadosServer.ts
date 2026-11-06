import 'server-only';
import { fail } from './http';
import { BUCKET, db } from './supabaseAdmin';
import { broadcast } from './broadcast';
import { APAGAR_RESOLVIDO_MS } from './chamados';
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

/**
 * Chamado resolvido some 10 minutos depois (com os anexos). Roda junto da consulta da lista,
 * que todas as telas abertas fazem, no máximo uma vez por minuto por servidor.
 */
let ultimaLimpeza = 0;
export async function limparResolvidos(): Promise<void> {
  const prazo = Number(process.env.CHAMADOS_APAGAR_MS) || APAGAR_RESOLVIDO_MS;
  if (Date.now() - ultimaLimpeza < Math.min(60_000, prazo / 4)) return;
  ultimaLimpeza = Date.now();
  try {
    const limite = new Date(Date.now() - prazo).toISOString();
    const { data, error } = await db().from('tickets').select('id, messages').eq('status', 'resolvido').lt('resolved_at', limite).limit(200);
    if (error || !data?.length) return;
    const velhos = data as { id: string; messages: { attachments?: { path: string }[] }[] }[];
    const { error: e2 } = await db()
      .from('tickets')
      .delete()
      .in('id', velhos.map((t) => t.id))
      .eq('status', 'resolvido');
    if (e2) return;
    const paths = velhos.flatMap((t) => (t.messages ?? []).flatMap((m) => (m.attachments ?? []).map((a) => a.path)));
    if (paths.length) await db().storage.from(BUCKET).remove(paths).catch(() => undefined);
    await broadcast('ticket:update', { status: 'apagado' });
  } catch {
    /* tenta de novo na próxima consulta */
  }
}
