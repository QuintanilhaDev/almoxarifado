'use client';
import { useEffect, useRef } from 'react';
import type { OrbState } from './MaxOrb';

/**
 * O rostinho da Max, desenhado por cima da esfera.
 *  - os olhos (com cílios longos) acompanham o mouse quando ele passa perto, e ela sorri;
 *  - pisca sozinha e, de vez em quando, faz caras e bocas (piscadinha, sorrisão, "ó", língua, beijinho);
 *  - quando fala, a boca abre e fecha no ritmo da fala; ouvindo, fica atenta; pensando, olha para cima.
 * Tudo é animado direto nos atributos do SVG (sem redesenhar o React a cada quadro).
 */
interface Pose {
  /** abertura de cada olho: 0 fechado · 1 normal · >1 arregalado */
  eyeL: number;
  eyeR: number;
  /** 1 = olhos sorrindo (em arco) */
  happy: number;
  /** boca: meia-largura, curva (+ sorriso) e abertura (0..1) */
  mw: number;
  mc: number;
  mo: number;
  /** boca deslocada para o lado */
  mx: number;
  tongue: number;
  blush: number;
  /** para onde ela olha (-1..1), quando não está seguindo o mouse */
  lookX: number;
  lookY: number;
}

const BASE: Record<OrbState, Pose> = {
  idle: { eyeL: 1, eyeR: 1, happy: 0, mw: 4.6, mc: 2.4, mo: 0, mx: 0, tongue: 0, blush: 0.5, lookX: 0, lookY: 0 },
  listening: { eyeL: 1.16, eyeR: 1.16, happy: 0, mw: 2.6, mc: 0.8, mo: 0.42, mx: 0, tongue: 0, blush: 0.55, lookX: 0, lookY: 0 },
  thinking: { eyeL: 0.92, eyeR: 0.92, happy: 0, mw: 2.6, mc: -0.2, mo: 0, mx: 1.6, tongue: 0, blush: 0.4, lookX: 0.75, lookY: -0.8 },
  speaking: { eyeL: 1, eyeR: 1, happy: 0, mw: 4.2, mc: 1.8, mo: 0.3, mx: 0, tongue: 0, blush: 0.55, lookX: 0, lookY: 0 },
};

/** Caras e bocas que ela faz sozinha, quando está à toa. */
const FACES: { pose: Partial<Pose>; ms: number }[] = [
  { pose: { eyeR: 0.06, mw: 5.6, mc: 3.6, mo: 0.25, blush: 0.8 }, ms: 1100 }, // piscadinha
  { pose: { happy: 1, mw: 6.2, mc: 3.2, mo: 0.75, blush: 0.9 }, ms: 1500 }, // sorrisão
  { pose: { eyeL: 1.25, eyeR: 1.25, mw: 2.1, mc: 0, mo: 1 }, ms: 1200 }, // "ó!"
  { pose: { eyeL: 0.06, mw: 4.4, mc: 2.6, mo: 0.55, tongue: 1, blush: 0.8 }, ms: 1400 }, // língua de fora
  { pose: { happy: 1, mw: 1.7, mc: 0, mo: 0.45, blush: 1 }, ms: 1300 }, // beijinho
  { pose: { lookX: -1, lookY: 0.1, mw: 3.4, mc: 0.6, mx: -1.4 }, ms: 1300 }, // olhadinha de lado
  { pose: { lookX: 1, lookY: -0.2, mw: 3.6, mc: 2.2, mx: 1.2, eyeL: 1.1, eyeR: 0.8 }, ms: 1300 }, // desconfiada
  { pose: { eyeL: 0.5, eyeR: 0.5, mw: 3, mc: 0, mo: 0.9 }, ms: 1600 }, // bocejo
];

const EYE_X = 8.4;
const EYE_Y = 46.5;
const MOUTH_Y = 57.4;
const RX = 3.1;
const RY = 4.4;

export function MaxFace({ state }: { state: OrbState }) {
  const root = useRef<SVGSVGElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const svg = root.current;
    if (!svg) return;
    const $ = <T extends SVGElement>(sel: string) => svg.querySelector(sel) as T;
    const face = $<SVGGElement>('.mf-face');
    const eyes = [$<SVGGElement>('.mf-eye-l'), $<SVGGElement>('.mf-eye-r')];
    const balls = [$<SVGGElement>('.mf-eye-l .mf-ball'), $<SVGGElement>('.mf-eye-r .mf-ball')];
    const arcs = [$<SVGPathElement>('.mf-eye-l .mf-arc'), $<SVGPathElement>('.mf-eye-r .mf-arc')];
    const lashes = [$<SVGGElement>('.mf-eye-l .mf-lashes'), $<SVGGElement>('.mf-eye-r .mf-lashes')];
    const mouth = $<SVGPathElement>('.mf-mouth');
    const tongue = $<SVGPathElement>('.mf-tongue');
    const cheeks = [$<SVGEllipseElement>('.mf-cheek-l'), $<SVGEllipseElement>('.mf-cheek-r')];

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cur: Pose = { ...BASE[stateRef.current] };
    const look = { x: 0, y: 0 };
    const pointer = { x: 0, y: 0, near: 0, at: 0 };
    let raf = 0;
    let last = performance.now();
    let blinkAt = last + 1200 + Math.random() * 2500;
    let blinkUntil = 0;
    let faceAt = last + 4000 + Math.random() * 5000;
    let faceUntil = 0;
    let face$: Partial<Pose> = {};
    let wasNear = false;
    let talk = 0;
    let talkTarget = 0.5;
    let talkNext = 0;

    const onMove = (e: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy);
      // "perto" = até ~1,6 vez o tamanho dela (com um mínimo, para a esfera pequena do canto)
      const reach = Math.max(170, r.width * 1.6);
      pointer.near = Math.max(0, 1 - dist / reach);
      const k = Math.min(1, dist / (r.width * 0.5)) / (dist || 1);
      pointer.x = dx * k;
      pointer.y = dy * k;
      pointer.at = performance.now();
    };
    const onLeave = () => {
      pointer.near = 0;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);

    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(0.06, (now - last) / 1000);
      last = now;
      const st = stateRef.current;
      const target: Pose = { ...BASE[st] };
      // mouse parado há um tempo não conta como "perto"
      const near = now - pointer.at < 4000 ? pointer.near : 0;

      if (st === 'idle') {
        if (near > 0.08) {
          // alguém chegou perto: ela olha, sorri e cora
          target.mw = 4.6 + near * 1.8;
          target.mc = 2.4 + near * 1.4;
          target.mo = near > 0.55 ? 0.2 + (near - 0.55) * 1.3 : 0;
          target.blush = 0.5 + near * 0.5;
          if (near > 0.8) target.happy = 1; // mouse em cima dela: olhinhos sorrindo
          if (!wasNear && !reduce) {
            // primeira reação: um "ó!" rápido de surpresa
            face$ = { eyeL: 1.28, eyeR: 1.28, mw: 2.2, mc: 0, mo: 0.9, happy: 0 };
            faceUntil = now + 420;
            faceAt = now + 6000 + Math.random() * 6000;
          }
          wasNear = true;
        } else {
          wasNear = false;
          if (!reduce && now >= faceAt && now >= faceUntil) {
            const f = FACES[Math.floor(Math.random() * FACES.length)];
            face$ = f.pose;
            faceUntil = now + f.ms;
            faceAt = faceUntil + 6500 + Math.random() * 8000;
          }
        }
        if (now < faceUntil) Object.assign(target, face$);
      } else {
        wasNear = false;
        faceUntil = 0;
        faceAt = now + 5000 + Math.random() * 5000;
      }

      if (st === 'speaking') {
        // boca no ritmo da fala: sílabas de tamanhos diferentes, com pausas curtas
        if (now >= talkNext) {
          const pause = Math.random() < 0.14;
          talkTarget = pause ? 0.04 : 0.3 + Math.random() * 0.7;
          talkNext = now + (pause ? 130 + Math.random() * 120 : 70 + Math.random() * 90);
        }
        talk = lerp(talk, talkTarget, 1 - Math.exp(-dt * 28));
        target.mo = talk;
        target.mw = 3.6 + (1 - talk) * 1.6;
        target.mc = 1.2 + (1 - talk) * 1.2;
      } else talk = 0;

      // piscar
      if (now >= blinkAt) {
        blinkUntil = now + 130;
        blinkAt = now + 2400 + Math.random() * 3800 + (Math.random() < 0.18 ? -2100 : 0); // às vezes pisca duas vezes
      }
      const blinking = now < blinkUntil;

      const k = 1 - Math.exp(-dt * 13);
      (Object.keys(target) as (keyof Pose)[]).forEach((key) => {
        cur[key] = lerp(cur[key], target[key], key === 'mo' && st === 'speaking' ? 1 : k);
      });

      // para onde olha: segue o mouse se ele está perto; senão, o que a pose pede
      const follow = st !== 'thinking' && near > 0.02 && now >= faceUntil;
      const lx = follow ? pointer.x : target.lookX;
      const ly = follow ? pointer.y : target.lookY;
      const kl = 1 - Math.exp(-dt * 10);
      look.x = lerp(look.x, lx, kl);
      look.y = lerp(look.y, ly, kl);

      // o rosto inteiro vira um pouco para o lado em que ela olha (dá a sensação de volume)
      const bob = reduce ? 0 : Math.sin(now / 900) * 0.5;
      face.setAttribute('transform', `translate(${(look.x * 2.6).toFixed(2)} ${(look.y * 2.2 + bob).toFixed(2)})`);

      [cur.eyeL, cur.eyeR].forEach((open0, i) => {
        const open = blinking ? 0.05 : open0;
        const happy = blinking ? 0 : cur.happy;
        const sy = Math.max(0.05, open) * (1 - happy);
        balls[i].setAttribute('transform', `translate(${(look.x * 1.5).toFixed(2)} ${(look.y * 1.2).toFixed(2)}) scale(1 ${sy.toFixed(3)})`);
        balls[i].style.opacity = happy > 0.6 ? '0' : '1';
        arcs[i].style.opacity = happy > 0.6 ? '1' : '0';
        // os cílios descem junto com a pálpebra
        const lid = happy > 0.6 ? -1.2 : (1 - Math.min(1, sy)) * RY * 0.92;
        lashes[i].setAttribute('transform', `translate(${(look.x * 1.5).toFixed(2)} ${(look.y * 1.2 + lid).toFixed(2)})`);
        void eyes[i];
      });

      const w = cur.mw;
      const o = Math.max(0, cur.mo);
      const c = cur.mc;
      const top = c - o * 1.5;
      const bottom = c + o * 6.2;
      mouth.setAttribute('d', `M ${(-w).toFixed(2)} 0 Q 0 ${top.toFixed(2)} ${w.toFixed(2)} 0 Q 0 ${bottom.toFixed(2)} ${(-w).toFixed(2)} 0 Z`);
      mouth.setAttribute('transform', `translate(${(50 + cur.mx).toFixed(2)} ${MOUTH_Y})`);
      tongue.setAttribute('transform', `translate(${(50 + cur.mx).toFixed(2)} ${(MOUTH_Y + c * 0.5 + o * 2.2).toFixed(2)}) scale(${Math.max(0.001, cur.tongue).toFixed(3)})`);
      tongue.style.opacity = cur.tongue > 0.05 ? '1' : '0';
      cheeks.forEach((ch) => (ch.style.opacity = (cur.blush * 0.62).toFixed(2)));

      schedule();
    };
    const schedule = () => {
      if (!raf && document.visibilityState === 'visible') raf = requestAnimationFrame(frame);
    };
    const onVis = () => {
      last = performance.now();
      schedule();
    };
    document.addEventListener('visibilitychange', onVis);
    schedule();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const eye = (side: 'l' | 'r') => {
    const s = side === 'l' ? -1 : 1; // cílios para o lado de fora
    const cx = 50 + s * EYE_X;
    return (
      <g className={`mf-eye-${side}`} transform={`translate(${cx} ${EYE_Y})`}>
        <g className="mf-ball">
          <ellipse rx={RX} ry={RY} className="mf-ink" />
          <circle cx={-1} cy={-1.7} r={1.15} fill="#fff" />
          <circle cx={1.1} cy={1.3} r={0.5} fill="#fff" opacity={0.85} />
        </g>
        {/* olho sorrindo (arco) */}
        <path className="mf-arc mf-line" d={`M ${-RX - 0.3} 1.1 Q 0 ${-RY + 0.2} ${RX + 0.3} 1.1`} style={{ opacity: 0 }} />
        {/* cílios longos, no canto de fora */}
        <g className="mf-lashes mf-line">
          <path d={`M ${s * 1.2} ${-RY + 0.3} L ${s * 2.3} ${-RY - 3.4}`} />
          <path d={`M ${s * 2.3} ${-RY + 1.1} L ${s * 4.9} ${-RY - 2.3}`} />
          <path d={`M ${s * 2.9} ${-RY + 2.3} L ${s * 6.3} ${-RY - 0.4}`} />
        </g>
      </g>
    );
  };

  return (
    <svg ref={root} className="max-face" viewBox="0 0 100 100" aria-hidden focusable="false">
      <g className="mf-face">
        <ellipse className="mf-cheek-l mf-cheek" cx={50 - 14.2} cy={54.6} rx={3.5} ry={2.1} />
        <ellipse className="mf-cheek-r mf-cheek" cx={50 + 14.2} cy={54.6} rx={3.5} ry={2.1} />
        {eye('l')}
        {eye('r')}
        <path className="mf-mouth" d="M -4.6 0 Q 0 2.4 4.6 0 Q 0 2.4 -4.6 0 Z" transform={`translate(50 ${MOUTH_Y})`} />
        <path className="mf-tongue" d="M -1.9 0 Q -2 3.4 0 3.6 Q 2 3.4 1.9 0 Z" transform={`translate(50 ${MOUTH_Y})`} style={{ opacity: 0 }} />
      </g>
    </svg>
  );
}
