'use client';
import { useEffect, useRef } from 'react';

/**
 * Canal entre a Max e as telas. A Max pede ("filtre as pendentes", "mostre o último mês")
 * e a tela obedece. Se a tela ainda não estiver aberta (a aba está trocando), o pedido
 * fica guardado por alguns segundos e é entregue quando ela aparecer.
 */
export interface MaxEvents {
  'almox:inbox': { filter?: 'nova' | 'pendente' | 'resolvida'; protocol?: number; query?: string };
  'almox:estoque': { filter?: 'todos' | 'baixo' | 'zerado' | 'postos'; query?: string; openId?: string };
  'almox:metricas': { period: 'ultimo-dia' | 'hoje' | 'ultima-semana' | 'ultimo-mes' };
  'almox:postos': { query?: string; openId?: string };
  'hub:users': { create?: { name?: string; sector?: string; master?: boolean }; sector?: string; query?: string };
}

type Name = keyof MaxEvents;
type Handler<K extends Name> = (payload: MaxEvents[K]) => void;

const handlers = new Map<Name, Set<Handler<Name>>>();
const pending = new Map<Name, { payload: unknown; at: number }>();
const KEEP_MS = 4000;

export function maxEmit<K extends Name>(name: K, payload: MaxEvents[K]) {
  const set = handlers.get(name);
  if (set && set.size) {
    pending.delete(name);
    set.forEach((h) => (h as Handler<K>)(payload));
  } else {
    pending.set(name, { payload, at: Date.now() });
  }
}

export function useMaxBus<K extends Name>(name: K, handler: Handler<K>) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const h: Handler<K> = (p) => ref.current(p);
    let set = handlers.get(name);
    if (!set) {
      set = new Set();
      handlers.set(name, set);
    }
    set.add(h as Handler<Name>);
    const wait = pending.get(name);
    if (wait) {
      pending.delete(name);
      if (Date.now() - wait.at < KEEP_MS) h(wait.payload as MaxEvents[K]);
    }
    return () => {
      set!.delete(h as Handler<Name>);
    };
  }, [name]);
}
