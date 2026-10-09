import 'server-only';
import { serviceKey, supabaseUrl } from './supabaseAdmin';
import { REALTIME_CHANNEL, type RealtimeEvent } from './realtimeEvents';

/**
 * Avisa todas as telas abertas (painel e formulário) que algo mudou.
 * Usa o Broadcast REST do Supabase Realtime. Nunca derruba a requisição
 * se o aviso falhar — as telas também atualizam sozinhas a cada poucos segundos.
 */
export async function broadcast(event: RealtimeEvent, payload: Record<string, unknown> = {}) {
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
