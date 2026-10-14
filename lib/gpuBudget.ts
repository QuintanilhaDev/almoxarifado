'use client';
/**
 * Orçamento de vídeo compartilhado por todos os desenhos 3D (esferas da Max, corpo dela).
 *
 * Mede o tempo entre quadros: se o computador não está dando conta (quadros lentos),
 * baixa a resolução de todos os canvas juntos; se sobra folga por um tempo, sobe de volta.
 * Assim a animação nunca trava a página, nem em notebook simples.
 */
let scale = 1;
let ema = 16.7;
let good = 0;
let lastNow = 0;
const MIN = 0.45;

/** chame a cada quadro desenhado (vários desenhos no mesmo quadro contam uma vez só) */
export function frameTick(now: number) {
  if (now === lastNow) return;
  const dt = lastNow ? Math.min(250, now - lastNow) : 16.7;
  lastNow = now;
  // aba voltando do fundo, troca de página: não conta
  if (dt > 200) return;
  ema = ema * 0.9 + dt * 0.1;
  if (ema > 26 && scale > MIN) {
    scale = Math.max(MIN, scale - 0.15);
    ema = 18;
    good = 0;
  } else if (ema < 18 && scale < 1) {
    if (++good > 120) {
      scale = Math.min(1, scale + 0.1);
      good = 0;
    }
  } else good = 0;
}

/** quantos pixels de tela por pixel de CSS os canvas 3D devem usar agora */
export function renderRatio(): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  // acima de 1,5 a diferença não aparece numa esfera pequena, mas o custo dobra
  return Math.max(0.5, Math.min(dpr, 1.5) * scale);
}

/** a Max do canto está escondida (ela saiu correndo) ou a aba está no fundo? */
export function orbHidden(canvas: Element): boolean {
  if (document.visibilityState !== 'visible') return true;
  return document.documentElement.classList.contains('max-away') && Boolean(canvas.closest('.max-fab'));
}
