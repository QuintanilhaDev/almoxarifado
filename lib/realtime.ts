'use client';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useRef } from 'react';
import { REALTIME_CHANNEL, type RealtimeEvent } from './realtimeEvents';

let browserClient: SupabaseClient | null = null;

export function browserSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!browserClient) {
    browserClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return browserClient;
}

type Handler = (event: RealtimeEvent, payload: Record<string, unknown>) => void;

const EVENTS: RealtimeEvent[] = ['request:new', 'request:update', 'form:update', 'emails:update', 'admins:update', 'stock:update', 'postos:update', 'purchase:new', 'purchase:update', 'order:new', 'order:update', 'note:update', 'collab:update', 'ticket:update'];

/*
 * Um único canal para a página inteira. O Supabase devolve o MESMO canal para o mesmo nome,
 * então cada tela que fechava o "seu" canal derrubava o aviso das outras (ex.: sair de uma aba
 * de Compras parava o tempo real do painel). Aqui cada tela só se inscreve na lista e o canal
 * fecha quando ninguém mais escuta.
 */
const listeners = new Set<{ current: Handler }>();
const ticks = new Set<{ current: (() => void) | undefined }>();
let shared: RealtimeChannel | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let joinedOnce = false;
/** canal em tempo real conectado: as telas recebem os avisos na hora e quase não precisam conferir sozinhas */
let live = false;
/** com o tempo real funcionando, a conferência de garantia fica bem mais espaçada */
const LIVE_POLL_MS = 120_000;

function openChannel() {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (shared) return;
  const sb = browserSupabase();
  if (!sb) return;
  const ch = sb.channel(REALTIME_CHANNEL, { config: { broadcast: { self: false } } });
  EVENTS.forEach((ev) =>
    ch.on('broadcast', { event: ev }, (msg) => {
      const payload = (msg.payload ?? {}) as Record<string, unknown>;
      listeners.forEach((l) => {
        try {
          l.current(ev, payload);
        } catch {
          /* uma tela com erro não derruba as outras */
        }
      });
    }),
  );
  ch.subscribe((status) => {
    live = status === 'SUBSCRIBED';
    if (status !== 'SUBSCRIBED') return;
    // reconectou (internet caiu, aba dormiu…): busca o que mudou enquanto estava fora
    if (joinedOnce) ticks.forEach((t) => t.current?.());
    joinedOnce = true;
  });
  shared = ch;
}

function maybeClose() {
  if (listeners.size || closeTimer) return;
  closeTimer = setTimeout(() => {
    closeTimer = null;
    if (listeners.size || !shared) return;
    browserSupabase()?.removeChannel(shared);
    shared = null;
    joinedOnce = false;
    live = false;
  }, 4000);
}

/**
 * Escuta os avisos em tempo real. Como garantia extra, também chama
 * `onTick` a cada `pollMs`, quando a aba volta a ficar visível e quando a conexão volta.
 */
export function useRealtime(handler: Handler, onTick?: () => void, pollMs = 15000) {
  const h = useRef(handler);
  const t = useRef(onTick);
  h.current = handler;
  t.current = onTick;

  useEffect(() => {
    listeners.add(h);
    ticks.add(t);
    openChannel();
    let last = Date.now();
    const run = () => {
      last = Date.now();
      t.current?.();
    };
    const poll = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      // tempo real conectado: só confere de vez em quando (as mudanças já chegam pelo aviso)
      if (live && Date.now() - last < Math.max(pollMs, LIVE_POLL_MS)) return;
      run();
    }, pollMs);
    const onVis = () => {
      // voltou para a aba ou a internet voltou: confere (no máximo uma vez a cada 5 s)
      if (document.visibilityState === 'visible' && Date.now() - last > 5000) run();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onVis);
    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onVis);
      listeners.delete(h);
      ticks.delete(t);
      maybeClose();
    };
  }, [pollMs]);
}
