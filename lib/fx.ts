'use client';
import { useEffect, useState } from 'react';
import { FX_KEY } from './fxScript';
const EVENT = 'maxhub:fx';

/**
 * Animações 3D do Max Hub.
 *  - full: cena 3D ao fundo, cartões que inclinam com o mouse, entradas e trocas de tela em 3D
 *  - lite: só as entradas e trocas de tela (sem cena animada nem inclinação) — para aparelhos fracos
 *  - off:  sem animação 3D
 * Padrão: full; lite quando o aparelho pede menos movimento (acessibilidade).
 */
export type { FxMode } from './fxScript';
import type { FxMode } from './fxScript';
export function getFx(): FxMode {
  if (typeof document === 'undefined') return 'full';
  const m = document.documentElement.dataset.fx;
  return m === 'lite' || m === 'off' ? m : 'full';
}

export function setFx(mode: FxMode) {
  document.documentElement.dataset.fx = mode;
  try {
    localStorage.setItem(FX_KEY, mode);
  } catch {
    /* modo vale só nesta aba */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useFx(): FxMode {
  const [mode, setMode] = useState<FxMode>('full');
  useEffect(() => {
    const read = () => setMode(getFx());
    read();
    window.addEventListener(EVENT, read);
    return () => window.removeEventListener(EVENT, read);
  }, []);
  return mode;
}

/** valores 3D para as animações do framer (zero quando o 3D está desligado) */
export const deg = (d: number) => (getFx() === 'off' ? 0 : d);
