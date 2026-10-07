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

/**
 * Escuta os avisos em tempo real. Como garantia extra, também chama
 * `onTick` a cada `pollMs` e quando a aba volta a ficar visível.
 */
export function useRealtime(handler: Handler, onTick?: () => void, pollMs = 15000) {
  const h = useRef(handler);
  const t = useRef(onTick);
  h.current = handler;
  t.current = onTick;

  useEffect(() => {
    const sb = browserSupabase();
    const channel = sb?.channel(REALTIME_CHANNEL, { config: { broadcast: { self: false } } });
    if (channel) {
      (['request:new', 'request:update', 'form:update', 'emails:update', 'admins:update', 'stock:update', 'postos:update'] as RealtimeEvent[]).forEach(
        (ev) => channel.on('broadcast', { event: ev }, (msg) => h.current(ev, (msg.payload ?? {}) as Record<string, unknown>)),
      );
      channel.subscribe();
    }
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') t.current?.();
    }, pollMs);
    const onVis = () => {
      if (document.visibilityState === 'visible') t.current?.();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVis);
      if (channel && sb) sb.removeChannel(channel);
    };
  }, [pollMs]);
}
