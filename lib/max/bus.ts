'use client';
import { useEffect, useRef } from 'react';

/**
 * Canal entre a Max e as telas. A Max pede ("filtre as pendentes", "mostre o último mês")
 * e a tela obedece. Se a tela ainda não estiver aberta (a aba está trocando), o pedido
 * fica guardado por alguns segundos e é entregue quando ela aparecer.
 */
export interface MaxEvents {
  'almox:inbox': { filter?: 'nova' | 'pendente' | 'resolvida'; protocol?: number; query?: string };
  'almox:estoque': { filter?: 'todos' | 'baixo' | 'zerado' | 'postos'; query?: string; openId?: string; category?: string };
  'almox:metricas': { period: 'ultimo-dia' | 'hoje' | 'ultima-semana' | 'ultimo-mes' };
  'almox:postos': { query?: string; openId?: string };
  /** aviso falado pela Max (ex.: nova solicitação de compra); tone alert = pisca em amarelo */
  /** abre uma solicitação de compra na tela (Almoxarifado ou Compras) */
  'compras:open': { id: string };
  /** Projeto 3: abre um pedido de material / filtra o painel */
  'pedidos:open': { id?: string; number?: number; filter?: string; query?: string };
  'max:announce': { text: string; tone?: 'alert' };
  'hub:users': { create?: { name?: string; sector?: string; master?: boolean }; sector?: string; query?: string };
}

type Name = keyof MaxEvents;
type Handler<K extends Name> = (payload: MaxEvents[K]) => void;

const handlers = new Map<Name, Set<Handler<Name>>>();
const pending = new Map<Name, { payload: unknown; at: number }>();
const KEEP_MS = 9000;
/** enquanto a Max corre até o botão, os pedidos para a tela ficam guardados e saem depois do soco */
let held = 0;
const queue: { name: Name; payload: unknown }[] = [];
export function holdBus(): () => void {
  held++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    held = Math.max(0, held - 1);
    if (!held) queue.splice(0).forEach((e) => maxEmit(e.name, e.payload as never));
  };
}

export function maxEmit<K extends Name>(name: K, payload: MaxEvents[K]) {
  if (held) {
    queue.push({ name, payload });
    return;
  }
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
