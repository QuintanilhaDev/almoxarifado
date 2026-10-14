'use client';
import { useEffect, useState } from 'react';
const EVENT = 'maxhub:fx';

/** Animações 3D do Max Hub (sempre ligadas). */
export type { FxMode } from './fxScript';
import type { FxMode } from './fxScript';
export function getFx(): FxMode {
  if (typeof document === 'undefined') return 'full';
  const m = document.documentElement.dataset.fx;
  return m === 'lite' || m === 'off' ? m : 'full';
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
