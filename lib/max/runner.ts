'use client';
/**
 * Canal para a Max "correr" até um botão antes de trocar de tela.
 * O palco (MaxStage, no layout) registra o executor; a Max e as telas só chamam maxRun.
 */
export type RunStep =
  | { kind: 'tab'; id: string; exec: () => void }
  | { kind: 'path'; path: string }
  /** corre até o elemento `sel` e soca. No soco: `exec` (se houver) ou o clique no próprio botão.
   *  `skipActive`: se o botão já está ativo (aba aberta), pula. */
  | { kind: 'press'; sel: string; exec?: () => void; skipActive?: boolean };
type Runner = (steps: RunStep[], onFirstHit?: () => void) => Promise<void>;
let runner: Runner | null = null;
export const setRunner = (r: Runner | null) => {
  runner = r;
};
/** corre e soca os botões; sem palco (ex.: teste), só executa */
export function maxRun(steps: RunStep[], onFirstHit?: () => void): Promise<void> {
  if (runner) return runner(steps, onFirstHit);
  for (const s of steps) {
    if (s.kind === 'tab') s.exec();
    else if (s.kind === 'press') {
      const el = typeof document !== 'undefined' ? (document.querySelector(s.sel) as HTMLElement | null) : null;
      if (s.exec) s.exec();
      else if (el && !(s.skipActive && el.classList.contains('is-active'))) el.click();
    }
  }
  onFirstHit?.();
  return Promise.resolve();
}
