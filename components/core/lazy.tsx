'use client';
import { useEffect } from 'react';

/** Enquanto o código de uma tela chega (é rápido, mas pode levar um instante na primeira vez). */
export function PanelSkeleton() {
  return (
    <div className="section-scroll" aria-busy="true">
      <div className="section-pad">
        <div className="skeleton" style={{ height: 34, width: 220, borderRadius: 10, marginBottom: 18 }} />
        <div className="skeleton" style={{ height: 220, borderRadius: 16 }} />
      </div>
    </div>
  );
}

/**
 * Baixa o código das outras telas quando a página já está parada (sem atrapalhar a abertura).
 * Assim a primeira carga é leve e trocar de aba continua instantâneo.
 */
export function usePreload(loaders: (() => Promise<unknown>)[]) {
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    let i = 0;
    let id = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const next = () => {
      if (i >= loaders.length) return;
      loaders[i++]().catch(() => undefined);
      queue();
    };
    const queue = () => {
      if (w.requestIdleCallback) id = w.requestIdleCallback(next, { timeout: 4000 });
      else timer = setTimeout(next, 600);
    };
    // espera a tela abrir antes de começar
    timer = setTimeout(queue, 1800);
    return () => {
      if (timer) clearTimeout(timer);
      if (id && w.cancelIdleCallback) w.cancelIdleCallback(id);
    };
    // os carregadores são fixos (definidos fora do componente)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
