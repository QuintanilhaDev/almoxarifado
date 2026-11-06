'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let joinedOnce = false;
/** canal em tempo real conectado: as telas recebem os avisos na hora e quase não precisam conferir sozinhas */
let live = false;
/** com o tempo real funcionando, a conferência de garantia fica bem mais espaçada */
const LIVE_POLL_MS = 120_000;

/**
 * Servidor próprio (Postgres direto): os avisos chegam por uma conexão aberta com o próprio
 * Max Hub (/api/tempo-real), sem o Supabase Realtime. Na Vercel, continua o Supabase.
 */
export const REALTIME_MODE: 'sse' | 'supabase' = process.env.NEXT_PUBLIC_REALTIME_MODE === 'sse' ? 'sse' : 'supabase';

type Conn = { close: () => void };
let shared: Conn | null = null;
/** outros canais (ex.: auditoria ao vivo do master) que usam a mesma conexão */
const topicListeners = new Map<string, Set<(event: string, payload: Record<string, unknown>) => void>>();
const statusListeners = new Set<(on: boolean) => void>();
const setLive = (on: boolean) => {
  live = on;
  statusListeners.forEach((f) => f(on));
};

function dispatch(ev: RealtimeEvent, payload: Record<string, unknown>) {
  listeners.forEach((l) => {
    try {
      l.current(ev, payload);
    } catch {
      /* uma tela com erro não derruba as outras */
    }
  });
}
function joined() {
  // reconectou (internet caiu, aba dormiu, servidor reiniciou…): busca o que mudou enquanto estava fora
  if (joinedOnce) ticks.forEach((t) => t.current?.());
  joinedOnce = true;
}

function openChannel() {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (shared) return;
  if (REALTIME_MODE === 'sse') {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/tempo-real');
    es.onopen = () => {
      setLive(true);
      joined();
    };
    // o navegador reconecta sozinho; enquanto isso, as telas voltam a conferir no ritmo normal
    es.onerror = () => setLive(false);
    es.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data) as { topic: string; event: string; payload?: Record<string, unknown> };
        if (m.topic === REALTIME_CHANNEL) {
          if ((EVENTS as string[]).includes(m.event)) dispatch(m.event as RealtimeEvent, m.payload ?? {});
        } else topicListeners.get(m.topic)?.forEach((f) => f(m.event, m.payload ?? {}));
      } catch {
        /* aviso malformado */
      }
    };
    shared = { close: () => es.close() };
    return;
  }
  const sb = browserSupabase();
  if (!sb) return;
  const ch = sb.channel(REALTIME_CHANNEL, { config: { broadcast: { self: false } } });
  EVENTS.forEach((ev) => ch.on('broadcast', { event: ev }, (msg) => dispatch(ev, (msg.payload ?? {}) as Record<string, unknown>)));
  ch.subscribe((status) => {
    setLive(status === 'SUBSCRIBED');
    if (status === 'SUBSCRIBED') joined();
  });
  shared = { close: () => void browserSupabase()?.removeChannel(ch) };
}

function inUse() {
  return listeners.size > 0 || [...topicListeners.values()].some((s) => s.size > 0);
}
function maybeClose() {
  if (inUse() || closeTimer) return;
  closeTimer = setTimeout(() => {
    closeTimer = null;
    if (inUse() || !shared) return;
    shared.close();
    shared = null;
    joinedOnce = false;
    setLive(false);
  }, 4000);
}

/**
 * Canal extra na mesma conexão (servidor próprio). Ex.: auditoria ao vivo do master.
 * Devolve a função para sair.
 */
export function listenTopic(topic: string, fn: (event: string, payload: Record<string, unknown>) => void, onStatus?: (on: boolean) => void): () => void {
  if (!topicListeners.has(topic)) topicListeners.set(topic, new Set());
  topicListeners.get(topic)!.add(fn);
  if (onStatus) {
    statusListeners.add(onStatus);
    onStatus(live);
  }
  openChannel();
  return () => {
    topicListeners.get(topic)?.delete(fn);
    if (onStatus) statusListeners.delete(onStatus);
    maybeClose();
  };
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
