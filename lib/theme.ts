'use client';
/**
 * Modo claro / escuro.
 *
 * A troca é uma onda que nasce no canto inferior direito e cobre a tela em 4 segundos:
 * a borda da onda ondula, a tela antiga inclina para trás em 3D e a nova chega de frente.
 * Usa a "View Transition" do navegador (a página antiga e a nova viram imagens animadas);
 * sem ela, as cores mudam com um esmaecimento simples.
 */
export type Theme = 'dark' | 'light';
import { THEME_KEY as KEY } from './themeScript';
const META: Record<Theme, string> = { dark: '#0c0c0e', light: '#f4f1fa' };
const DURATION = 4000;


export function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* modo privado: vale só nesta visita */
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META[t]);
  window.dispatchEvent(new CustomEvent('maxhub:theme', { detail: t }));
}

let running = false;

/** a borda da onda: um quarto de círculo saindo do canto, com ondulações que correm pela borda */
function wavePolygon(w: number, h: number, t: number): string {
  const max = Math.hypot(w, h) * 1.08;
  // cresce rápido no começo e assenta no fim
  const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2.2) / 2;
  const r = max * e;
  const amp = Math.min(60, 26 + r * 0.05) * Math.sin(Math.PI * Math.min(1, t * 1.1));
  const pts: string[] = [`${w}px ${h}px`];
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI + (i / steps) * (Math.PI / 2) + (i / steps - 0.5) * 0.3; // um pouco além das bordas
    const wave = amp * (0.65 * Math.sin(a * 9 - t * 22) + 0.35 * Math.sin(a * 17 + t * 31));
    const rr = Math.max(0, r + wave);
    pts.push(`${(w + rr * Math.cos(a)).toFixed(1)}px ${(h + rr * Math.sin(a)).toFixed(1)}px`);
  }
  return `polygon(${pts.join(', ')})`;
}

export function toggleTheme(): Promise<Theme> {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  return setTheme(next);
}

export async function setTheme(next: Theme): Promise<Theme> {
  if (running || next === currentTheme()) return currentTheme();
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> } };
  if (!doc.startViewTransition) {
    // navegador sem View Transition: as cores mudam suavemente
    document.documentElement.classList.add('theme-fade');
    apply(next);
    setTimeout(() => document.documentElement.classList.remove('theme-fade'), 1200);
    return next;
  }
  running = true;
  document.documentElement.classList.add('theme-wave');
  const vt = doc.startViewTransition(() => apply(next));
  try {
    await vt.ready;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const frames = 90;
    const clip: Keyframe[] = [];
    for (let i = 0; i <= frames; i++) clip.push({ clipPath: wavePolygon(w, h, i / frames), offset: i / frames });
    const root = document.documentElement;
    const opts = { duration: DURATION, easing: 'linear', fill: 'both' as const };
    // a tela nova chega de frente, girando a partir do canto
    root.animate(clip, { ...opts, pseudoElement: '::view-transition-new(root)' });
    root.animate(
      [
        { transform: 'perspective(1400px) rotateX(-9deg) rotateY(10deg) scale(1.08)', transformOrigin: '100% 100%', filter: 'brightness(1.12)' },
        { transform: 'perspective(1400px) rotateX(-3deg) rotateY(3deg) scale(1.02)', transformOrigin: '100% 100%', filter: 'brightness(1.04)', offset: 0.55 },
        { transform: 'none', transformOrigin: '100% 100%', filter: 'none' },
      ],
      { duration: DURATION, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both', pseudoElement: '::view-transition-new(root)' },
    );
    // a tela antiga inclina para trás, como uma folha empurrada pela onda
    root.animate(
      [
        { transform: 'none', transformOrigin: '0% 0%', filter: 'none' },
        { transform: 'perspective(1400px) rotateX(5deg) rotateY(-7deg) scale(0.94)', transformOrigin: '0% 0%', filter: 'brightness(0.8) blur(0.5px)', offset: 0.7 },
        { transform: 'perspective(1400px) rotateX(7deg) rotateY(-9deg) scale(0.9)', transformOrigin: '0% 0%', filter: 'brightness(0.65) blur(1px)' },
      ],
      { duration: DURATION, easing: 'cubic-bezier(0.45, 0, 0.2, 1)', fill: 'both', pseudoElement: '::view-transition-old(root)' },
    );
    await vt.finished;
  } catch {
    /* a troca já foi aplicada; só a animação falhou */
  } finally {
    document.documentElement.classList.remove('theme-wave');
    running = false;
  }
  return next;
}
