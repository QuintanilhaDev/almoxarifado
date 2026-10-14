'use client';
import { canvasColors, rgb } from '@/lib/canvasColors';
import { useEffect, useRef } from 'react';
import { getFx, useFx } from '@/lib/fx';

/* =====================================================================
 * Cena 3D de fundo das ferramentas: piso em perspectiva que avança devagar,
 * sólidos geométricos girando no espaço e poeira em profundidade. A câmera
 * acompanha o mouse. Canvas 2D com projeção própria (sem bibliotecas, leve):
 * 30 quadros por segundo, pausa com a aba escondida, para no modo "lite".
 * ===================================================================== */
type V3 = [number, number, number];

const PHI = (1 + Math.sqrt(5)) / 2;
/** icosaedro: 12 vértices e 30 arestas */
const ICO_V: V3[] = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];
const ICO_E: [number, number][] = (() => {
  const e: [number, number][] = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) {
    const a = ICO_V[i];
    const b = ICO_V[j];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (Math.abs(d - 2) < 0.01) e.push([i, j]);
  }
  return e;
})();
/** octaedro e cubo para variar */
const OCT_V: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((v) => v.map((x) => x * 1.6) as V3);
const OCT_E: [number, number][] = [[0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [1, 4], [1, 5], [2, 4], [2, 5], [3, 4], [3, 5]];
const CUBE_V: V3[] = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z] as V3)));
const CUBE_E: [number, number][] = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];
const SHAPES = [
  { v: ICO_V, e: ICO_E },
  { v: OCT_V, e: OCT_E },
  { v: CUBE_V, e: CUBE_E },
];

interface Solid {
  shape: number;
  x: number;
  y: number;
  z: number;
  size: number;
  rx: number;
  ry: number;
  vx: number;
  vy: number;
  hue: 'lilac' | 'mint';
}

const FAR = 2600;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function Scene3D() {
  const ref = useRef<HTMLCanvasElement>(null);
  const fx = useFx();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || fx === 'off') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let w = 0;
    let h = 0;
    let raf = 0;
    let last = 0;
    let running = true;
    const cam = { yaw: 0, pitch: 0, tyaw: 0, tpitch: 0 };
    const solids: Solid[] = Array.from({ length: 9 }, (_, i) => ({
      shape: i % 3,
      x: rand(-900, 900),
      y: rand(-420, 160),
      z: rand(300, FAR),
      size: rand(26, 64),
      rx: rand(0, 6),
      ry: rand(0, 6),
      vx: rand(0.12, 0.35) * (Math.random() < 0.5 ? -1 : 1),
      vy: rand(0.1, 0.3),
      hue: i % 4 === 0 ? 'mint' : 'lilac',
    }));
    const dust: V3[] = Array.from({ length: 140 }, () => [rand(-1600, 1600), rand(-900, 500), rand(50, FAR)]);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    /** gira pela câmera e projeta na tela; null = atrás da câmera */
    const project = (x: number, y: number, z: number): [number, number, number] | null => {
      const cy = Math.cos(cam.yaw);
      const sy = Math.sin(cam.yaw);
      const cp = Math.cos(cam.pitch);
      const sp = Math.sin(cam.pitch);
      const x1 = x * cy - z * sy;
      const z1 = x * sy + z * cy;
      const y1 = y * cp - z1 * sp;
      const z2 = y * sp + z1 * cp;
      if (z2 < 20) return null;
      const f = Math.min(w, h) * 0.9;
      return [w / 2 + (x1 * f) / z2, h * 0.42 + (y1 * f) / z2, z2];
    };

    const draw = (t: number, dt: number) => {

      const C = canvasColors();
      ctx.clearRect(0, 0, w, h);
      cam.yaw += (cam.tyaw - cam.yaw) * 0.04;
      cam.pitch += (cam.tpitch - cam.pitch) * 0.04;

      // piso em perspectiva (avança devagar)
      const floorY = 380;
      const step = 160;
      const off = ((t * 0.04) % step + step) % step;
      ctx.lineWidth = 1;
      for (let z = FAR; z > 60; z -= step) {
        const zz = z - off;
        const a = project(-2200, floorY, zz);
        const b = project(2200, floorY, zz);
        if (!a || !b) continue;
        const fade = Math.max(0, 1 - zz / FAR);
        ctx.strokeStyle = `rgba(${rgb(C.lilac)},${0.16 * fade * C.boost})`;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
      for (let x = -2200; x <= 2200; x += step) {
        const a = project(x, floorY, 80);
        const b = project(x, floorY, FAR);
        if (!a || !b) continue;
        const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
        g.addColorStop(0, `rgba(${rgb(C.lilac)},0.14)`);
        g.addColorStop(1, `rgba(${rgb(C.lilac)},0)`);
        ctx.strokeStyle = g;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }

      // poeira em profundidade
      for (const p of dust) {
        p[2] -= dt * 0.03;
        if (p[2] < 50) p[2] += FAR;
        const s = project(p[0], p[1], p[2]);
        if (!s) continue;
        const fade = 1 - s[2] / FAR;
        ctx.fillStyle = `rgba(${rgb(C.fg)},${0.35 * fade * C.boost})`;
        const r = Math.max(0.4, 1.6 * fade);
        ctx.fillRect(s[0], s[1], r, r);
      }

      // sólidos girando (do mais longe para o mais perto)
      solids.sort((a, b) => b.z - a.z);
      for (const o of solids) {
        o.rx += dt * 0.0004 * o.vy * 3;
        o.ry += dt * 0.0005 * Math.abs(o.vx) * 3;
        o.z -= dt * 0.025;
        o.x += o.vx * dt * 0.02;
        if (o.z < 120 || Math.abs(o.x) > 1600) {
          o.z = FAR;
          o.x = rand(-900, 900);
          o.y = rand(-420, 160);
        }
        const { v, e } = SHAPES[o.shape];
        const cx = Math.cos(o.rx);
        const sx = Math.sin(o.rx);
        const cyy = Math.cos(o.ry);
        const syy = Math.sin(o.ry);
        const pts = v.map(([x, y, z]) => {
          const y1 = y * cx - z * sx;
          const z1 = y * sx + z * cx;
          const x2 = x * cyy + z1 * syy;
          const z2 = -x * syy + z1 * cyy;
          return project(o.x + x2 * o.size, o.y + y1 * o.size, o.z + z2 * o.size);
        });
        const fade = Math.min(1, (1 - o.z / FAR) * 1.4) * Math.min(1, (o.z - 120) / 300);
        const col = o.hue === 'mint' ? rgb(C.mint) : rgb(C.lilac);
        ctx.strokeStyle = `rgba(${col},${0.34 * fade})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (const [i, j] of e) {
          const a = pts[i];
          const b = pts[j];
          if (!a || !b) continue;
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
        }
        ctx.stroke();
        ctx.fillStyle = `rgba(${col},${0.8 * fade})`;
        for (const p of pts) if (p) ctx.fillRect(p[0] - 1, p[1] - 1, 2, 2);
      }
    };

    const loop = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      const dt = Math.min(64, now - (last || now));
      if (now - last < 32) return; // ~30 quadros por segundo
      last = now;
      draw(now, dt);
    };
    const onMove = (e: PointerEvent) => {
      cam.tyaw = ((e.clientX / Math.max(1, w)) - 0.5) * 0.22;
      cam.tpitch = ((e.clientY / Math.max(1, h)) - 0.5) * 0.12;
    };
    const onVis = () => {
      running = !document.hidden && getFx() === 'full';
      if (running) {
        last = 0;
        raf = requestAnimationFrame(loop);
      } else cancelAnimationFrame(raf);
    };
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('visibilitychange', onVis);
    if (fx === 'full') raf = requestAnimationFrame(loop);
    else draw(4000, 0); // lite: um quadro parado (a profundidade fica, sem gastar bateria)
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [fx]);

  if (fx === 'off') return null;
  return <canvas ref={ref} className="scene3d" aria-hidden />;
}

/* =====================================================================
 * Inclinação 3D: cartões, linhas, botões e janelas giram levemente na
 * direção do mouse, com um brilho que acompanha o cursor. Um só ouvinte
 * para a página inteira (barato) e só no modo "full" com mouse.
 * ===================================================================== */
const TILT =
  '.stat, .p-row, .stock-row:not(.head), .g-card, .hub-card, .posto-card, .o-item, .o-term, .n-line, .move-row, .user-row, .mini-stats > div, .blank-tool, .login-card, .req-card, .o-plan, .p-item, .kit-card, .t-wrap, .empty, .banner, .o-routing, .contact, .detail-hero, .mt-card, .max-card, .btn, .nav-item, .tab, .chip, .cat-chip, .filter-seg button, .pbadge, .avatar';

export function TiltField() {
  const fx = useFx();
  useEffect(() => {
    if (fx !== 'full' || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let el: HTMLElement | null = null;
    let raf = 0;
    let px = 0;
    let py = 0;
    const reset = (x: HTMLElement) => {
      x.classList.remove('is-tilting');
      x.style.removeProperty('--rx');
      x.style.removeProperty('--ry');
      // volta ao lugar com suavidade
      x.classList.add('tilt-out');
      setTimeout(() => x.classList.remove('tilt-out'), 460);
    };
    const apply = () => {
      raf = 0;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const nx = (px - r.left) / r.width - 0.5;
      const ny = (py - r.top) / r.height - 0.5;
      // elementos largos giram menos (uma linha de tabela não pode "virar")
      const max = Math.max(1.2, Math.min(9, 2600 / Math.max(r.width, 1)));
      el.style.setProperty('--rx', `${(-ny * max).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${(nx * max).toFixed(2)}deg`);
      el.style.setProperty('--mx', `${((nx + 0.5) * 100).toFixed(1)}%`);
      el.style.setProperty('--my', `${((ny + 0.5) * 100).toFixed(1)}%`);
    };
    const onMove = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;
      const t = e.target instanceof Element ? (e.target.closest(TILT) as HTMLElement | null) : null;
      if (t !== el) {
        if (el) reset(el);
        el = t;
        if (el) {
          el.classList.remove('tilt-out');
          el.classList.add('is-tilting');
        }
      }
      if (el && !raf) raf = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      if (el) reset(el);
      el = null;
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      if (el) reset(el);
      cancelAnimationFrame(raf);
    };
  }, [fx]);
  return null;
}
