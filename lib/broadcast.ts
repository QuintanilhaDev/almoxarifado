import 'server-only';
import { serviceKey, supabaseUrl } from './supabaseAdmin';
import { REALTIME_CHANNEL, type RealtimeEvent } from './realtimeEvents';

/**
 * Avisa todas as telas abertas (painel e formulário) que algo mudou.
 * Usa o Broadcast REST do Supabase Realtime. Nunca derruba a requisição
 * se o aviso falhar — as telas também atualizam sozinhas a cada poucos segundos.
 *
 * O canal é público (qualquer um com a chave anônima escuta e pode mandar avisos), então
 * só vai o mínimo: quem fez e o status, que as telas usam só para decidir se recarregam.
 * Nada de nomes de colaboradores, protocolos ou números.
 */
export async function broadcast(event: RealtimeEvent, full: Record<string, unknown> = {}) {
  const payload: Record<string, string> = {};
  if (typeof full.by === 'string' && full.by) payload.by = full.by.slice(0, 40);
  if (typeof full.status === 'string' && full.status) payload.status = full.status.slice(0, 30);
  try {
    const key = serviceKey();
    const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: key };
    if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    await fetch(`${supabaseUrl()}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        messages: [{ topic: REALTIME_CHANNEL, event, payload, private: false }],
      }),
    }).catch(() => undefined);
    clearTimeout(t);
  } catch {
    /* silencioso */
  }
}
